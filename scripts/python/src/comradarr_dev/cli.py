"""Main CLI entrypoint using Typer."""

import typer
from rich.console import Console

from comradarr_dev import __version__
from comradarr_dev.commands import db, dev, stop, test

app = typer.Typer(
    name="comradarr-dev",
    help="Development tools for Comradarr - PostgreSQL management, test execution, and dev server lifecycle.",
    no_args_is_help=True,
)
console = Console()

app.add_typer(db.app, name="db", help="Database management commands")
app.add_typer(test.app, name="test", help="Test execution commands")
_ = app.command(name="dev")(dev.dev_command)
_ = app.command(name="stop")(stop.stop_command)


@app.command()
def menu() -> None:
    """Interactive menu interface."""
    from comradarr_dev.menu import run_menu

    run_menu()


_VERSION_OPTION = typer.Option(False, "--version", "-v", help="Show version")  # pyright: ignore[reportAny]


@app.callback(invoke_without_command=True)
def main(
    ctx: typer.Context,
    version: bool = _VERSION_OPTION,
) -> None:
    """Comradarr development tools."""
    if version:
        console.print(f"comradarr-dev v{__version__}")
        raise typer.Exit()

    if ctx.invoked_subcommand is None:
        console.print(ctx.get_help())


if __name__ == "__main__":
    app()
