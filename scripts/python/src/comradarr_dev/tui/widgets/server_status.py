"""Server status widget for displaying dev server state."""

from typing import TYPE_CHECKING, ClassVar, override
from urllib.parse import quote_plus

from textual.containers import Vertical
from textual.reactive import reactive
from textual.widgets import Static

from comradarr_dev.tui.widgets.credential_item import CredentialItem

if TYPE_CHECKING:
    from textual.app import ComposeResult


class ServerStatusWidget(Vertical):
    """Widget displaying dev server running status."""

    DEFAULT_CSS: ClassVar[str] = """
    ServerStatusWidget {
        height: auto;
        margin-bottom: 1;
        border: solid $primary;
        padding: 0 1;
    }

    ServerStatusWidget > Static {
        height: 1;
    }

    ServerStatusWidget > CredentialItem {
        height: 1;
    }

    ServerStatusWidget.-running {
        border: solid $success;
    }

    ServerStatusWidget.-stopped {
        border: solid $surface-lighten-2;
    }
    """

    server_running: reactive[bool] = reactive(False)
    server_db_name: reactive[str] = reactive("")
    server_mode: reactive[str] = reactive("")
    server_pid: reactive[int] = reactive(0)
    server_db_password: reactive[str] = reactive("")
    server_admin_password: reactive[str] = reactive("")
    server_db_port: reactive[int] = reactive(5432)

    def __init__(
        self,
        *,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(name=name, id=id, classes=classes)
        self._title: Static | None = None
        self._line: Static | None = None
        self._db_line: Static | None = None
        self._mode_line: Static | None = None
        self._separator_line: Static | None = None
        self._creds_title: Static | None = None
        self._login_item: CredentialItem | None = None
        self._pass_item: CredentialItem | None = None
        self._db_pass_item: CredentialItem | None = None
        self._batch_update: bool = False

    @override
    def compose(self) -> ComposeResult:
        """Compose the server status widget."""
        yield Static("", id="server-status-title")
        yield Static("", id="server-status-line")
        yield Static("", id="server-status-db")
        yield Static("", id="server-status-mode")
        yield Static("", id="server-status-separator")
        yield Static("", id="server-status-creds-title")
        yield CredentialItem(
            "Admin", "admin", show_value=False, id="server-status-login"
        )
        yield CredentialItem("Admin Pass", "", id="server-status-pass")
        yield CredentialItem("DB Pass", "", id="server-status-db-pass")

    def on_mount(self) -> None:
        """Handle mount event."""
        self._title = self.query_one("#server-status-title", Static)
        self._line = self.query_one("#server-status-line", Static)
        self._db_line = self.query_one("#server-status-db", Static)
        self._mode_line = self.query_one("#server-status-mode", Static)
        self._separator_line = self.query_one("#server-status-separator", Static)
        self._creds_title = self.query_one("#server-status-creds-title", Static)
        self._login_item = self.query_one("#server-status-login", CredentialItem)
        self._pass_item = self.query_one("#server-status-pass", CredentialItem)
        self._db_pass_item = self.query_one("#server-status-db-pass", CredentialItem)
        self.refresh_status()

    def watch_server_running(self, value: bool) -> None:
        """React to server_running changes."""
        _ = self.set_class(value, "-running")
        _ = self.set_class(not value, "-stopped")
        if not self._batch_update:
            self._update_display()

    def watch_server_db_name(self, _value: str) -> None:
        """React to server_db_name changes."""
        if not self._batch_update:
            self._update_display()

    def watch_server_mode(self, _value: str) -> None:
        """React to server_mode changes."""
        if not self._batch_update:
            self._update_display()

    def watch_server_pid(self, _value: int) -> None:
        """React to server_pid changes."""
        if not self._batch_update:
            self._update_display()

    def watch_server_db_password(self, _value: str) -> None:
        """React to server_db_password changes."""
        if not self._batch_update:
            self._update_display()

    def watch_server_admin_password(self, _value: str) -> None:
        """React to server_admin_password changes."""
        if not self._batch_update:
            self._update_display()

    def watch_server_db_port(self, _value: int) -> None:
        """React to server_db_port changes."""
        if not self._batch_update:
            self._update_display()

    def get_database_url(self) -> str:
        """Get the full DATABASE_URL connection string."""
        if not self.server_db_name or not self.server_db_password:
            return ""
        encoded_password = quote_plus(self.server_db_password)
        return f"postgres://{self.server_db_name}:{encoded_password}@localhost:{self.server_db_port}/{self.server_db_name}"

    def _update_display(self) -> None:
        """Update the widget display based on current state."""
        if (
            self._title is None
            or self._line is None
            or self._db_line is None
            or self._mode_line is None
            or self._separator_line is None
            or self._creds_title is None
            or self._login_item is None
            or self._pass_item is None
            or self._db_pass_item is None
        ):
            return

        self._title.update("[bold cyan]Dev Server[/bold cyan]")

        if self.server_running:
            self._line.update("[bold green]●[/bold green] Running")
            self._db_line.update(f"[dim]Database:[/dim] {self.server_db_name}")
            self._mode_line.update(
                f"[dim]Mode:[/dim] {self.server_mode} [dim]|[/dim] [dim]PID:[/dim] {self.server_pid}"
            )
            self._db_line.display = True
            self._mode_line.display = True

            db_pass = str(self.server_db_password)
            admin_pass = str(self.server_admin_password)

            # Show credentials section if either credential is present
            has_creds = bool(db_pass) or bool(admin_pass)
            self._separator_line.update("[dim]──────────────────────────[/dim]")
            self._separator_line.display = has_creds
            self._creds_title.update("[dim]Credentials (click to copy)[/dim]")
            self._creds_title.display = has_creds

            if admin_pass:
                self._login_item.update_value("admin")
                self._login_item.display = True
                self._pass_item.update_value(admin_pass)
                self._pass_item.display = True
            else:
                self._login_item.display = False
                self._pass_item.display = False

            if db_pass:
                self._db_pass_item.update_value(db_pass)
                self._db_pass_item.display = True
            else:
                self._db_pass_item.display = False
        else:
            self._line.update("[dim]○[/dim] [dim]Stopped[/dim]")
            self._db_line.display = False
            self._mode_line.display = False
            self._separator_line.display = False
            self._creds_title.display = False
            self._login_item.display = False
            self._pass_item.display = False
            self._db_pass_item.display = False

    def refresh_status(self) -> None:
        """Refresh the status from the state file."""
        from comradarr_dev.core.process import is_process_running
        from comradarr_dev.core.state import load_state

        state = load_state()

        self._batch_update = True
        try:
            if state is None:
                self.server_running = False
                self.server_db_name = ""
                self.server_mode = ""
                self.server_pid = 0
                self.server_db_password = ""
                self.server_admin_password = ""
                self.server_db_port = 5432
            elif not is_process_running(state.pid):
                self.server_running = False
                self.server_db_name = ""
                self.server_mode = ""
                self.server_pid = 0
                self.server_db_password = ""
                self.server_admin_password = ""
                self.server_db_port = 5432
            else:
                self.server_running = True
                self.server_db_name = state.db_name
                self.server_pid = state.pid
                self.server_db_password = state.db_password
                self.server_admin_password = state.admin_password
                self.server_db_port = state.db_port

                if state.reconnect_mode:
                    self.server_mode = "Reconnect"
                elif state.persist_mode:
                    self.server_mode = "Persistent"
                else:
                    self.server_mode = "Ephemeral"
        finally:
            self._batch_update = False
            self._update_display()
