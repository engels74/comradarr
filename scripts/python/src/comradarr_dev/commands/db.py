"""Database management commands - install, start, stop, status, setup, teardown, reset, env."""

import os
import shutil
import subprocess
import time
from typing import Annotated

import typer

from comradarr_dev.core.config import TestDbConfig
from comradarr_dev.core.logging import console, error, info, step, success, warning
from comradarr_dev.core.platform import (
    OS,
    detect_platform,
    get_strategy,
    is_linux,
    is_macos,
)

app = typer.Typer(no_args_is_help=True)


def _wait_for_postgres(*, timeout: int = 30) -> bool:
    """Wait for PostgreSQL to become ready."""
    start = time.monotonic()
    while (time.monotonic() - start) < timeout:
        result = subprocess.run(["pg_isready", "-q"], capture_output=True)
        if result.returncode == 0:
            return True
        time.sleep(1)
    return False


def _get_config() -> TestDbConfig:
    """Get test database configuration from environment or defaults."""
    return TestDbConfig(
        user=os.environ.get("TEST_DB_USER", "comradarr_test"),
        password=os.environ.get("TEST_DB_PASSWORD", "testpassword"),
        name=os.environ.get("TEST_DB_NAME", "comradarr_test"),
        host=os.environ.get("TEST_DB_HOST", "localhost"),
        port=int(os.environ.get("TEST_DB_PORT", "5432")),
    )


@app.command()
def install(
    no_start: Annotated[
        bool,
        typer.Option("--no-start", help="Don't start PostgreSQL after installation"),
    ] = False,
) -> None:
    """Install PostgreSQL on the current platform."""
    platform = detect_platform()

    if platform.os == OS.UNSUPPORTED:
        error(f"Unsupported platform: {platform.os.value}")
        raise typer.Exit(1)

    if is_macos(platform):
        if not shutil.which("brew"):
            error("Homebrew is required on macOS. Install from https://brew.sh")
            raise typer.Exit(1)

        if platform.homebrew_postgres:
            info(f"PostgreSQL already installed: {platform.homebrew_postgres}")
        else:
            step("Installing PostgreSQL via Homebrew...")
            strategy = get_strategy(platform)
            if not strategy.install_postgres():
                error("Failed to install PostgreSQL")
                raise typer.Exit(1)
            success("PostgreSQL installed successfully")

    elif is_linux(platform):
        if shutil.which("psql"):
            info("PostgreSQL already installed")
        else:
            step("Installing PostgreSQL via apt...")
            strategy = get_strategy(platform)
            if not strategy.install_postgres():
                error("Failed to install PostgreSQL")
                raise typer.Exit(1)
            success("PostgreSQL installed successfully")

    if not no_start:
        strategy = get_strategy(platform)
        if not strategy.is_postgres_running():
            step("Starting PostgreSQL service...")
            if strategy.start_postgres_service():
                if _wait_for_postgres():
                    success("PostgreSQL is now running")
                else:
                    warning("PostgreSQL started but not responding yet")
            else:
                error("Failed to start PostgreSQL service")
                raise typer.Exit(1)
        else:
            info("PostgreSQL is already running")


@app.command()
def start() -> None:
    """Start the PostgreSQL service."""
    platform = detect_platform()
    strategy = get_strategy(platform)

    if strategy.is_postgres_running():
        info("PostgreSQL is already running")
        return

    step("Starting PostgreSQL service...")
    if not strategy.start_postgres_service():
        error("Failed to start PostgreSQL service")
        raise typer.Exit(1)

    if _wait_for_postgres():
        success("PostgreSQL is now running")
    else:
        error("PostgreSQL started but not responding")
        raise typer.Exit(1)


@app.command()
def stop() -> None:
    """Stop the PostgreSQL service."""
    platform = detect_platform()
    strategy = get_strategy(platform)

    if not strategy.is_postgres_running():
        info("PostgreSQL is not running")
        return

    step("Stopping PostgreSQL service...")
    if strategy.stop_postgres_service():
        success("PostgreSQL stopped")
    else:
        error("Failed to stop PostgreSQL service")
        raise typer.Exit(1)


