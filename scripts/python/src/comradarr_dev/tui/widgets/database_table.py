"""Database table widget for displaying saved databases."""

from datetime import datetime
from typing import ClassVar, override

from textual.widgets import DataTable


class DatabaseTable(DataTable[str]):
    """Table displaying saved databases with selection support."""

    DEFAULT_CSS: ClassVar[str] = """
    DatabaseTable {
        height: 100%;
        border: solid $primary;
        background: $surface-darken-1;
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
            name=name, id=id, classes=classes, cursor_type="row", zebra_stripes=True
        )
        self._db_names: list[str] = []

    @override
    def on_mount(self) -> None:
        """Set up the table on mount."""
        _ = self.add_columns("#", "Database Name", "Created", "Last Used")

    def refresh_data(self) -> list[str]:
        """Refresh the table with current saved databases. Returns list of db names."""
        from comradarr_dev.core.state import get_all_credentials_with_details

        _ = self.clear()
        self._db_names = []

        all_creds = get_all_credentials_with_details()
        if not all_creds:
            return []

        self._db_names = list(all_creds.keys())
        for i, (db_name, creds) in enumerate(all_creds.items(), 1):
            _ = self.add_row(
                str(i),
                db_name,
                self._format_timestamp(creds.saved_at),
                self._format_timestamp(creds.last_used),
                key=db_name,
            )

        return self._db_names

    def get_selected_database(self) -> str | None:
        """Get the currently selected database name."""
        cursor_row = self.cursor_row
        if self._db_names and 0 <= cursor_row < len(self._db_names):
            return self._db_names[cursor_row]
        return None

    def get_database_names(self) -> list[str]:
        """Get all database names in the table."""
        return self._db_names.copy()

    @staticmethod
    def _format_timestamp(iso_timestamp: str | None) -> str:
        """Format ISO timestamp for display."""
        if not iso_timestamp:
            return "Never"
        try:
            dt = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
            return dt.strftime("%Y-%m-%d %H:%M")
        except ValueError:
            return iso_timestamp
