"""Pytest configuration and fixtures."""

import pytest


@pytest.fixture
def mock_platform_macos(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mock platform detection for macOS."""
    import platform

    monkeypatch.setattr(platform, "system", lambda: "Darwin")


@pytest.fixture
def mock_platform_linux(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mock platform detection for Linux."""
    import platform

    monkeypatch.setattr(platform, "system", lambda: "Linux")
