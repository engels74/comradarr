"""Main Textual application for Comradarr Dev Tools."""

from contextlib import suppress
from pathlib import Path
from typing import TYPE_CHECKING, ClassVar, override

from textual._path import CSSPathType
from textual.app import App
from textual.binding import Binding, BindingType

from comradarr_dev.tui.screens.database_management import DatabaseManagementScreen
from comradarr_dev.tui.screens.main_menu import MainMenuScreen

if TYPE_CHECKING:
    pass


class ComradarrDevApp(App[None]):
    """Comradarr Development Tools TUI Application."""

    CSS_PATH: ClassVar[CSSPathType | None] = Path(__file__).parent / "styles.tcss"

    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("q", "quit", "Quit", show=True, priority=True),
        Binding("?", "toggle_help", "Help", show=True),
    ]

    def on_mount(self) -> None:
        """Initialize app and push main screen."""
        self.title = "Comradarr Dev Tools"  # pyright: ignore[reportUnannotatedClassAttribute]
        self.install_screen(MainMenuScreen(), name="main")  # pyright: ignore[reportUnknownMemberType]
        self.install_screen(DatabaseManagementScreen(), name="db_management")  # pyright: ignore[reportUnknownMemberType]
        _ = self.push_screen("main")

    @override
    async def action_quit(self) -> None:
        """Handle app quit with cleanup of running processes."""
        with suppress(Exception):
            main_screen = self.get_screen("main")  # pyright: ignore[reportUnknownVariableType,reportUnknownMemberType]
            if (
                isinstance(main_screen, MainMenuScreen)
                and main_screen.process_manager.dev_server_running
            ):
                main_screen.process_manager.stop_dev_server()
        self.exit()

    def action_toggle_help(self) -> None:
        """Toggle help display."""
        self.notify(
            "Keys: 1-9,0,-,=,[,],\\ for menu | ESC to go back | Q to quit",
            title="Help",
            timeout=5,
        )
