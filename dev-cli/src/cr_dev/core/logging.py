"""Rich console logging utilities with Textual integration."""

import contextvars
from typing import TYPE_CHECKING, Protocol

from rich.console import Console

if TYPE_CHECKING:
    from cr_dev.tui.widgets.output_log import OutputLog


class LogTarget(Protocol):
    """Protocol for log output targets."""

    def log_info(self, message: str) -> None: ...
    def log_success(self, message: str) -> None: ...
    def log_warning(self, message: str) -> None: ...
    def log_error(self, message: str) -> None: ...
    def log_step(self, message: str) -> None: ...
    def log_header(self, message: str) -> None: ...
    def log_output(self, line: str) -> None: ...


_textual_log: contextvars.ContextVar[OutputLog | None] = contextvars.ContextVar(
    "_textual_log", default=None
)

console = Console()


def set_textual_log(log_widget: OutputLog | None) -> None:
    """Set the Textual log widget for output routing."""
    _ = _textual_log.set(log_widget)


def get_textual_log() -> OutputLog | None:
    """Get the current Textual log widget."""
    return _textual_log.get()


def info(message: str) -> None:
    """Print an info message."""
    log = _textual_log.get()
    if log is not None:
        _ = log.log_info(message)
    else:
        console.print(f"[blue]i[/blue] {message}")


def success(message: str) -> None:
    """Print a success message."""
    log = _textual_log.get()
    if log is not None:
        _ = log.log_success(message)
    else:
        console.print(f"[green]✓[/green] {message}")


def warning(message: str) -> None:
    """Print a warning message."""
    log = _textual_log.get()
    if log is not None:
        _ = log.log_warning(message)
    else:
        console.print(f"[yellow]⚠[/yellow] {message}")


def error(message: str) -> None:
    """Print an error message."""
    log = _textual_log.get()
    if log is not None:
        _ = log.log_error(message)
    else:
        console.print(f"[red]✗[/red] {message}")


def step(message: str) -> None:
    """Print a step message."""
    log = _textual_log.get()
    if log is not None:
        _ = log.log_step(message)
    else:
        console.print(f"[cyan]→[/cyan] {message}")


def header(message: str) -> None:
    """Print a header message."""
    log = _textual_log.get()
    if log is not None:
        _ = log.log_header(message)
    else:
        console.print()
        console.print(f"[bold]{message}[/bold]")
        console.print("─" * len(message))


def output(line: str) -> None:
    """Print raw command output."""
    log = _textual_log.get()
    if log is not None:
        _ = log.log_output(line)
    else:
        console.print(line)
