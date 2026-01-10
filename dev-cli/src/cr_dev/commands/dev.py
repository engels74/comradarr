"""Development server command with ephemeral/persistent/reconnect modes."""

import atexit
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Annotated

import typer

from cr_dev.core.config import DevConfig

if TYPE_CHECKING:
    from collections.abc import Callable
from cr_dev.core.logging import (
    console,
    error,
    get_textual_log,
    info,
    output,
    step,
    success,
    warning,
)
from cr_dev.core.platform import (
    PlatformStrategy,
    detect_platform,
    get_strategy,
    is_macos,
)
from cr_dev.core.process import (
    is_port_in_use,
)
from cr_dev.core.state import (
    DevState,
    SavedCredentials,
    load_credentials,
    remove_state,
    save_credentials,
    save_state,
)

DB_NAME_PATTERN = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
MAX_DB_NAME_LENGTH = 63


def validate_db_name(name: str) -> bool:
    """Validate database name against SQL identifier rules."""
    if len(name) > MAX_DB_NAME_LENGTH:
        return False
    return bool(DB_NAME_PATTERN.match(name))


def _get_project_root() -> Path:
    """Get the project root directory."""
    # dev.py -> commands -> cr_dev -> src -> dev-cli -> project root
    return Path(__file__).parent.parent.parent.parent.parent


def _create_database(config: DevConfig, platform_strategy: PlatformStrategy) -> bool:
    """Create database and user for dev server."""
    platform = detect_platform()

    db_name = config.db_name
    if not db_name:
        error("Database name is required")
        return False

    create_user_sql = f"""
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{db_name}') THEN
            CREATE ROLE {db_name} WITH LOGIN PASSWORD '{config.db_password}';
        ELSE
            ALTER ROLE {db_name} WITH PASSWORD '{config.db_password}';
        END IF;
    END
    $$;
    """

    if is_macos(platform):
        result = subprocess.run(
            [
                "psql",
                "-h",
                "localhost",
                "-p",
                str(config.db_port),
                "-d",
                "postgres",
                "-c",
                create_user_sql,
            ],
            capture_output=True,
            text=True,
        )
    else:
        result = platform_strategy.run_as_postgres_user(
            ["psql", "-d", "postgres", "-c", create_user_sql],
            check=False,
        )

    if result.returncode != 0:
        error(f"Failed to create user: {result.stderr}")
        return False

    if is_macos(platform):
        check_db = subprocess.run(
            [
                "psql",
                "-h",
                "localhost",
                "-p",
                str(config.db_port),
                "-d",
                "postgres",
                "-tAc",
                f"SELECT 1 FROM pg_database WHERE datname = '{db_name}'",
            ],
            capture_output=True,
            text=True,
        )
        db_exists = check_db.stdout.strip() == "1"
    else:
        check_db = platform_strategy.run_as_postgres_user(
            [
                "psql",
                "-d",
                "postgres",
                "-tAc",
                f"SELECT 1 FROM pg_database WHERE datname = '{db_name}'",
            ],
            check=False,
        )
        db_exists = check_db.stdout.strip() == "1"

    if not db_exists:
        if is_macos(platform):
            result = subprocess.run(
                [
                    "psql",
                    "-h",
                    "localhost",
                    "-p",
                    str(config.db_port),
                    "-d",
                    "postgres",
                    "-c",
                    f"CREATE DATABASE {db_name} OWNER {db_name}",
                ],
                capture_output=True,
                text=True,
            )
        else:
            result = platform_strategy.run_as_postgres_user(
                [
                    "psql",
                    "-d",
                    "postgres",
                    "-c",
                    f"CREATE DATABASE {db_name} OWNER {db_name}",
                ],
                check=False,
            )

        if result.returncode != 0:
            error(f"Failed to create database: {result.stderr}")
            return False

    grant_sql = f"GRANT ALL PRIVILEGES ON DATABASE {db_name} TO {db_name}; GRANT ALL ON SCHEMA public TO {db_name};"

    if is_macos(platform):
        _ = subprocess.run(
            [
                "psql",
                "-h",
                "localhost",
                "-p",
                str(config.db_port),
                "-d",
                db_name,
                "-c",
                grant_sql,
            ],
            capture_output=True,
            text=True,
        )
    else:
        _ = platform_strategy.run_as_postgres_user(
            ["psql", "-d", db_name, "-c", grant_sql],
            check=False,
        )

    return True


