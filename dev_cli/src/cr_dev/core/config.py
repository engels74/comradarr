"""Configuration dataclasses for development tools."""

import secrets
from dataclasses import dataclass, field
from urllib.parse import quote_plus


def _generate_secret_key() -> str:
    """Generate a 32-byte hex secret key."""
    return secrets.token_hex(32)


def _generate_password(length: int = 24) -> str:
    """Generate a secure random password."""
    return secrets.token_urlsafe(length)


@dataclass(slots=True)
class TestDbConfig:
    """Configuration for test database."""

    user: str = "comradarr_test"
    password: str = "testpassword"  # noqa: S105
    name: str = "comradarr_test"
    host: str = "localhost"
    port: int = 5432
    secret_key: str = field(default_factory=_generate_secret_key)

    @property
    def database_url(self) -> str:
        """Generate DATABASE_URL connection string."""
        encoded_password = quote_plus(self.password)
        return f"postgres://{self.user}:{encoded_password}@{self.host}:{self.port}/{self.name}"


@dataclass(slots=True)
class DevConfig:
    """Configuration for development server."""

    port: int = 5173
    db_port: int = 5432
    db_name: str | None = None
    db_password: str = field(default_factory=_generate_password)
    admin_password: str = field(default_factory=_generate_password)
    secret_key: str = field(default_factory=_generate_secret_key)
    persist: bool = False
    reconnect: bool = False
    skip_auth: bool = False
    log_file: str | None = None

    @property
    def database_url(self) -> str:
        """Generate DATABASE_URL connection string."""
        if not self.db_name:
            msg = "db_name is required for database_url"
            raise ValueError(msg)
        encoded_password = quote_plus(self.db_password)
        return f"postgres://{self.db_name}:{encoded_password}@localhost:{self.db_port}/{self.db_name}"

    def generate_db_name(self) -> str:
        """Generate a random database name."""
        suffix = secrets.token_hex(4)
        return f"comradarr_dev_{suffix}"
