"""Interactive menu interface - Textual TUI launcher."""


def run_menu() -> None:
    """Run the interactive Textual TUI menu."""
    from cr_dev.tui.app import ComradarrDevApp

    app = ComradarrDevApp()
    app.run()
