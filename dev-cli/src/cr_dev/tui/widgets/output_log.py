"""Output log widget for displaying command output."""

from typing import ClassVar

from rich.text import Text
from textual.widgets import RichLog


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