@app.command()
def status() -> None:
    """Check PostgreSQL installation and service status."""
    platform = detect_platform()
    console.print()
    console.print("[bold]Platform Information[/bold]")
    console.print(f"  OS: {platform.os.value}")

    if is_linux(platform):
        console.print(f"  Distro: {platform.distro.value}")
        if platform.is_wsl:
            console.print("  WSL: Yes")

    if is_macos(platform):
        if platform.homebrew_postgres:
            console.print(f"  Homebrew PostgreSQL: {platform.homebrew_postgres}")
        else:
            console.print("  Homebrew PostgreSQL: Not installed")

    console.print()
    console.print("[bold]PostgreSQL Status[/bold]")

    if shutil.which("psql"):
        console.print("  [green]✓[/green] psql: installed")
    else:
        console.print("  [red]✗[/red] psql: not found")

    if shutil.which("pg_isready"):
        console.print("  [green]✓[/green] pg_isready: installed")
    else:
        console.print("  [red]✗[/red] pg_isready: not found")

    try:
        strategy = get_strategy(platform)
        if strategy.is_postgres_running():
            console.print("  [green]✓[/green] Service: running")
        else:
            console.print("  [yellow]○[/yellow] Service: stopped")
    except ValueError:
        console.print("  [red]✗[/red] Service: unknown (unsupported platform)")

    config = _get_config()
    console.print()
    console.print("[bold]Test Database Configuration[/bold]")
    console.print(f"  User: {config.user}")
    console.print(f"  Database: {config.name}")
    console.print(f"  Host: {config.host}:{config.port}")

    try:
        strategy = get_strategy(platform)
        if strategy.is_postgres_running():
            result = subprocess.run(
                [
                    "psql",
                    "-h",
                    config.host,
                    "-p",
                    str(config.port),
                    "-U",
                    config.user,
                    "-d",
                    config.name,
                    "-c",
                    "SELECT 1",
                ],
                capture_output=True,
                text=True,
                env={**os.environ, "PGPASSWORD": config.password},
            )
            if result.returncode == 0:
                console.print("  [green]✓[/green] Connection: OK")
            else:
                console.print(
                    "  [yellow]○[/yellow] Connection: database may not exist yet"
                )
    except ValueError:
        pass


@app.command()
def setup() -> None:
    """Create test database and user, run migrations."""
    platform = detect_platform()
    strategy = get_strategy(platform)
    config = _get_config()

    if not strategy.is_postgres_running():
        error("PostgreSQL is not running. Start it first with: comradarr-dev db start")
        raise typer.Exit(1)

    step(f"Creating user '{config.user}'...")

    if is_macos(platform):
        create_user_sql = f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{config.user}') THEN
                CREATE ROLE {config.user} WITH LOGIN PASSWORD '{config.password}';
            ELSE
                ALTER ROLE {config.user} WITH PASSWORD '{config.password}';
            END IF;
        END
        $$;
        """
        result = subprocess.run(
            [
                "psql",
                "-h",
                config.host,
                "-p",
                str(config.port),
                "-d",
                "postgres",
                "-c",
                create_user_sql,
            ],
            capture_output=True,
            text=True,
        )
    else:
        create_user_sql = f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{config.user}') THEN
                CREATE ROLE {config.user} WITH LOGIN PASSWORD '{config.password}';
            ELSE
                ALTER ROLE {config.user} WITH PASSWORD '{config.password}';
            END IF;
        END
        $$;
        """
        result = strategy.run_as_postgres_user(
            ["psql", "-d", "postgres", "-c", create_user_sql],
            check=False,
        )

    if result.returncode != 0:
        error(f"Failed to create user: {result.stderr}")
        raise typer.Exit(1)
    success(f"User '{config.user}' ready")

    step(f"Creating database '{config.name}'...")

    if is_macos(platform):
        check_db = subprocess.run(
            [
                "psql",
                "-h",
                config.host,
                "-p",
                str(config.port),
                "-d",
                "postgres",
                "-tAc",
                f"SELECT 1 FROM pg_database WHERE datname = '{config.name}'",
            ],
            capture_output=True,
            text=True,
        )
        db_exists = check_db.stdout.strip() == "1"
    else:
        check_db = strategy.run_as_postgres_user(
            [
                "psql",
                "-d",
                "postgres",
                "-tAc",
                f"SELECT 1 FROM pg_database WHERE datname = '{config.name}'",
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
                    config.host,
                    "-p",
                    str(config.port),
                    "-d",
                    "postgres",
                    "-c",
                    f"CREATE DATABASE {config.name} OWNER {config.user}",
                ],
                capture_output=True,
                text=True,
            )
        else:
            result = strategy.run_as_postgres_user(
                [
                    "psql",
                    "-d",
                    "postgres",
                    "-c",
                    f"CREATE DATABASE {config.name} OWNER {config.user}",
                ],
                check=False,
            )

        if result.returncode != 0:
            error(f"Failed to create database: {result.stderr}")
            raise typer.Exit(1)

    if is_macos(platform):
        grant_sql = f"GRANT ALL PRIVILEGES ON DATABASE {config.name} TO {config.user}; GRANT ALL ON SCHEMA public TO {config.user};"
        _ = subprocess.run(
            [
                "psql",
                "-h",
                config.host,
                "-p",
                str(config.port),
                "-d",
                config.name,
                "-c",
                grant_sql,
            ],
            capture_output=True,
            text=True,
        )
    else:
        grant_sql = f"GRANT ALL PRIVILEGES ON DATABASE {config.name} TO {config.user}; GRANT ALL ON SCHEMA public TO {config.user};"
        _ = strategy.run_as_postgres_user(
            ["psql", "-d", config.name, "-c", grant_sql],
            check=False,
        )

    success(f"Database '{config.name}' ready")

    step("Running migrations...")

    from pathlib import Path

    project_root = Path(__file__).parent.parent.parent.parent.parent.parent
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

    if result.returncode != 0:
        error(f"Failed to run migrations: {result.stderr}")
        raise typer.Exit(1)

    success("Migrations completed")
    success("Test database setup complete!")