def drop_database(
    db_name: str, db_port: int, platform_strategy: PlatformStrategy
) -> bool:
    """Drop database and user."""
    platform = detect_platform()

    if is_macos(platform):
        _ = subprocess.run(
            [
                "psql",
                "-h",
                "localhost",
                "-p",
                str(db_port),
                "-d",
                "postgres",
                "-c",
                f"DROP DATABASE IF EXISTS {db_name}",
            ],
            capture_output=True,
            text=True,
        )
        _ = subprocess.run(
            [
                "psql",
                "-h",
                "localhost",
                "-p",
                str(db_port),
                "-d",
                "postgres",
                "-c",
                f"DROP ROLE IF EXISTS {db_name}",
            ],
            capture_output=True,
            text=True,
        )
    else:
        _ = platform_strategy.run_as_postgres_user(
            ["psql", "-d", "postgres", "-c", f"DROP DATABASE IF EXISTS {db_name}"],
            check=False,
        )
        _ = platform_strategy.run_as_postgres_user(
            ["psql", "-d", "postgres", "-c", f"DROP ROLE IF EXISTS {db_name}"],
            check=False,
        )

    return True


def _run_migrations(config: DevConfig, project_root: Path) -> bool:
    """Run database migrations."""
    env = os.environ.copy()
    env["DATABASE_URL"] = config.database_url
    env["SECRET_KEY"] = config.secret_key

    result = subprocess.run(
        ["bunx", "drizzle-kit", "migrate"],
        cwd=project_root,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,  # 5 minute timeout for migrations
    )

    return result.returncode == 0


def _create_admin_user(config: DevConfig, project_root: Path) -> bool:
    """Create admin user in the database."""
    env = os.environ.copy()
    env["DATABASE_URL"] = config.database_url
    env["SECRET_KEY"] = config.secret_key
    env["ADMIN_PASSWORD"] = config.admin_password

    result = subprocess.run(
        ["bun", "run", "scripts/create-admin.ts"],
        cwd=project_root,
        env=env,
        capture_output=True,
        text=True,
    )

    return result.returncode == 0


def _display_banner(config: DevConfig, _project_root: Path) -> None:
    """Display connection information banner."""
    console.print()
    console.print(
        "[bold green]═══════════════════════════════════════════════════════════════[/bold green]"
    )
    console.print("[bold green]   Comradarr Dev Server Running[/bold green]")
    console.print(
        "[bold green]═══════════════════════════════════════════════════════════════[/bold green]"
    )
    console.print()
    console.print(f"  [cyan]URL:[/cyan]          http://localhost:{config.port}")
    console.print(f"  [cyan]Database:[/cyan]     {config.db_name}")
    console.print("  [cyan]Admin User:[/cyan]   admin")
    console.print(f"  [cyan]Admin Pass:[/cyan]   {config.admin_password}")
    if config.skip_auth:
        console.print("  [yellow]Auth:[/yellow]         BYPASSED (--skip-auth)")

    console.print()
    console.print("  [dim]Press Ctrl+C to stop the server[/dim]")
    console.print()


@dataclass(slots=True)
class DevServerSetupResult:
    """Result of dev server setup containing all info needed to start the server."""

    config: DevConfig
    project_root: Path
    env: dict[str, str]
    cmd: list[str]
    cleanup_callback: Callable[[], None]


