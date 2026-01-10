"""Status bar widget for displaying current operation status."""

from typing import ClassVar, override

from textual.reactive import reactive
from textual.widgets import Static


class StatusBar(Static):
    """Status bar showing current operation and available actions."""

    DEFAULT_CSS: ClassVar[str] = """
    StatusBar {
        dock: bottom;
        height: 1;
        background: $surface-darken-2;
        padding: 0 1;
        color: $text;
    }
    """

    status: ClassVar[reactive[str]] = reactive("Ready")
    is_busy: ClassVar[reactive[bool]] = reactive(False)

    def __init__(
        self,
        *,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(name=name, id=id, classes=classes)

    @override
    def render(self) -> str:
        """Render the status bar."""
        if self.is_busy:
            return f"[bold yellow]⟳[/bold yellow] {self.status}"
        return f"[dim]{self.status}[/dim]"

    def set_busy(self, message: str) -> None:
        """Set the status bar to busy state."""
        self.status = message
        self.is_busy = True

    def set_ready(self, message: str = "Ready") -> None:
        """Set the status bar to ready state."""
        self.status = message
        self.is_busy = False
