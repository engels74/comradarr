"""Tests for platform detection."""

from unittest.mock import patch

import pytest

from comradarr_dev.core.platform import (
    OS,
    LinuxDistro,
    Platform,
    detect_platform,
    is_linux,
    is_macos,
)


class TestPlatformDetection:
    """Test platform detection functions."""

    def test_detect_macos(self):
        """Test macOS detection."""
        with patch("platform.system", return_value="Darwin"):
            with patch("shutil.which", return_value=None):
                platform = detect_platform()
                assert platform.os == OS.MACOS
                assert platform.distro == LinuxDistro.NONE

    def test_detect_linux(self):
        """Test Linux detection."""
        with patch("platform.system", return_value="Linux"):
            with patch("pathlib.Path.exists", return_value=False):
                platform = detect_platform()
                assert platform.os == OS.LINUX
                assert platform.distro == LinuxDistro.UNKNOWN

    def test_detect_unsupported(self):
        """Test unsupported platform detection."""
        with patch("platform.system", return_value="Windows"):
            platform = detect_platform()
            assert platform.os == OS.UNSUPPORTED


class TestTypeNarrowing:
    """Test type narrowing functions."""

    def test_is_linux_true(self):
        """Test is_linux returns True for Linux platform."""
        platform = Platform(os=OS.LINUX, distro=LinuxDistro.DEBIAN)
        assert is_linux(platform) is True

    def test_is_linux_false(self):
        """Test is_linux returns False for non-Linux platform."""
        platform = Platform(os=OS.MACOS, distro=LinuxDistro.NONE)
        assert is_linux(platform) is False

    def test_is_macos_true(self):
        """Test is_macos returns True for macOS platform."""
        platform = Platform(os=OS.MACOS, distro=LinuxDistro.NONE)
        assert is_macos(platform) is True

    def test_is_macos_false(self):
        """Test is_macos returns False for non-macOS platform."""
        platform = Platform(os=OS.LINUX, distro=LinuxDistro.DEBIAN)
        assert is_macos(platform) is False


class TestPlatformDataclass:
    """Test Platform dataclass."""

    def test_platform_slots(self):
        """Test that Platform uses slots."""
        platform = Platform(os=OS.MACOS, distro=LinuxDistro.NONE)
        assert hasattr(platform, "__slots__") or not hasattr(platform, "__dict__")

    def test_platform_frozen(self):
        """Test that Platform is frozen."""
        platform = Platform(os=OS.MACOS, distro=LinuxDistro.NONE)
        with pytest.raises(AttributeError):
            setattr(platform, "os", OS.LINUX)  # noqa: B010