def setup_dev_server(
    persist: bool = False,
    db_name: str | None = None,
    reconnect: str | None = None,
    admin_password: str | None = None,
    port: int = 5173,
    db_port: int = 5432,
    skip_auth: bool = False,
) -> DevServerSetupResult | None:
    """Setup dev server without starting it - for TUI use.

    Returns None if setup failed, otherwise returns all info needed to start the server.
    """
    project_root = _get_project_root()
    platform = detect_platform()
    strategy = get_strategy(platform)

    if not strategy.is_postgres_running():
        step("Starting PostgreSQL...")
        if not strategy.start_postgres_service():
            error("Failed to start PostgreSQL")
            return None

    if is_port_in_use(port):
        error(f"Port {port} is already in use")
        return None

    config = DevConfig(
        port=port,
        db_port=db_port,
        skip_auth=skip_auth,
    )

    if admin_password:
        config.admin_password = admin_password

    if reconnect:
        creds = load_credentials(reconnect)
        if not creds:
            error(f"No saved credentials for database: {reconnect}")
            return None

        config.db_name = reconnect
        config.db_password = creds.password
        config.secret_key = creds.secret_key
        config.admin_password = creds.admin_password
        config.reconnect = True

        info(f"Reconnecting to database: {reconnect}")

    elif db_name:
        if not validate_db_name(db_name):
            error(f"Invalid database name: {db_name}")
            return None

        config.db_name = db_name
        config.persist = persist

        existing_creds = load_credentials(db_name)
        if existing_creds:
            info(f"Database '{db_name}' exists, reconnecting...")
            config.db_password = existing_creds.password
            config.secret_key = existing_creds.secret_key
            config.admin_password = existing_creds.admin_password
            config.reconnect = True
        else:
            step(f"Creating database '{db_name}'...")
            if not _create_database(config, strategy):
                return None
            success(f"Database '{db_name}' created")

    else:
        config.db_name = config.generate_db_name()
        config.persist = persist

        step(f"Creating ephemeral database '{config.db_name}'...")
        if not _create_database(config, strategy):
            return None
        success(f"Database '{config.db_name}' created")

    if not config.reconnect:
        step("Running migrations...")
        if not _run_migrations(config, project_root):
            error("Failed to run migrations")
            if not config.persist and config.db_name:
                _ = drop_database(config.db_name, config.db_port, strategy)
            return None
        success("Migrations completed")

        step("Creating admin user...")
        if not _create_admin_user(config, project_root):
            warning("Admin user may already exist")
        else:
            success("Admin user created")

    final_db_name = config.db_name or ""

    if config.persist or config.reconnect:
        save_credentials(
            final_db_name,
            SavedCredentials(
                password=config.db_password,
                secret_key=config.secret_key,
                admin_password=config.admin_password,
            ),
        )

    state = DevState(
        pid=os.getpid(),
        port=port,
        db_name=final_db_name,
        db_password=config.db_password,
        db_port=db_port,
        secret_key=config.secret_key,
        admin_password=config.admin_password,
        persist_mode=config.persist,
        reconnect_mode=config.reconnect,
    )
    save_state(state)

    def cleanup() -> None:
        """Cleanup on exit."""
        if not config.persist and not config.reconnect:
            info("Cleaning up ephemeral database...")
            _ = drop_database(final_db_name, config.db_port, strategy)
            success(f"Database '{final_db_name}' removed")
        elif config.persist:
            info(f"Database '{final_db_name}' preserved")

    env = os.environ.copy()
    env["DATABASE_URL"] = config.database_url
    env["SECRET_KEY"] = config.secret_key
    if config.skip_auth:
        env["AUTH_MODE"] = "local_bypass"

    cmd = ["bun", "run", "dev", "--port", str(port)]

    _display_banner(config, project_root)

    return DevServerSetupResult(
        config=config,
        project_root=project_root,
        env=env,
        cmd=cmd,
        cleanup_callback=cleanup,
    )


