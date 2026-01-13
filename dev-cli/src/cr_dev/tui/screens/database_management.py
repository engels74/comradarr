"""Database management screen for Comradarr Dev Tools."""

from typing import TYPE_CHECKING, ClassVar, override

from textual import work
from textual.binding import Binding, BindingType
from textual.containers import Horizontal, Vertical
from textual.screen import Screen
from textual.widgets import Footer, Header, Static

from cr_dev.tui.screens.dialogs import ConfirmDialog, StopAndDeleteDialog
from cr_dev.tui.services.command_runner import CommandRunner
from cr_dev.tui.widgets.database_table import DatabaseTable
from cr_dev.tui.widgets.menu import MenuItem, MenuSection
from cr_dev.tui.widgets.output_log import OutputLog
from cr_dev.tui.widgets.status_bar import StatusBar

if TYPE_CHECKING:
    from collections.abc import Callable

    from textual.app import ComposeResult


class DatabaseManagementScreen(Screen[None]):
    """Submenu for managing saved databases."""

    BINDINGS: ClassVar[list[BindingType]] = [
        # Arrow key navigation
        Binding("up,k", "focus_previous_menu_item", "Previous", show=False),
        Binding("down,j", "focus_next_menu_item", "Next", show=False),
        # Number keys FOCUS items (Enter/Space to execute)
        Binding("1", "focus_item_1", show=False),
        Binding("2", "focus_item_2", show=False),
        Binding("3", "focus_item_3", show=False),
        # Navigation shortcuts (execute immediately)
        Binding("escape", "go_back", "Back", show=True),
        Binding("b", "go_back", "Back", show=False),
        Binding("ctrl+l", "clear_log", "Clear Log", show=False),
        Binding("ctrl+y", "copy_output_log", "Copy Log", show=True),
    ]

    @override
    def compose(self) -> ComposeResult:
        """Compose the database management screen."""
        yield Header()
        with Horizontal(id="main-container"):
            with Vertical(id="menu-panel"):
                yield MenuSection(
                    "Manage Saved Databases",
                    [
                        ("1", "List all databases with details"),
                        ("2", "Delete a saved database"),
                        ("3", "Delete all saved databases"),
                    ],
                )
                yield MenuSection(
                    "Navigation",
                    [
                        ("b", "Back to main menu"),
                    ],
                    id="nav-section",
                )
            with Vertical(id="output-panel"):
                yield Static("[bold cyan]Saved Databases[/bold cyan]", id="table-title")
                yield DatabaseTable(id="db-table")
                yield OutputLog(id="output-log")
        yield StatusBar(id="status-bar")
        yield Footer()

    def on_mount(self) -> None:
        """Handle mount event."""
        _ = self._refresh_table()
        first_item = self.query_one("#menu-1", MenuItem)
        _ = first_item.focus()

    def _get_output_log(self) -> OutputLog:
        """Get the output log widget."""
        return self.query_one("#output-log", OutputLog)

    def _get_status_bar(self) -> StatusBar:
        """Get the status bar widget."""
        return self.query_one("#status-bar", StatusBar)

    def _get_db_table(self) -> DatabaseTable:
        """Get the database table widget."""
        return self.query_one("#db-table", DatabaseTable)

    def _refresh_table(self) -> list[str]:
        """Refresh the database table."""
        return self._get_db_table().refresh_data()

    def action_go_back(self) -> None:
        """Go back to the main menu."""
        _ = self.app.pop_screen()  # pyright: ignore[reportUnknownMemberType]

    def action_clear_log(self) -> None:
        """Clear the output log."""
        _ = self._get_output_log().clear()

    def action_copy_output_log(self) -> None:
        """Copy all output log content to clipboard."""
        from cr_dev.tui.widgets.output_log import CopyResult

        output_log = self._get_output_log()
        match output_log.copy_all():
            case CopyResult.SUCCESS:
                self.notify("Copied log to clipboard", timeout=2)
            case CopyResult.EMPTY:
                self.notify("No log content to copy", severity="warning", timeout=2)
            case CopyResult.CLIPBOARD_FAILED:
                self.notify("Failed to copy to clipboard", severity="error", timeout=2)

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

    def on_menu_item_selected(self, event: MenuItem.Selected) -> None:
        """Handle menu item selection (Enter/Space on focused item)."""
        key = event.item.key
        action_map: dict[str, Callable[[], None]] = {
            "1": self.action_list_databases,
            "2": self.action_delete_database,
            "3": self.action_delete_all_databases,
            "b": self.action_go_back,
        }
        action = action_map.get(key)
        if action:
            action()

    def action_list_databases(self) -> None:
        """List all databases with details."""
        output_log = self._get_output_log()
        db_names = self._refresh_table()

        if db_names:
            _ = output_log.log_info(f"Found {len(db_names)} saved database(s)")
        else:
            _ = output_log.log_warning("No saved databases found")

    def action_delete_database(self) -> None:
        """Delete a selected database."""
        db_table = self._get_db_table()
        output_log = self._get_output_log()

        db_names = db_table.get_database_names()
        if not db_names:
            _ = output_log.log_warning("No databases to delete")
            return

        selected_db = db_table.get_selected_database()
        if not selected_db:
            _ = output_log.log_warning("Please select a database from the table first")
            _ = db_table.focus()
            return

        _ = self._confirm_and_delete(selected_db)

    def action_delete_all_databases(self) -> None:
        """Delete all saved databases."""
        db_table = self._get_db_table()
        output_log = self._get_output_log()

        db_names = db_table.get_database_names()
        if not db_names:
            _ = output_log.log_warning("No databases to delete")
            return

        _ = self._confirm_and_delete_all(db_names)

    @work(exclusive=True)
    async def _confirm_and_delete(self, db_name: str) -> None:
        """Confirm and delete a database."""
        from cr_dev.core.state import is_database_in_use

        output_log = self._get_output_log()

        in_use, state = is_database_in_use(db_name)

        if in_use and state is not None:
            _ = output_log.write("")
            _ = output_log.log_warning(
                f"Database '{db_name}' is in use by dev server (PID: {state.pid})"
            )

            should_stop_and_delete = await self.app.push_screen_wait(  # pyright: ignore[reportUnknownMemberType]
                StopAndDeleteDialog(db_name, state.pid)
            )

            if should_stop_and_delete:
                await self._stop_server_and_delete(db_name)
            else:
                _ = output_log.log_info("Deletion cancelled")
            return

        _ = output_log.write("")
        _ = output_log.log_warning(f"About to delete: {db_name}")
        _ = output_log.write("  - Drop the PostgreSQL database")
        _ = output_log.write("  - Drop the PostgreSQL role")
        _ = output_log.write("  - Remove saved credentials")

        confirmed = await self.app.push_screen_wait(  # pyright: ignore[reportUnknownMemberType]
            ConfirmDialog(
                f"Are you sure you want to delete '{db_name}'?",
                default=False,
            )
        )

        if confirmed:
            await self._delete_database(db_name)
        else:
            _ = output_log.log_info("Deletion cancelled")

    @work(exclusive=True)
    async def _confirm_and_delete_all(self, db_names: list[str]) -> None:
        """Confirm and delete all databases."""
        from cr_dev.core.state import is_database_in_use

        output_log = self._get_output_log()

        # Show warning with list of all databases
        _ = output_log.write("")
        _ = output_log.log_warning(f"About to delete {len(db_names)} database(s):")
        for db_name in db_names:
            _ = output_log.write(f"  - {db_name}")
        _ = output_log.write("")
        _ = output_log.write("For each database:")
        _ = output_log.write("  - Drop the PostgreSQL database")
        _ = output_log.write("  - Drop the PostgreSQL role")
        _ = output_log.write("  - Remove saved credentials")

        # Show confirmation dialog
        confirmed = await self.app.push_screen_wait(  # pyright: ignore[reportUnknownMemberType]
            ConfirmDialog(
                f"Are you sure you want to delete ALL {len(db_names)} saved databases?",
                default=False,
            )
        )

        if not confirmed:
            _ = output_log.log_info("Deletion cancelled")
            return

        # Process each database
        deleted_count = 0
        skipped_count = 0

        for db_name in db_names:
            in_use, state = is_database_in_use(db_name)

            if in_use and state is not None:
                _ = output_log.write("")
                _ = output_log.log_warning(
                    f"Database '{db_name}' is in use by dev server (PID: {state.pid})"
                )

                should_stop_and_delete = await self.app.push_screen_wait(  # pyright: ignore[reportUnknownMemberType]
                    StopAndDeleteDialog(db_name, state.pid)
                )

                if should_stop_and_delete:
                    await self._stop_server_and_delete(db_name)
                    deleted_count += 1
                else:
                    _ = output_log.log_info(f"Skipped '{db_name}'")
                    skipped_count += 1
            else:
                await self._delete_database(db_name)
                deleted_count += 1

        # Final summary
        _ = output_log.write("")
        if deleted_count > 0:
            _ = output_log.log_success(f"Deleted {deleted_count} database(s)")
        if skipped_count > 0:
            _ = output_log.log_info(f"Skipped {skipped_count} database(s)")

    async def _stop_server_and_delete(self, db_name: str) -> None:
        """Stop the dev server and delete the database."""
        from cr_dev.commands import stop

        status_bar = self._get_status_bar()
        output_log = self._get_output_log()
        runner = CommandRunner(output_log)

        status_bar.set_busy("Stopping dev server...")
        _ = output_log.log_step("Stopping dev server first...")

        try:
            _ = await runner.run_command(stop.stop_command)
            _ = output_log.log_success("Dev server stopped")
        except Exception as e:
            _ = output_log.log_error(f"Failed to stop server: {e}")
            status_bar.set_ready()
            return

        await self._delete_database(db_name)

    async def _delete_database(self, db_name: str) -> None:
        """Delete a database."""
        from cr_dev.commands.dev import drop_database
        from cr_dev.core.platform import detect_platform, get_strategy
        from cr_dev.core.state import remove_credentials

        status_bar = self._get_status_bar()
        output_log = self._get_output_log()
        runner = CommandRunner(output_log)

        status_bar.set_busy(f"Deleting '{db_name}'...")

        try:
            platform = detect_platform()
            strategy = get_strategy(platform)

            if not strategy.is_postgres_running():
                _ = output_log.log_warning(
                    "PostgreSQL is not running. Only removing credentials."
                )
                remove_credentials(db_name)
                _ = output_log.log_success(f"Credentials for '{db_name}' removed")
            else:

                def do_drop() -> None:
                    _ = drop_database(db_name, 5432, strategy)
                    remove_credentials(db_name)

                _ = await runner.run_command(do_drop)
                _ = output_log.log_success(f"Database '{db_name}' deleted")

            _ = self._refresh_table()
        except Exception as e:
            _ = output_log.log_error(f"Failed to delete database: {e}")
        finally:
            status_bar.set_ready()
