"""Test execution commands - all, unit, integration."""

import os
from pathlib import Path
from typing import Annotated

import typer

from cr_dev.core.config import TestDbConfig
from cr_dev.core.logging import (
    error,
    header,
    output,
    step,
    success,
    warning,
)
from cr_dev.core.platform import detect_platform, get_strategy
from cr_dev.core.process import run_streaming

app = typer.Typer(no_args_is_help=True)


def _get_project_root() -> Path:
    """Get the project root directory."""
    # test.py -> commands -> cr_dev -> src -> dev-cli -> project root
    return Path(__file__).parent.parent.parent.parent.parent


def _get_config() -> TestDbConfig:
    """Get test database configuration from environment or defaults."""
    return TestDbConfig(
        user=os.environ.get("TEST_DB_USER", "comradarr_test"),
        password=os.environ.get("TEST_DB_PASSWORD", "testpassword"),
        name=os.environ.get("TEST_DB_NAME", "comradarr_test"),
        host=os.environ.get("TEST_DB_HOST", "localhost"),
        port=int(os.environ.get("TEST_DB_PORT", "5432")),
    )


def _run_unit_tests(project_root: Path) -> int:
    """Run unit tests and return exit code."""
    header("Running Unit Tests")

    exit_code = run_streaming(
        ["bun", "run", "test:unit"],
        cwd=project_root,
        env=os.environ.copy(),
        on_output=output,
    )

    if exit_code == 0:
        success("Unit tests passed")
    else:
        error("Unit tests failed")

    return exit_code


def _run_integration_tests(project_root: Path, config: TestDbConfig) -> int:
    """Run integration tests and return exit code."""
    header("Running Integration Tests")

    env = os.environ.copy()
    env["DATABASE_URL"] = config.database_url
    env["SECRET_KEY"] = config.secret_key

    exit_code = run_streaming(
        ["bun", "test", "tests/integration"],
        cwd=project_root,
        env=env,
        on_output=output,
    )

    if exit_code == 0:
        success("Integration tests passed")
    else:
        error("Integration tests failed")

    return exit_code


def _setup_database(_config: TestDbConfig) -> bool:
    """Set up the test database if needed."""
    from cr_dev.commands.db import setup

    try:
        setup()
        return True
    except SystemExit as e:
        return e.code == 0


@app.command("all")
def all_tests(
    unit: Annotated[bool, typer.Option("--unit", help="Run only unit tests")] = False,
    integration: Annotated[
        bool, typer.Option("--integration", help="Run only integration tests")
    ] = False,
    skip_db: Annotated[
        bool, typer.Option("--skip-db", help="Skip database setup")
    ] = False,
    no_auto_install: Annotated[
        bool, typer.Option("--no-auto-install", help="Don't auto-install PostgreSQL")
    ] = False,
) -> None:
    """Run all tests (unit and integration)."""
    project_root = _get_project_root()
    config = _get_config()

    run_unit = not integration
    run_integration = not unit

    unit_exit_code = 0
    integration_exit_code = 0
    db_setup_failed = False

    if run_unit:
        unit_exit_code = _run_unit_tests(project_root)

    if run_integration:
        if not skip_db:
            platform = detect_platform()
            strategy = get_strategy(platform)

            if not strategy.is_postgres_running():
                if no_auto_install:
                    warning(
                        "PostgreSQL is not running and --no-auto-install was specified"
                    )
                    warning("Skipping integration tests")
                    db_setup_failed = True
                else:
                    step("Starting PostgreSQL...")
                    if not strategy.start_postgres_service():
                        warning(
                            "Failed to start PostgreSQL, skipping integration tests"
                        )
                        db_setup_failed = True

            if not db_setup_failed:
                step("Setting up test database...")
                if not _setup_database(config):
                    warning("Database setup failed, skipping integration tests")
                    db_setup_failed = True

        if not db_setup_failed:
            integration_exit_code = _run_integration_tests(project_root, config)

    header("Test Summary")

    if run_unit:
        if unit_exit_code == 0:
            success("Unit tests: passed")
        else:
            error("Unit tests: failed")

    if run_integration:
        if db_setup_failed:
            warning("Integration tests: skipped (DB setup failed)")
        elif integration_exit_code == 0:
            success("Integration tests: passed")
        else:
            error("Integration tests: failed")

    if unit_exit_code != 0:
        raise typer.Exit(1)
    elif integration_exit_code != 0:
        raise typer.Exit(2)
    elif db_setup_failed:
        raise typer.Exit(3)


@app.command()
def unit() -> None:
    """Run unit tests only."""
    project_root = _get_project_root()
    exit_code = _run_unit_tests(project_root)
    raise typer.Exit(exit_code)


@app.command()
def integration(
    skip_db: Annotated[
        bool, typer.Option("--skip-db", help="Skip database setup")
    ] = False,
) -> None:
    """Run integration tests only."""
    project_root = _get_project_root()
    config = _get_config()

    if not skip_db:
        step("Setting up test database...")
        if not _setup_database(config):
            error("Database setup failed")
            raise typer.Exit(1)

    exit_code = _run_integration_tests(project_root, config)
    raise typer.Exit(exit_code)