def dev_command(
    persist: Annotated[
        bool, typer.Option("--persist", help="Persist database on exit")
    ] = False,
    db_name: Annotated[
        str | None, typer.Option("--db-name", help="Custom database name")
    ] = None,
    reconnect: Annotated[
        str | None, typer.Option("--reconnect", help="Reconnect to existing database")
    ] = None,
    admin_password: Annotated[
        str | None, typer.Option("--admin-password", help="Set admin password")
    ] = None,
    port: Annotated[int, typer.Option("--port", help="Dev server port")] = 5173,
    db_port: Annotated[int, typer.Option("--db-port", help="Database port")] = 5432,
    skip_auth: Annotated[
        bool, typer.Option("--skip-auth", help="Enable local_bypass auth mode")
    ] = False,
    no_logs: Annotated[
        bool, typer.Option("--no-logs", help="Don't write log file")
    ] = False,
) -> None:
    """Start development server with isolated database."""
    _ = no_logs  # Reserved for future use
    project_root = _get_project_root()
    platform = detect_platform()
    strategy = get_strategy(platform)

    if not strategy.is_postgres_running():
        step("Starting PostgreSQL...")
        if not strategy.start_postgres_service():
            error("Failed to start PostgreSQL")
            raise typer.Exit(1)

    if is_port_in_use(port):
        error(f"Port {port} is already in use")
        raise typer.Exit(1)

    config = DevConfig(
        port=port,
        db_port=db_port,
        skip_auth=skip_auth,
    )

    if admin_password:
        config.admin_password = admin_password

    if reconnect:
        creds = load_credentials(reconnect)
        if not creds:
            error(f"No saved credentials for database: {reconnect}")
            raise typer.Exit(1)

        config.db_name = reconnect
        config.db_password = creds.password
        config.secret_key = creds.secret_key
        config.admin_password = creds.admin_password
        config.reconnect = True

        info(f"Reconnecting to database: {reconnect}")

    elif db_name:
        if not validate_db_name(db_name):
            error(f"Invalid database name: {db_name}")
            raise typer.Exit(1)

        config.db_name = db_name
        config.persist = persist

        existing_creds = load_credentials(db_name)
        if existing_creds:
            if not typer.confirm(f"Database '{db_name}' already exists. Reconnect?"):
                raise typer.Exit(0)
            config.db_password = existing_creds.password
            config.secret_key = existing_creds.secret_key
            config.admin_password = existing_creds.admin_password
            config.reconnect = True
        else:
            step(f"Creating database '{db_name}'...")
            if not _create_database(config, strategy):
                raise typer.Exit(1)
            success(f"Database '{db_name}' created")

    else:
        config.db_name = config.generate_db_name()
        config.persist = persist

        step(f"Creating ephemeral database '{config.db_name}'...")
        if not _create_database(config, strategy):
            raise typer.Exit(1)
        success(f"Database '{config.db_name}' created")

    if not config.reconnect:
        step("Running migrations...")
        if not _run_migrations(config, project_root):
            error("Failed to run migrations")
            if not config.persist and config.db_name:
                _ = drop_database(config.db_name, config.db_port, strategy)
            raise typer.Exit(1)
        success("Migrations completed")

        step("Creating admin user...")
        if not _create_admin_user(config, project_root):
            warning("Admin user may already exist")
        else:
            success("Admin user created")

    db_name = config.db_name or ""

    if config.persist or config.reconnect:
        save_credentials(
            db_name,
            SavedCredentials(
                password=config.db_password,
                secret_key=config.secret_key,
                admin_password=config.admin_password,
            ),
        )

    state = DevState(
        pid=os.getpid(),
        port=port,
        db_name=db_name,
        db_password=config.db_password,
        db_port=db_port,
        secret_key=config.secret_key,
        admin_password=config.admin_password,
        persist_mode=config.persist,
        reconnect_mode=config.reconnect,
    )
    save_state(state)

    def cleanup() -> None:
        """Cleanup on exit."""
        remove_state()

        if not config.persist and not config.reconnect:
            info("Cleaning up ephemeral database...")
            _ = drop_database(db_name, config.db_port, strategy)
            success(f"Database '{db_name}' removed")
        elif config.persist:
            info(f"Database '{db_name}' preserved")

    _ = atexit.register(cleanup)

    env = os.environ.copy()
    env["DATABASE_URL"] = config.database_url
    env["SECRET_KEY"] = config.secret_key
    if config.skip_auth:
        env["AUTH_MODE"] = "local_bypass"

    _display_banner(config, project_root)

    is_tui_mode = get_textual_log() is not None
    process: subprocess.Popen[str] | None = None

    try:
        if is_tui_mode:
            process = subprocess.Popen(
                ["bun", "run", "dev", "--port", str(port)],
                cwd=project_root,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            state.pid = process.pid
            save_state(state)

            if process.stdout:
                for line in process.stdout:
                    output(line.rstrip("\n"))
            _ = process.wait()
        else:
            process = subprocess.Popen(
                ["bun", "run", "dev", "--port", str(port)],
                cwd=project_root,
                env=env,
                text=True,
            )
            state.pid = process.pid
            save_state(state)

            _ = process.wait()
    except KeyboardInterrupt:
        info("Shutting down...")
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                _ = process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
