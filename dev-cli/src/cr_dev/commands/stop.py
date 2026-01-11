"""Stop command for graceful dev server shutdown."""

import subprocess
from typing import Annotated

import typer

from cr_dev.core.logging import console, error, info, step, success, warning
from cr_dev.core.platform import detect_platform, get_strategy, is_macos
from cr_dev.core.process import (
    find_process_on_port,
    is_process_running,
    kill_process_tree,
)
from cr_dev.core.state import (
    load_state,
    remove_credentials,
    remove_state,
)


def _terminate_db_connections(db_name: str, db_port: int) -> None:
    """Terminate all connections to a database before dropping it."""
    platform = detect_platform()
    strategy = get_strategy(platform)

    terminate_sql = f"""
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '{db_name}' AND pid <> pg_backend_pid()
    """

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
                terminate_sql,
            ],
            capture_output=True,
            text=True,
        )
    else:
        _ = strategy.run_as_postgres_user(
            ["psql", "-p", str(db_port), "-d", "postgres", "-c", terminate_sql],
            check=False,
        )


def _drop_database(db_name: str, db_port: int) -> bool:
    """Drop database and user after terminating active connections."""
    platform = detect_platform()
    strategy = get_strategy(platform)

    # Terminate any active connections first
    _terminate_db_connections(db_name, db_port)

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
        _ = strategy.run_as_postgres_user(
            [
                "psql",
                "-p",
                str(db_port),
                "-d",
                "postgres",
                "-c",
                f"DROP DATABASE IF EXISTS {db_name}",
            ],
            check=False,
        )
        _ = strategy.run_as_postgres_user(
            [
                "psql",
                "-p",
                str(db_port),
                "-d",
                "postgres",
                "-c",
                f"DROP ROLE IF EXISTS {db_name}",
            ],
            check=False,
        )

    return True


def stop_command(
    force_cleanup: Annotated[
        bool,
        typer.Option(
            "--force-cleanup",
            "--clean-all",
            "--purge",
            help="Remove all resources including persistent databases",
        ),
    ] = False,
    status_only: Annotated[
        bool, typer.Option("--status", help="Check status without stopping")
    ] = False,
) -> None:
    """Stop dev server and cleanup resources."""
    state = load_state()

    if status_only:
        console.print()
        console.print("[bold]Dev Server Status[/bold]")

        if state:
            if is_process_running(state.pid):
                console.print(f"  [green]●[/green] Running (PID: {state.pid})")
                console.print(f"      Port: {state.port}")
                console.print(f"      Database: {state.db_name}")
                if state.persist_mode:
                    console.print("      Mode: persistent")
                elif state.reconnect_mode:
                    console.print("      Mode: reconnect")
                else:
                    console.print("      Mode: ephemeral")
            else:
                console.print(
                    "  [yellow]○[/yellow] State file exists but process not running"
                )
                console.print(f"      Stale state for database: {state.db_name}")
        else:
            pid = find_process_on_port(5173)
            if pid:
                console.print(
                    f"  [yellow]○[/yellow] Process found on port 5173 (PID: {pid})"
                )
                console.print("      No state file - may be orphaned")
            else:
                console.print("  [dim]○[/dim] Not running")

        return

    if not state:
        pid = find_process_on_port(5173)
        if pid:
            warning("No state file found, but process detected on port 5173")
            if typer.confirm("Kill process?"):
                step(f"Killing process {pid}...")
                if kill_process_tree(pid):
                    success("Process killed")
                else:
                    error("Failed to kill process")
        else:
            info("Dev server is not running")

        if force_cleanup:
            step("Looking for orphaned dev databases...")
            platform = detect_platform()
            strategy = get_strategy(platform)
            # Default port for force cleanup when no state is available
            default_port = 5432

            if is_macos(platform):
                result = subprocess.run(
                    [
                        "psql",
                        "-h",
                        "localhost",
                        "-p",
                        str(default_port),
                        "-d",
                        "postgres",
                        "-tAc",
                        "SELECT datname FROM pg_database WHERE datname LIKE 'comradarr_dev_%'",
                    ],
                    capture_output=True,
                    text=True,
                )
            else:
                result = strategy.run_as_postgres_user(
                    [
                        "psql",
                        "-p",
                        str(default_port),
                        "-d",
                        "postgres",
                        "-tAc",
                        "SELECT datname FROM pg_database WHERE datname LIKE 'comradarr_dev_%'",
                    ],
                    check=False,
                )

            if result.returncode == 0 and result.stdout.strip():
                databases = result.stdout.strip().split("\n")
                console.print(f"  Found {len(databases)} orphaned database(s)")

                for db in databases:
                    db = db.strip()
                    if db:
                        step(f"Dropping {db}...")
                        _ = _drop_database(db, default_port)
                        remove_credentials(db)
                        success(f"Dropped {db}")

        return

    if not is_process_running(state.pid):
        warning(f"Process {state.pid} is not running, cleaning up state")
        remove_state()

        if not state.persist_mode and not state.reconnect_mode:
            step(f"Cleaning up database '{state.db_name}'...")
            _ = _drop_database(state.db_name, state.db_port)
            success(f"Database '{state.db_name}' removed")
        elif force_cleanup:
            step(f"Force cleaning database '{state.db_name}'...")
            _ = _drop_database(state.db_name, state.db_port)
            remove_credentials(state.db_name)
            success(f"Database '{state.db_name}' removed")

        return

    step(f"Stopping dev server (PID: {state.pid})...")

    if kill_process_tree(state.pid):
        success("Dev server stopped")
    else:
        error("Failed to stop dev server")
        raise typer.Exit(1)

    remove_state()

    if not state.persist_mode and not state.reconnect_mode:
        step(f"Cleaning up ephemeral database '{state.db_name}'...")
        _ = _drop_database(state.db_name, state.db_port)
        success(f"Database '{state.db_name}' removed")
    elif force_cleanup:
        if typer.confirm(f"Remove persistent database '{state.db_name}'?"):
            step(f"Removing database '{state.db_name}'...")
            _ = _drop_database(state.db_name, state.db_port)
            remove_credentials(state.db_name)
            success(f"Database '{state.db_name}' removed")
        else:
            info(f"Database '{state.db_name}' preserved")
    else:
        info(f"Database '{state.db_name}' preserved (use --force-cleanup to remove)")
