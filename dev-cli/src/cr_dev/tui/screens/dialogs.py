"""Modal dialog screens for user input and confirmation."""

from typing import TYPE_CHECKING, ClassVar, NamedTuple, override

from textual.binding import Binding, BindingType
from textual.containers import Horizontal, Vertical
from textual.screen import ModalScreen
from textual.widgets import Button, Input, Static

from cr_dev.tui.widgets.credential_item import CredentialItem

if TYPE_CHECKING:
    from textual.app import ComposeResult


class DialogResult(NamedTuple):
    """Result from dialog interactions."""

    confirmed: bool
    value: str = ""


class TextInputDialog(ModalScreen[DialogResult]):
    """Modal text input dialog."""

    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("escape", "cancel", "Cancel", show=False),
        # Arrow key navigation between buttons (when buttons are focused)
        Binding("left,h", "focus_previous_button", "Previous", show=False),
        Binding("right,l", "focus_next_button", "Next", show=False),
    ]

    DEFAULT_CSS: ClassVar[str] = """
    TextInputDialog {
        align: center middle;
    }

    TextInputDialog > Vertical {
        width: 60;
        height: auto;
        max-height: 20;
        padding: 1 2;
        background: $surface;
        border: thick $primary;
    }

    TextInputDialog Input {
        margin: 1 0;
    }

    TextInputDialog .dialog-buttons {
        height: auto;
        align: right middle;
        margin-top: 1;
    }

    TextInputDialog Button {
        margin-left: 1;
    }
    """

    prompt: str
    default: str

    def __init__(
        self,
        prompt: str,
        default: str = "",
        *,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(name=name, id=id, classes=classes)
        self.prompt = prompt
        self.default = default

    @override
    def compose(self) -> ComposeResult:
        """Compose the dialog."""
        with Vertical():
            yield Static(self.prompt, classes="dialog-prompt")
            yield Input(value=self.default, id="input")
            with Horizontal(classes="dialog-buttons"):
                yield Button("OK", variant="primary", id="ok")
                yield Button("Cancel", id="cancel")

    def on_mount(self) -> None:
        """Focus the input on mount."""
        _ = self.query_one(Input).focus()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "ok":
            value = self.query_one(Input).value
            _ = self.dismiss(DialogResult(True, value))
        else:
            _ = self.dismiss(DialogResult(False))

    def on_input_submitted(self, _event: Input.Submitted) -> None:
        """Handle Enter key in input."""
        value = self.query_one(Input).value
        _ = self.dismiss(DialogResult(True, value))

    def action_cancel(self) -> None:
        """Cancel the dialog."""
        _ = self.dismiss(DialogResult(False))

    def action_focus_previous_button(self) -> None:
        """Focus the previous button."""
        _ = self.focus_previous(Button)

    def action_focus_next_button(self) -> None:
        """Focus the next button."""
        _ = self.focus_next(Button)


class ConfirmDialog(ModalScreen[bool]):
    """Modal confirmation dialog."""

    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("escape", "deny", "No", show=False),
        Binding("n", "deny", "No", show=False),
        Binding("y", "confirm", "Yes", show=False),
        # Arrow key navigation between buttons
        Binding("left,h", "focus_previous_button", "Previous", show=False),
        Binding("right,l", "focus_next_button", "Next", show=False),
    ]

    DEFAULT_CSS: ClassVar[str] = """
    ConfirmDialog {
        align: center middle;
    }

    ConfirmDialog > Vertical {
        width: 60;
        height: auto;
        max-height: 20;
        padding: 1 2;
        background: $surface;
        border: thick $primary;
    }

    ConfirmDialog .dialog-message {
        margin-bottom: 1;
    }

    ConfirmDialog .dialog-buttons {
        height: auto;
        align: right middle;
        margin-top: 1;
    }

    ConfirmDialog Button {
        margin-left: 1;
    }
    """

    message: str
    default: bool

    def __init__(
        self,
        message: str,
        *,
        default: bool = False,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(name=name, id=id, classes=classes)
        self.message = message
        self.default = default

    @override
    def compose(self) -> ComposeResult:
        """Compose the dialog."""
        with Vertical():
            yield Static(self.message, classes="dialog-message")
            with Horizontal(classes="dialog-buttons"):
                yield Button(
                    "Yes",
                    variant="primary" if self.default else "default",
                    id="yes",
                )
                yield Button(
                    "No",
                    variant="default" if self.default else "primary",
                    id="no",
                )

    def on_mount(self) -> None:
        """Focus the default button."""
        button_id = "yes" if self.default else "no"
        _ = self.query_one(f"#{button_id}", Button).focus()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        _ = self.dismiss(event.button.id == "yes")

    def action_confirm(self) -> None:
        """Confirm the dialog."""
        _ = self.dismiss(True)

    def action_deny(self) -> None:
        """Deny the dialog."""
        _ = self.dismiss(False)

    def action_focus_previous_button(self) -> None:
        """Focus the previous button."""
        _ = self.focus_previous(Button)

    def action_focus_next_button(self) -> None:
        """Focus the next button."""
        _ = self.focus_next(Button)


class DatabaseSelectDialog(ModalScreen[str | None]):
    """Modal dialog for selecting a database from a list."""

    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("escape", "cancel", "Cancel", show=False),
        Binding("up,k", "cursor_up", "Up", show=False),
        Binding("down,j", "cursor_down", "Down", show=False),
        Binding("enter", "select_db", "Select", show=False),
    ]

    DEFAULT_CSS: ClassVar[str] = """
    DatabaseSelectDialog {
        align: center middle;
    }

    DatabaseSelectDialog > Vertical {
        width: 70;
        height: auto;
        max-height: 30;
        padding: 1 2;
        background: $surface;
        border: thick $primary;
    }

    DatabaseSelectDialog .dialog-prompt {
        margin-bottom: 1;
    }

    DatabaseSelectDialog .db-list {
        height: auto;
        max-height: 15;
        margin-bottom: 1;
    }

    DatabaseSelectDialog .db-item {
        padding: 0 1;
    }

    DatabaseSelectDialog .db-item.-selected {
        background: $primary;
        color: $background;
    }

    DatabaseSelectDialog .dialog-buttons {
        height: auto;
        align: right middle;
        margin-top: 1;
    }

    DatabaseSelectDialog Button {
        margin-left: 1;
    }
    """

    databases: list[str]
    _selected_index: int

    def __init__(
        self,
        databases: list[str],
        *,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(name=name, id=id, classes=classes)
        self.databases = databases
        self._selected_index = 0

    @override
    def compose(self) -> ComposeResult:
        """Compose the dialog."""
        with Vertical():
            yield Static("Select a database:", classes="dialog-prompt")
            with Vertical(classes="db-list"):
                for i, db_name in enumerate(self.databases):
                    yield Static(
                        f"  [{i + 1}] {db_name}",
                        classes="db-item",
                        id=f"db-{i}",
                    )
            with Horizontal(classes="dialog-buttons"):
                yield Button("Select", variant="primary", id="select")
                yield Button("Cancel", id="cancel")

    def on_mount(self) -> None:
        """Focus the first database item."""
        if self.databases:
            self._update_selection()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "select" and self.databases:
            _ = self.dismiss(self.databases[self._selected_index])
        else:
            _ = self.dismiss(None)

    def action_cursor_up(self) -> None:
        """Move cursor up."""
        if self._selected_index > 0:
            self._selected_index -= 1
            self._update_selection()

    def action_cursor_down(self) -> None:
        """Move cursor down."""
        if self._selected_index < len(self.databases) - 1:
            self._selected_index += 1
            self._update_selection()

    def action_select_db(self) -> None:
        """Select the current database."""
        if self.databases:
            _ = self.dismiss(self.databases[self._selected_index])

    def _update_selection(self) -> None:
        """Update the visual selection."""
        for i in range(len(self.databases)):
            item = self.query_one(f"#db-{i}", Static)
            if i == self._selected_index:
                _ = item.add_class("-selected")
            else:
                _ = item.remove_class("-selected")

    def action_cancel(self) -> None:
        """Cancel the dialog."""
        _ = self.dismiss(None)


class StopAndDeleteDialog(ModalScreen[bool]):
    """Modal dialog for stopping a dev server and deleting its database."""

    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("escape", "cancel", "Cancel", show=False),
        # Arrow key navigation between buttons
        Binding("left,h", "focus_previous_button", "Previous", show=False),
        Binding("right,l", "focus_next_button", "Next", show=False),
        # Keyboard shortcut for Stop & Delete
        Binding("s", "stop_and_delete", "Stop & Delete", show=False),
    ]

    DEFAULT_CSS: ClassVar[str] = """
    StopAndDeleteDialog {
        align: center middle;
    }

    StopAndDeleteDialog > Vertical {
        width: 70;
        height: auto;
        max-height: 20;
        padding: 1 2;
        background: $surface;
        border: thick $warning;
    }

    StopAndDeleteDialog .dialog-title {
        margin-bottom: 1;
        text-style: bold;
        color: $warning;
    }

    StopAndDeleteDialog .dialog-message {
        margin-bottom: 1;
    }

    StopAndDeleteDialog .dialog-buttons {
        height: auto;
        align: right middle;
        margin-top: 1;
    }

    StopAndDeleteDialog Button {
        margin-left: 1;
    }
    """

    db_name: str
    pid: int

    def __init__(
        self,
        db_name: str,
        pid: int,
        *,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(name=name, id=id, classes=classes)
        self.db_name = db_name
        self.pid = pid

    @override
    def compose(self) -> ComposeResult:
        """Compose the dialog."""
        with Vertical():
            yield Static("Database In Use", classes="dialog-title")
            yield Static(
                f"Database '[bold]{self.db_name}[/bold]' is in use by dev server (PID: {self.pid}).\n\nStop the server and delete this database?",
                classes="dialog-message",
            )
            with Horizontal(classes="dialog-buttons"):
                yield Button("Stop & Delete", variant="warning", id="stop-delete")
                yield Button("Cancel", variant="default", id="cancel")

    def on_mount(self) -> None:
        """Focus the cancel button by default."""
        _ = self.query_one("#cancel", Button).focus()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        _ = self.dismiss(event.button.id == "stop-delete")

    def action_cancel(self) -> None:
        """Cancel the dialog."""
        _ = self.dismiss(False)

    def action_focus_previous_button(self) -> None:
        """Focus the previous button."""
        _ = self.focus_previous(Button)

    def action_focus_next_button(self) -> None:
        """Focus the next button."""
        _ = self.focus_next(Button)

    def action_stop_and_delete(self) -> None:
        """Confirm stop and delete."""
        _ = self.dismiss(True)


class CredentialsDialog(ModalScreen[None]):
    """Modal dialog for viewing and copying all credentials."""

    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("escape", "close", "Close", show=False),
    ]

    DEFAULT_CSS: ClassVar[str] = """
    CredentialsDialog {
        align: center middle;
    }

    CredentialsDialog > Vertical {
        width: 80;
        height: auto;
        max-height: 25;
        padding: 1 2;
        background: $surface;
        border: thick $primary;
    }

    CredentialsDialog .dialog-title {
        margin-bottom: 1;
        text-style: bold;
        color: $primary;
    }

    CredentialsDialog .cred-row {
        height: auto;
        margin-bottom: 1;
    }

    CredentialsDialog .cred-label {
        width: 15;
        padding-right: 1;
    }

    CredentialsDialog .cred-value {
        width: 1fr;
    }

    CredentialsDialog .cred-button {
        width: auto;
        min-width: 8;
    }

    CredentialsDialog .dialog-buttons {
        height: auto;
        align: right middle;
        margin-top: 1;
    }

    CredentialsDialog Button {
        margin-left: 1;
    }

    CredentialsDialog .dialog-hint {
        margin-top: 1;
        color: $text-muted;
    }
    """

    admin_login: str
    admin_password: str
    db_password: str
    database_url: str

    def __init__(
        self,
        admin_login: str,
        admin_password: str,
        db_password: str,
        database_url: str,
        *,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(name=name, id=id, classes=classes)
        self.admin_login = admin_login
        self.admin_password = admin_password
        self.db_password = db_password
        self.database_url = database_url

    @override
    def compose(self) -> ComposeResult:
        """Compose the dialog."""
        with Vertical():
            yield Static("Credentials", classes="dialog-title")

            yield CredentialItem(
                "Admin Login",
                self.admin_login,
                id="cred-admin-login",
            )
            yield CredentialItem(
                "Admin Password",
                self.admin_password,
                id="cred-admin-pass",
            )
            yield CredentialItem(
                "DB Password",
                self.db_password,
                id="cred-db-pass",
            )
            yield CredentialItem(
                "DATABASE_URL",
                self.database_url,
                id="cred-db-url",
            )

            yield Static(
                "[dim]Click any row or press Enter/Space to copy[/dim]",
                classes="dialog-hint",
            )

            with Horizontal(classes="dialog-buttons"):
                yield Button("Close", variant="primary", id="close")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "close":
            _ = self.dismiss(None)

    def on_credential_item_copied(self, event: CredentialItem.Copied) -> None:
        """Handle credential copy events."""
        if event.success:
            self.notify(f"Copied {event.label} to clipboard", timeout=2)
        else:
            self.notify(
                f"Failed to copy {event.label}",
                severity="error",
                timeout=2,
            )

    def action_close(self) -> None:
        """Close the dialog."""
        _ = self.dismiss(None)
