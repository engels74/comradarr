"""Main menu screen for Comradarr Dev Tools."""

from typing import TYPE_CHECKING, ClassVar, override

from textual import work
from textual.binding import Binding, BindingType
from textual.containers import Horizontal, Vertical
from textual.screen import Screen
from textual.widgets import Footer, Header, Static

from cr_dev.tui.screens.dialogs import (
    CredentialsDialog,
    DatabaseSelectDialog,
    TextInputDialog,
)
from cr_dev.tui.services.command_runner import CommandRunner
from cr_dev.tui.services.process_manager import BackgroundProcessManager
from cr_dev.tui.widgets.credential_item import CredentialItem
from cr_dev.tui.widgets.menu import MenuItem, MenuSection
from cr_dev.tui.widgets.output_log import OutputLog
from cr_dev.tui.widgets.server_status import ServerStatusWidget
from cr_dev.tui.widgets.status_bar import StatusBar

if TYPE_CHECKING:
    from collections.abc import Callable

    from textual.app import ComposeResult

COMMAND_GROUP = "command"
DEV_SERVER_GROUP = "dev_server"


class MainMenuScreen(Screen[None]):
    """Main menu with all 14 options organized in sections."""

    process_manager: BackgroundProcessManager
    _output_poll_timer: object | None = None

    def __init__(
        self, name: str | None = None, id: str | None = None, classes: str | None = None
    ) -> None:
        super().__init__(name=name, id=id, classes=classes)
        self.process_manager = BackgroundProcessManager()
        self._output_poll_timer = None

    BINDINGS: ClassVar[list[BindingType]] = [
        # Arrow key navigation
        Binding("up,k", "focus_previous_menu_item", "Previous", show=False),
        Binding("down,j", "focus_next_menu_item", "Next", show=False),
        # Number keys FOCUS items (Enter/Space to execute)
        Binding("1", "focus_item_1", show=False),
        Binding("2", "focus_item_2", show=False),
        Binding("3", "focus_item_3", show=False),
        Binding("4", "focus_item_4", show=False),
        Binding("5", "focus_item_5", show=False),
        Binding("6", "focus_item_6", show=False),
        Binding("7", "focus_item_7", show=False),
        Binding("8", "focus_item_8", show=False),
        Binding("9", "focus_item_9", show=False),
        Binding("0", "focus_item_10", show=False),
        Binding("-", "focus_item_11", show=False),
        Binding("=", "focus_item_12", show=False),
        Binding("[", "focus_item_13", show=False),
        Binding("]", "focus_item_14", show=False),
        Binding("\\", "focus_item_15", show=False),
        Binding("ctrl+l", "clear_log", "Clear Log", show=False),
        Binding("c", "show_credentials", "Copy Creds", show=True),
    ]

    @override
    def compose(self) -> ComposeResult:
        """Compose the main menu screen."""
        yield Header()
        with Horizontal(id="main-container"):
            with Vertical(id="menu-panel"):
                yield ServerStatusWidget(id="server-status")
                yield MenuSection(
                    "Database Management",
                    [
                        ("1", "Install PostgreSQL"),
                        ("2", "Start PostgreSQL"),
                        ("3", "Stop PostgreSQL"),
                        ("4", "Check Status"),
                    ],
                )
                yield MenuSection(
                    "Test Database",
                    [
                        ("5", "Setup Test Database"),
                        ("6", "Teardown Test Database"),
                        ("7", "Reset Test Database"),
                    ],
                )
                yield MenuSection(
                    "Development Server",
                    [
                        ("8", "Start Dev Server (ephemeral)"),
                        ("9", "Start Dev Server (persistent)"),
                        ("10", "Reconnect to Dev Server"),
                        ("11", "Stop Dev Server"),
                    ],
                    id="dev-server-section",
                )
                yield MenuSection(
                    "Tests",
                    [
                        ("12", "Run All Tests"),
                        ("13", "Run Unit Tests"),
                        ("14", "Run Integration Tests"),
                    ],
                )
                yield MenuSection(
                    "Saved Databases",
                    [
                        ("15", "Manage Saved Databases"),
                    ],
                )
                yield Static(id="saved-dbs-hint")
            with Vertical(id="output-panel"):
                yield OutputLog(id="output-log")
        yield StatusBar(id="status-bar")
        yield Footer()

    def on_mount(self) -> None:
        """Handle mount event."""
        self._get_server_status().refresh_status()
        self._update_saved_dbs_hint()
        first_item = self.query_one("#menu-1", MenuItem)
        _ = first_item.focus()

    def on_screen_resume(self) -> None:
        """Handle screen resume - refresh state when returning from another screen."""
        self._get_server_status().refresh_status()
        self._update_saved_dbs_hint()

    def _start_output_polling(self) -> None:
        """Start polling the output buffer."""
        if self._output_poll_timer is None:
            self._output_poll_timer = self.set_interval(0.1, self._poll_output_buffer)

    def _stop_output_polling(self) -> None:
        """Stop polling the output buffer."""
        if self._output_poll_timer is not None:
            self._output_poll_timer.stop()  # pyright: ignore[reportUnknownMemberType,reportAttributeAccessIssue]
            self._output_poll_timer = None

    def _poll_output_buffer(self) -> None:
        """Poll the output buffer and update the log."""
        lines = self.process_manager.drain_output_buffer()
        if lines:
            _ = self._get_output_log().log_output_batch(lines)

    def _update_saved_dbs_hint(self) -> None:
        """Update the saved databases hint."""
        from cr_dev.core.state import list_saved_databases

        saved_dbs = list_saved_databases()
        hint = self.query_one("#saved-dbs-hint", Static)
        if saved_dbs:
            hint.update(f"[dim]Saved: {', '.join(saved_dbs)}[/dim]")
        else:
            hint.update("")

    def _get_output_log(self) -> OutputLog:
        """Get the output log widget."""
        return self.query_one("#output-log", OutputLog)

    def _get_status_bar(self) -> StatusBar:
        """Get the status bar widget."""
        return self.query_one("#status-bar", StatusBar)

    def _get_server_status(self) -> ServerStatusWidget:
        """Get the server status widget."""
        return self.query_one("#server-status", ServerStatusWidget)

    def _show_command_start(self, description: str) -> None:
        """Show immediate feedback when a command is starting."""
        status_bar = self._get_status_bar()
        output_log = self._get_output_log()
        _ = output_log.clear()
        status_bar.set_busy(description)
        _ = output_log.log_step(f"Starting: {description.rstrip('.')}")

    async def _run_command(
        self,
        description: str,
        command_func: Callable[..., object],
        *args: object,
        **kwargs: object,
    ) -> bool:
        """Run a command with loading indicator."""
        status_bar = self._get_status_bar()
        output_log = self._get_output_log()

        status_bar.set_busy(description)

        try:
            runner = CommandRunner(output_log)
            result = await runner.run_command(command_func, *args, **kwargs)
            return result
        finally:
            status_bar.set_ready()
            self._get_server_status().refresh_status()
            self._update_saved_dbs_hint()

    def on_menu_item_selected(self, event: MenuItem.Selected) -> None:
        """Handle menu item selection."""
        key = event.item.key
        action_name = f"option_{key}"
        action_method = getattr(self, f"action_{action_name}", None)
        if action_method:
            action_method()

    def action_clear_log(self) -> None:
        """Clear the output log."""
        _ = self._get_output_log().clear()

    def action_focus_previous_menu_item(self) -> None:
        """Focus the previous menu item."""
        _ = self.focus_previous(MenuItem)

    def action_focus_next_menu_item(self) -> None:
        """Focus the next menu item."""
        _ = self.focus_next(MenuItem)

    def _focus_menu_item(self, key: str) -> None:
        """Focus a menu item by its key."""
        from textual.css.query import NoMatches

        try:
            item = self.query_one(f"#menu-{key}", MenuItem)
            _ = item.focus()
        except NoMatches:
            pass

    def action_focus_item_1(self) -> None:
        self._focus_menu_item("1")

    def action_focus_item_2(self) -> None:
        self._focus_menu_item("2")

    def action_focus_item_3(self) -> None:
        self._focus_menu_item("3")

    def action_focus_item_4(self) -> None:
        self._focus_menu_item("4")

    def action_focus_item_5(self) -> None:
        self._focus_menu_item("5")

    def action_focus_item_6(self) -> None:
        self._focus_menu_item("6")

    def action_focus_item_7(self) -> None:
        self._focus_menu_item("7")

    def action_focus_item_8(self) -> None:
        self._focus_menu_item("8")

    def action_focus_item_9(self) -> None:
        self._focus_menu_item("9")

    def action_focus_item_10(self) -> None:
        self._focus_menu_item("10")

    def action_focus_item_11(self) -> None:
        self._focus_menu_item("11")

    def action_focus_item_12(self) -> None:
        self._focus_menu_item("12")

    def action_focus_item_13(self) -> None:
        self._focus_menu_item("13")

    def action_focus_item_14(self) -> None:
        self._focus_menu_item("14")

    def action_focus_item_15(self) -> None:
        self._focus_menu_item("15")

    @property
    def _command_worker_running(self) -> bool:
        """Check if a short command worker is running (excludes dev server)."""
        return any(w.is_running and w.group == COMMAND_GROUP for w in self.workers)

    def _check_busy(self) -> bool:
        """Check if busy with a short command and notify user."""
        if self._command_worker_running:
            self.notify("A command is already running", severity="warning")
            return True
        return False

    def _check_dev_server_running(self) -> bool:
        """Check if dev server is already running."""
        if self.process_manager.dev_server_running:
            self.notify("Dev server is already running", severity="warning")
            return True
        return False

    def action_option_1(self) -> None:
        """Install PostgreSQL."""
        if self._check_busy():
            return
        self._show_command_start("Installing PostgreSQL...")
        _ = self._run_db_command("install", "Installing PostgreSQL...")

    def action_option_2(self) -> None:
        """Start PostgreSQL."""
        if self._check_busy():
            return
        self._show_command_start("Starting PostgreSQL...")
        _ = self._run_db_command("start", "Starting PostgreSQL...")

    def action_option_3(self) -> None:
        """Stop PostgreSQL."""
        if self._check_busy():
            return
        self._show_command_start("Stopping PostgreSQL...")
        _ = self._run_db_command("stop", "Stopping PostgreSQL...")

    def action_option_4(self) -> None:
        """Check Status."""
        if self._check_busy():
            return
        self._show_command_start("Checking status...")
        _ = self._run_db_command("status", "Checking status...")

    def action_option_5(self) -> None:
        """Setup Test Database."""
        if self._check_busy():
            return
        self._show_command_start("Setting up test database...")
        _ = self._run_db_command("setup", "Setting up test database...")

    def action_option_6(self) -> None:
        """Teardown Test Database."""
        if self._check_busy():
            return
        self._show_command_start("Tearing down test database...")
        _ = self._run_db_command("teardown", "Tearing down test database...")

    def action_option_7(self) -> None:
        """Reset Test Database."""
        if self._check_busy():
            return
        self._show_command_start("Resetting test database...")
        _ = self._run_db_command("reset", "Resetting test database...")

    def action_option_8(self) -> None:
        """Start Dev Server (ephemeral)."""
        if self._check_busy() or self._check_dev_server_running():
            return
        self._show_command_start("Starting dev server (ephemeral)...")
        _ = self._start_dev_server_async()

    def action_option_9(self) -> None:
        """Start Dev Server (persistent)."""
        if self._check_busy() or self._check_dev_server_running():
            return
        _ = self._prompt_for_persistent_dev()

    def action_option_10(self) -> None:
        """Reconnect to Dev Server."""
        if self._check_busy() or self._check_dev_server_running():
            return
        _ = self._prompt_for_reconnect()

    def action_option_11(self) -> None:
        """Stop Dev Server."""
        from cr_dev.core.process import is_process_running
        from cr_dev.core.state import load_state

        # Check if TUI is managing the server directly
        if self.process_manager.dev_server_running:
            self._show_command_start("Stopping dev server...")
            _ = self._stop_dev_server_async()
            return

        # Check for externally-spawned server via state file
        state = load_state()
        if state is not None and is_process_running(state.pid):
            self._show_command_start("Stopping dev server...")
            _ = self._stop_external_dev_server_async(state.pid)
            return

        self.notify("No dev server is running", severity="warning")

    def action_option_12(self) -> None:
        """Run All Tests."""
        if self._check_busy():
            return
        self._show_command_start("Running all tests...")
        _ = self._run_tests("all_tests", "Running all tests...")

    def action_option_13(self) -> None:
        """Run Unit Tests."""
        if self._check_busy():
            return
        self._show_command_start("Running unit tests...")
        _ = self._run_tests("unit", "Running unit tests...")

    def action_option_14(self) -> None:
        """Run Integration Tests."""
        if self._check_busy():
            return
        self._show_command_start("Running integration tests...")
        _ = self._run_tests("integration", "Running integration tests...")

    def action_option_15(self) -> None:
        """Manage Saved Databases."""
        _ = self.app.push_screen("db_management")  # pyright: ignore[reportUnknownMemberType]

    @work(exclusive=True, group=COMMAND_GROUP)
    async def _run_db_command(self, command: str, description: str) -> None:
        """Run a database command."""
        from cr_dev.commands import db

        command_map: dict[str, Callable[..., object]] = {
            "install": db.install,
            "start": db.start,
            "stop": db.stop,
            "status": db.status,
            "setup": db.setup,
            "teardown": db.teardown,
            "reset": db.reset,
        }

        func = command_map.get(command)
        if func:
            _ = await self._run_command(description, func)

    @work(exclusive=True, group=DEV_SERVER_GROUP)
    async def _start_dev_server_async(
        self,
        persist: bool = False,
        db_name: str | None = None,
        reconnect: str | None = None,
    ) -> None:
        """Start dev server using background process manager."""
        import asyncio

        from cr_dev.commands.dev import setup_dev_server
        from cr_dev.core.logging import set_textual_log
        from cr_dev.core.state import DevState, save_state

        status_bar = self._get_status_bar()
        output_log = self._get_output_log()

        set_textual_log(output_log)
        try:
            loop = asyncio.get_running_loop()
            setup_result = await loop.run_in_executor(
                None,
                lambda: setup_dev_server(
                    persist=persist,
                    db_name=db_name,
                    reconnect=reconnect,
                ),
            )
        finally:
            set_textual_log(None)

        if setup_result is None:
            status_bar.set_ready()
            _ = output_log.log_error("Failed to setup dev server")
            self._get_server_status().refresh_status()
            return

        started = self.process_manager.start_dev_server(
            cmd=setup_result.cmd,
            cwd=setup_result.project_root,
            env=setup_result.env,
            cleanup_callback=setup_result.cleanup_callback,
        )

        if started:
            self._start_output_polling()
            pid = self.process_manager.get_pid()
            if pid:
                state = DevState(
                    pid=pid,
                    port=setup_result.config.port,
                    db_name=setup_result.config.db_name or "",
                    db_password=setup_result.config.db_password,
                    db_port=setup_result.config.db_port,
                    secret_key=setup_result.config.secret_key,
                    admin_password=setup_result.config.admin_password,
                    persist_mode=setup_result.config.persist,
                    reconnect_mode=setup_result.config.reconnect,
                )
                save_state(state)
            status_bar.set_ready()
            self._get_server_status().refresh_status()
        else:
            # Clean up resources created during setup (DB, state file) on start failure
            from cr_dev.core.state import remove_state

            try:
                setup_result.cleanup_callback()
            except Exception as exc:
                _ = output_log.log_warning(f"Cleanup failed: {exc}")
            remove_state()

            status_bar.set_ready()
            _ = output_log.log_error("Failed to start dev server")
            self._get_server_status().refresh_status()

    @work(exclusive=True, group=DEV_SERVER_GROUP)
    async def _stop_dev_server_async(self) -> None:
        """Stop dev server using background process manager."""
        import asyncio

        status_bar = self._get_status_bar()
        output_log = self._get_output_log()

        self._stop_output_polling()

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self.process_manager.stop_dev_server)

        status_bar.set_ready()
        _ = output_log.log_success("Dev server stopped")
        self._get_server_status().refresh_status()
        self._update_saved_dbs_hint()

    @work(exclusive=True, group=DEV_SERVER_GROUP)
    async def _stop_external_dev_server_async(self, pid: int) -> None:
        """Stop an externally-spawned dev server by PID."""
        import asyncio

        from cr_dev.core.process import kill_process_tree
        from cr_dev.core.state import load_state, remove_state

        status_bar = self._get_status_bar()
        output_log = self._get_output_log()

        state = load_state()

        loop = asyncio.get_running_loop()
        success = await loop.run_in_executor(None, kill_process_tree, pid)

        if success:
            remove_state()
            _ = output_log.log_success("Dev server stopped")

            # Handle database cleanup for ephemeral mode
            if state and not state.persist_mode and not state.reconnect_mode:
                _ = output_log.log_step(
                    f"Cleaning up ephemeral database '{state.db_name}'..."
                )
                try:
                    from cr_dev.commands.stop import (
                        _drop_database,  # pyright: ignore[reportPrivateUsage]
                    )

                    _ = await loop.run_in_executor(
                        None, _drop_database, state.db_name, state.db_port
                    )
                    _ = output_log.log_success(f"Database '{state.db_name}' removed")
                except Exception as exc:
                    _ = output_log.log_warning(f"Database cleanup failed: {exc}")
        else:
            _ = output_log.log_error("Failed to stop dev server")

        status_bar.set_ready()
        self._get_server_status().refresh_status()
        self._update_saved_dbs_hint()

    @work(exclusive=True, group=COMMAND_GROUP)
    async def _run_tests(self, test_type: str, description: str) -> None:
        """Run tests."""
        from cr_dev.commands import test

        test_map: dict[str, Callable[..., object]] = {
            "all_tests": test.all_tests,
            "unit": test.unit,
            "integration": test.integration,
        }

        func = test_map.get(test_type)
        if func:
            _ = await self._run_command(description, func)

    @work(exclusive=True, group=COMMAND_GROUP)
    async def _prompt_for_persistent_dev(self) -> None:
        """Prompt for database name and start persistent dev server."""
        from cr_dev.commands.dev import validate_db_name

        result = await self.app.push_screen_wait(  # pyright: ignore[reportUnknownMemberType]
            TextInputDialog("Enter database name:")
        )
        if result.confirmed and result.value:
            if not validate_db_name(result.value):
                output_log = self._get_output_log()
                _ = output_log.log_error(
                    f"Invalid database name: '{result.value}'. Names must start with a letter or underscore, and contain only letters, numbers, and underscores (no dashes or special characters)."
                )
                return

            self._show_command_start(f"Starting dev server with '{result.value}'...")
            _ = self._start_dev_server_async(persist=True, db_name=result.value)

    @work(exclusive=True, group=COMMAND_GROUP)
    async def _prompt_for_reconnect(self) -> None:
        """Prompt for database selection and reconnect."""
        from cr_dev.core.state import list_saved_databases

        saved_dbs = list_saved_databases()
        if not saved_dbs:
            _ = self._get_output_log().log_error("No saved databases found")
            return

        selected = await self.app.push_screen_wait(DatabaseSelectDialog(saved_dbs))  # pyright: ignore[reportUnknownMemberType]
        if selected:
            self._show_command_start(f"Reconnecting to '{selected}'...")
            _ = self._start_dev_server_async(reconnect=selected)

    def action_show_credentials(self) -> None:
        """Show the credentials dialog."""
        server_status = self._get_server_status()
        if not server_status.server_running:
            self.notify("No dev server running", severity="warning")
            return

        database_url = server_status.get_database_url()
        _ = self.app.push_screen(  # pyright: ignore[reportUnknownMemberType]
            CredentialsDialog(
                admin_login="admin",
                admin_password=server_status.server_admin_password,
                db_password=server_status.server_db_password,
                database_url=database_url,
            )
        )

    def on_credential_item_copied(self, event: CredentialItem.Copied) -> None:
        """Handle credential copy events from ServerStatusWidget."""
        if event.success:
            self.notify(f"Copied {event.label} to clipboard", timeout=2)
        else:
            self.notify(
                f"Failed to copy {event.label}",
                severity="error",
                timeout=2,
            )
