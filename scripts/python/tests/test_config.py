"""Tests for configuration dataclasses."""

import pytest

from comradarr_dev.core.config import DevConfig, TestDbConfig


class TestTestDbConfig:
    """Test TestDbConfig dataclass."""

    def test_default_values(self):
        """Test default configuration values."""
        config = TestDbConfig()
        assert config.user == "comradarr_test"
        assert config.password == "testpassword"  # noqa: S105
        assert config.name == "comradarr_test"
        assert config.host == "localhost"
        assert config.port == 5432

    def test_database_url(self):
        """Test DATABASE_URL generation."""
        config = TestDbConfig()
        assert (
            config.database_url
            == "postgres://comradarr_test:testpassword@localhost:5432/comradarr_test"
        )

    def test_password_url_encoding(self):
        """Test that passwords with special chars are URL encoded."""
        config = TestDbConfig(password="pass@word!")  # noqa: S106
        assert "pass%40word%21" in config.database_url

    def test_secret_key_generated(self):
        """Test that secret key is auto-generated."""
        config = TestDbConfig()
        assert len(config.secret_key) == 64
        assert all(c in "0123456789abcdef" for c in config.secret_key)


class TestDevConfig:
    """Test DevConfig dataclass."""

    def test_default_port(self):
        """Test default dev server port."""
        config = DevConfig()
        assert config.port == 5173

    def test_generate_db_name(self):
        """Test database name generation."""
        config = DevConfig()
        name = config.generate_db_name()
        assert name.startswith("comradarr_dev_")
        assert len(name) == len("comradarr_dev_") + 8

    def test_password_auto_generated(self):
        """Test that passwords are auto-generated."""
        config = DevConfig()
        assert len(config.db_password) > 0
        assert len(config.admin_password) > 0

    def test_database_url_requires_name(self):
        """Test that database_url raises without db_name."""
        config = DevConfig()
        with pytest.raises(ValueError, match="db_name is required"):
            _ = config.database_url

    def test_database_url_with_name(self):
        """Test database_url with db_name set."""
        config = DevConfig(db_name="test_db", db_password="testpass")  # noqa: S106
        assert "test_db" in config.database_url
        assert "testpass" in config.database_url
