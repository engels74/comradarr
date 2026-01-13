"""Output log widget for displaying command output."""

from enum import Enum
from typing import ClassVar

from rich.text import Text
from textual.widgets import RichLog


class CopyResult(Enum):
    """Result of a clipboard copy operation."""

    SUCCESS = "success"
    EMPTY = "empty"
    CLIPBOARD_FAILED = "clipboard_failed"


class OutputLog(RichLog):
    """Scrollable log widget for command output with Rich formatting."""

    DEFAULT_CSS: ClassVar[str] = """
    OutputLog {
        border: solid $primary;
        background: $surface-darken-1;
        scrollbar-background: $surface;
        scrollbar-color: $primary;
        scrollbar-color-hover: $primary-lighten-1;
        scrollbar-color-active: $primary-lighten-2;
    }
    """

    def __init__(
        self,
        *,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(
            highlight=True,
            markup=True,
            wrap=True,
            max_lines=1000,
            name=name,
            id=id,
            classes=classes,
        )

    def log_info(self, message: str) -> OutputLog:
        """Log an info message."""
        _ = self.write(f"[blue]i[/blue] {message}")
        return self

    def log_success(self, message: str) -> OutputLog:
        """Log a success message."""
        _ = self.write(f"[green]✓[/green] {message}")
        return self

    def log_warning(self, message: str) -> OutputLog:
        """Log a warning message."""
        _ = self.write(f"[yellow]⚠[/yellow] {message}")
        return self

    def log_error(self, message: str) -> OutputLog:
        """Log an error message."""
        _ = self.write(f"[red]✗[/red] {message}")
        return self

    def log_step(self, message: str) -> OutputLog:
        """Log a step message."""
        _ = self.write(f"[cyan]→[/cyan] {message}")
        return self

    def log_header(self, message: str) -> OutputLog:
        """Log a header message."""
        _ = self.write("")
        _ = self.write(f"[bold]{message}[/bold]")
        _ = self.write("─" * len(message))
        return self

    def log_output(self, line: str) -> OutputLog:
        """Log raw command output with ANSI escape code support."""
        text = Text.from_ansi(line)
        _ = self.write(text)
        return self

    def log_output_batch(self, lines: list[str]) -> OutputLog:
        """Log multiple lines of raw command output efficiently."""
        for line in lines:
            text = Text.from_ansi(line)
            _ = self.write(text)
        return self

    def get_all_text(self) -> str:
        """Extract all log content as plain text."""
        if not self.lines:
            return ""
        return "\n".join(strip.text.rstrip() for strip in self.lines)

    def copy_all(self) -> CopyResult:
        """Copy all log content to clipboard. Returns result indicating success or failure type."""
        from cr_dev.tui.utils import copy_to_clipboard

        text = self.get_all_text()
        if not text:
            return CopyResult.EMPTY
        if copy_to_clipboard(text):
            return CopyResult.SUCCESS
        return CopyResult.CLIPBOARD_FAILED
