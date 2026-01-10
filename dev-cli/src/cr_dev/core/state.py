"""State file management for dev server persistence."""

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

STATE_FILE = Path("/tmp/cr-dev-state.json")
CREDENTIALS_FILE = (
    Path(__file__).parent.parent.parent.parent.parent / ".cr-dev-dbs.json"
)


@dataclass(slots=True)
class DevState:
    """Runtime state for dev server."""

    version: str = "1.0"
    pid: int = 0
    port: int = 5173
    db_name: str = ""
    db_password: str = ""
    db_port: int = 5432
    secret_key: str = ""
    admin_password: str = ""
    persist_mode: bool = False
    reconnect_mode: bool = False
    log_file: str | None = None
    started_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())


def save_state(state: DevState) -> None:
    """Save dev server state to file."""
    _ = STATE_FILE.write_text(json.dumps(asdict(state), indent=2))


def load_state() -> DevState | None:
    """Load dev server state from file."""
    if not STATE_FILE.exists():
        return None

    try:
        raw_data: object = json.loads(STATE_FILE.read_text())  # pyright: ignore[reportAny]
        if not isinstance(raw_data, dict):
            return None
        data = cast(dict[str, object], raw_data)
        return DevState(
            version=str(data.get("version", "1.0")),
            pid=int(str(data.get("pid", 0))),
            port=int(str(data.get("port", 5173))),
            db_name=str(data.get("db_name", "")),
            db_password=str(data.get("db_password", "")),
            db_port=int(str(data.get("db_port", 5432))),
            secret_key=str(data.get("secret_key", "")),
            admin_password=str(data.get("admin_password", "")),
            persist_mode=bool(data.get("persist_mode", False)),
            reconnect_mode=bool(data.get("reconnect_mode", False)),
            log_file=str(data["log_file"]) if data.get("log_file") else None,
            started_at=str(data.get("started_at", "")),
        )
    except (json.JSONDecodeError, TypeError, ValueError, KeyError):
        return None


def remove_state() -> None:
    """Remove the state file."""
    if STATE_FILE.exists():
        STATE_FILE.unlink()


@dataclass(slots=True)
class SavedCredentials:
    """Saved credentials for a dev database."""

    password: str
    secret_key: str
    admin_password: str
    saved_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    last_used: str | None = None


def save_credentials(db_name: str, creds: SavedCredentials) -> None:
    """Save credentials for a database to the credentials file."""
    data: dict[str, dict[str, str]] = {}

    if CREDENTIALS_FILE.exists():
        try:
            loaded: object = json.loads(CREDENTIALS_FILE.read_text())  # pyright: ignore[reportAny]
            if isinstance(loaded, dict):
                data = cast(dict[str, dict[str, str]], loaded)
        except json.JSONDecodeError:
            pass

    data[db_name] = cast(dict[str, str], asdict(creds))
    _ = CREDENTIALS_FILE.write_text(json.dumps(data, indent=2))


def load_credentials(db_name: str) -> SavedCredentials | None:
    """Load saved credentials for a database and update last_used timestamp."""
    if not CREDENTIALS_FILE.exists():
        return None

    try:
        raw_data: object = json.loads(CREDENTIALS_FILE.read_text())  # pyright: ignore[reportAny]
        if not isinstance(raw_data, dict):
            return None
        data = cast(dict[str, object], raw_data)
        if db_name in data:
            cred_data = data[db_name]
            if isinstance(cred_data, dict):
                cred_dict = cast(dict[str, object], cred_data)
                last_used_raw = cred_dict.get("last_used")
                creds = SavedCredentials(
                    password=str(cred_dict.get("password", "")),
                    secret_key=str(cred_dict.get("secret_key", "")),
                    admin_password=str(cred_dict.get("admin_password", "")),
                    saved_at=str(cred_dict.get("saved_at", "")),
                    last_used=str(last_used_raw) if last_used_raw else None,
                )

                updated_creds = SavedCredentials(
                    password=creds.password,
                    secret_key=creds.secret_key,
                    admin_password=creds.admin_password,
                    saved_at=creds.saved_at,
                    last_used=datetime.now(UTC).isoformat(),
                )
                save_credentials(db_name, updated_creds)
                return updated_creds
    except (json.JSONDecodeError, TypeError, ValueError):
        pass

    return None


def remove_credentials(db_name: str) -> None:
    """Remove saved credentials for a database."""
    if not CREDENTIALS_FILE.exists():
        return

    try:
        raw_data: object = json.loads(CREDENTIALS_FILE.read_text())  # pyright: ignore[reportAny]
        if not isinstance(raw_data, dict):
            return
        data = cast(dict[str, object], raw_data)
        if db_name in data:
            del data[db_name]
            _ = CREDENTIALS_FILE.write_text(json.dumps(data, indent=2))
    except json.JSONDecodeError:
        pass


def list_saved_databases() -> list[str]:
    """List all saved database names."""
    if not CREDENTIALS_FILE.exists():
        return []

    try:
        raw_data: object = json.loads(CREDENTIALS_FILE.read_text())  # pyright: ignore[reportAny]
        if not isinstance(raw_data, dict):
            return []
        data = cast(dict[str, object], raw_data)
        return list(data.keys())
    except json.JSONDecodeError:
        return []


def get_all_credentials_with_details() -> dict[str, SavedCredentials]:
    """Get all saved databases with their full credential details."""
    if not CREDENTIALS_FILE.exists():
        return {}

    try:
        raw_data: object = json.loads(CREDENTIALS_FILE.read_text())  # pyright: ignore[reportAny]
        if not isinstance(raw_data, dict):
            return {}
        data = cast(dict[str, object], raw_data)

        result: dict[str, SavedCredentials] = {}
        for db_name, cred_data in data.items():
            if isinstance(cred_data, dict):
                cred_dict = cast(dict[str, object], cred_data)
                last_used_raw = cred_dict.get("last_used")
                result[db_name] = SavedCredentials(
                    password=str(cred_dict.get("password", "")),
                    secret_key=str(cred_dict.get("secret_key", "")),
                    admin_password=str(cred_dict.get("admin_password", "")),
                    saved_at=str(cred_dict.get("saved_at", "")),
                    last_used=str(last_used_raw) if last_used_raw else None,
                )
        return result
    except json.JSONDecodeError:
        return {}


def is_database_in_use(db_name: str) -> tuple[bool, DevState | None]:
    """Check if a database is currently being used by a running dev server.

    Returns a tuple of (is_in_use, state). The state is returned when the
    database is in use to provide context (PID, mode, etc.).
    """
    from cr_dev.core.process import is_process_running

    state = load_state()
    if state is None:
        return (False, None)

    if state.db_name != db_name:
        return (False, None)

    if not is_process_running(state.pid):
        return (False, None)

    return (True, state)
