"""Clickable credential item widget for copying values to clipboard."""

from typing import ClassVar, override

from rich.text import Text
from textual.binding import Binding, BindingType
from textual.message import Message
from textual.widget import Widget

from comradarr_dev.tui.utils.clipboard import copy_to_clipboard


class CredentialItem(Widget, can_focus=True):
    """A clickable credential display that copies its value to clipboard.

    Displays a label and value, and copies the value when clicked or
    when Enter/Space is pressed while focused.
    """

    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("enter", "copy", "Copy", show=False),
        Binding("space", "copy", "Copy", show=False),
    ]

    DEFAULT_CSS: ClassVar[str] = """
    CredentialItem {
        height: 1;
        padding: 0;
    }

    CredentialItem:hover {
        background: $primary 20%;
    }

    CredentialItem:focus {
        background: $primary 40%;
    }
    """

    class Copied(Message):
        """Message sent when credential is copied to clipboard."""

        credential_item: CredentialItem
        label: str
        success: bool

        def __init__(
            self, credential_item: CredentialItem, label: str, *, success: bool
        ) -> None:
            self.credential_item = credential_item
            self.label = label
            self.success = success
            super().__init__()

    def __init__(
        self,
        label: str,
        value: str,
        *,
        show_value: bool = True,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        """Initialize the credential item.

        Args:
            label: The label to display (e.g., "Pass", "DB").
            value: The value to copy when clicked.
            show_value: Whether to show the value in the display.
            name: Optional widget name.
            id: Optional widget ID.
            classes: Optional CSS classes.
        """
        super().__init__(name=name, id=id, classes=classes)
        self._label: str = label
        self._value: str = value
        self._show_value: bool = show_value

    @property
    def value(self) -> str:
        """Get the credential value."""
        return self._value

    def update_value(self, value: str) -> None:
        """Update the credential value."""
        self._value = value
        _ = self.refresh()

    @override
    def render(self) -> Text:
        """Render the credential item."""
        if self._show_value:
            return Text.assemble(
                ("  ", ""),
                (f"{self._label}:", "dim"),
                (" ", ""),
                (self._value, "bold cyan" if self.has_focus else "cyan"),
                (" ", ""),
                ("📋" if self.has_focus else "", "dim"),
            )
        return Text.assemble(
            ("  ", ""),
            (f"{self._label}:", "dim"),
            (" ", ""),
            (self._value, ""),
        )

    def action_copy(self) -> None:
        """Copy the value to clipboard."""
        self._do_copy()

    def on_click(self) -> None:
        """Handle click event."""
        _ = self.focus()
        self._do_copy()

    def _do_copy(self) -> None:
        """Perform the copy operation and post a message."""
        if not self._value:
            return
        success = copy_to_clipboard(self._value)
        _ = self.post_message(self.Copied(self, self._label, success=success))