def _check_database_in_use(db_name: str) -> bool:
    """Check if database is in use and handle appropriately.

    Returns True if operation should be blocked, False if safe to proceed.
    """
    from comradarr_dev.core.logging import get_textual_log
    from comradarr_dev.core.state import is_database_in_use

    in_use, state = is_database_in_use(db_name)

    if not in_use or state is None:
        return False

    is_tui_mode = get_textual_log() is not None

    if is_tui_mode:
        error(f"Database '{db_name}' is in use by dev server (PID: {state.pid})")
        error("Stop the dev server first before tearing down the database")
        return True

    warning(f"Database '{db_name}' is in use by dev server (PID: {state.pid})")
    response = str(typer.prompt("Continue anyway? This may cause issues", default="n"))  # pyright: ignore[reportAny]
    if response.lower() not in ("y", "yes"):
        info("Operation cancelled")
        return True

    return False


@app.command()
def teardown() -> None:
    """Drop test database and user."""
    platform = detect_platform()
    strategy = get_strategy(platform)
    config = _get_config()

    if not strategy.is_postgres_running():
        error("PostgreSQL is not running")
        raise typer.Exit(1)

    if _check_database_in_use(config.name):
        raise typer.Exit(1)

    step(f"Dropping database '{config.name}'...")

    if is_macos(platform):
        result = subprocess.run(
            [
                "psql",
                "-h",
                config.host,
                "-p",
                str(config.port),
                "-d",
                "postgres",
                "-c",
                f"DROP DATABASE IF EXISTS {config.name}",
            ],
            capture_output=True,
            text=True,
        )
    else:
        result = strategy.run_as_postgres_user(
            ["psql", "-d", "postgres", "-c", f"DROP DATABASE IF EXISTS {config.name}"],
            check=False,
        )

    if result.returncode != 0:
        warning(f"Could not drop database: {result.stderr}")
    else:
        success(f"Database '{config.name}' dropped")

    step(f"Dropping user '{config.user}'...")

    if is_macos(platform):
        result = subprocess.run(
            [
                "psql",
                "-h",
                config.host,
                "-p",
                str(config.port),
                "-d",
                "postgres",
                "-c",
                f"DROP ROLE IF EXISTS {config.user}",
            ],
            capture_output=True,
            text=True,
        )
    else:
        result = strategy.run_as_postgres_user(
            ["psql", "-d", "postgres", "-c", f"DROP ROLE IF EXISTS {config.user}"],
            check=False,
        )

    if result.returncode != 0:
        warning(f"Could not drop user: {result.stderr}")
    else:
        success(f"User '{config.user}' dropped")

    success("Teardown complete")


@app.command()
def reset() -> None:
    """Reset test database (teardown + setup)."""
    config = _get_config()

    if _check_database_in_use(config.name):
        raise typer.Exit(1)

    info("Resetting test database...")
    teardown()
    setup()


@app.command()
def env() -> None:
    """Output environment variables for shell export."""
    config = _get_config()

    console.print(f"export DATABASE_URL='{config.database_url}'")
    console.print(f"export SECRET_KEY='{config.secret_key}'")
    console.print(f"export TEST_DB_USER='{config.user}'")
    console.print(f"export TEST_DB_PASSWORD='{config.password}'")
    console.print(f"export TEST_DB_NAME='{config.name}'")
    console.print(f"export TEST_DB_HOST='{config.host}'")
    console.print(f"export TEST_DB_PORT='{config.port}'")
