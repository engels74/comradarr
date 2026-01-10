"""Platform detection and strategy pattern for OS-specific operations."""

import platform as stdlib_platform
import shutil
import subprocess
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Protocol, TypeIs


class OS(Enum):
    """Supported operating systems."""

    MACOS = "macos"
    LINUX = "linux"
    UNSUPPORTED = "unsupported"


class LinuxDistro(Enum):
    """Linux distribution families."""

    DEBIAN = "debian"
    UNKNOWN = "unknown"
    NONE = "none"


@dataclass(slots=True, frozen=True)
class Platform:
    """Detected platform information."""

    os: OS
    distro: LinuxDistro
    homebrew_postgres: str | None = None
    is_wsl: bool = False


def is_linux(p: Platform) -> TypeIs[Platform]:
    """Type narrowing for Linux platform checks."""
    return p.os == OS.LINUX


def is_macos(p: Platform) -> TypeIs[Platform]:
    """Type narrowing for macOS platform checks."""
    return p.os == OS.MACOS


def _detect_homebrew_postgres() -> str | None:
    """Detect installed Homebrew PostgreSQL formula."""
    if not shutil.which("brew"):
        return None

    for version in ["17", "16", "15", "14"]:
        formula = f"postgresql@{version}"
        result = subprocess.run(
            ["brew", "list", "--formula", formula],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return formula

    result = subprocess.run(
        ["brew", "list", "--formula", "postgresql"],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        return "postgresql"

    return None


def _detect_linux_distro() -> LinuxDistro:
    """Detect Linux distribution family from /etc/os-release."""
    os_release = Path("/etc/os-release")
    if not os_release.exists():
        return LinuxDistro.UNKNOWN

    content = os_release.read_text()
    id_like = ""
    distro_id = ""

    for line in content.splitlines():
        if line.startswith("ID_LIKE="):
            id_like = line.split("=", 1)[1].strip('"').lower()
        elif line.startswith("ID="):
            distro_id = line.split("=", 1)[1].strip('"').lower()

    debian_ids = {"debian", "ubuntu", "mint", "pop", "elementary", "kali", "raspbian"}

    if distro_id in debian_ids or any(d in id_like for d in debian_ids):
        return LinuxDistro.DEBIAN

    return LinuxDistro.UNKNOWN


def _detect_wsl() -> bool:
    """Detect if running under Windows Subsystem for Linux."""
    if stdlib_platform.system() != "Linux":
        return False

    version_file = Path("/proc/version")
    if version_file.exists():
        content = version_file.read_text().lower()
        if "microsoft" in content or "wsl" in content:
            return True

    return False


def detect_platform() -> Platform:
    """Detect the current platform and available tools."""
    system = stdlib_platform.system()

    match system:
        case "Darwin":
            return Platform(
                os=OS.MACOS,
                distro=LinuxDistro.NONE,
                homebrew_postgres=_detect_homebrew_postgres(),
            )
        case "Linux":
            return Platform(
                os=OS.LINUX,
                distro=_detect_linux_distro(),
                is_wsl=_detect_wsl(),
            )
        case _:
            return Platform(
                os=OS.UNSUPPORTED,
                distro=LinuxDistro.NONE,
            )


class PlatformStrategy(Protocol):
    """Protocol for platform-specific operations."""

    def install_postgres(self) -> bool:
        """Install PostgreSQL on this platform."""
        ...

    def start_postgres_service(self) -> bool:
        """Start the PostgreSQL service."""
        ...

    def stop_postgres_service(self) -> bool:
        """Stop the PostgreSQL service."""
        ...

    def is_postgres_running(self) -> bool:
        """Check if PostgreSQL is running."""
        ...

    def run_as_postgres_user(
        self, cmd: list[str], *, check: bool = True
    ) -> subprocess.CompletedProcess[str]:
        """Run a command as the postgres user."""
        ...


class MacOSStrategy:
    """Homebrew-based PostgreSQL management for macOS."""

    formula: str

    def __init__(self, formula: str) -> None:
        self.formula = formula

    def install_postgres(self) -> bool:
        """Install PostgreSQL via Homebrew."""
        result = subprocess.run(
            ["brew", "install", self.formula],
            capture_output=True,
            text=True,
        )
        return result.returncode == 0

    def start_postgres_service(self) -> bool:
        """Start PostgreSQL via brew services."""
        result = subprocess.run(
            ["brew", "services", "start", self.formula],
            capture_output=True,
            text=True,
        )
        return result.returncode == 0

    def stop_postgres_service(self) -> bool:
        """Stop PostgreSQL via brew services."""
        result = subprocess.run(
            ["brew", "services", "stop", self.formula],
            capture_output=True,
            text=True,
        )
        return result.returncode == 0

    def is_postgres_running(self) -> bool:
        """Check if PostgreSQL is running using pg_isready."""
        result = subprocess.run(
            ["pg_isready", "-q"],
            capture_output=True,
        )
        return result.returncode == 0

    def run_as_postgres_user(
        self, cmd: list[str], *, check: bool = True
    ) -> subprocess.CompletedProcess[str]:
        """Run command directly (no sudo needed on macOS with Homebrew)."""
        return subprocess.run(cmd, capture_output=True, text=True, check=check)


class LinuxStrategy:
    """apt/systemd-based PostgreSQL management for Linux."""

    use_systemd: bool

    def __init__(self, *, use_systemd: bool = True) -> None:
        self.use_systemd = use_systemd

    def install_postgres(self) -> bool:
        """Install PostgreSQL via apt."""
        result = subprocess.run(
            ["sudo", "apt-get", "install", "-y", "postgresql", "postgresql-contrib"],
            capture_output=True,
            text=True,
        )
        return result.returncode == 0

    def start_postgres_service(self) -> bool:
        """Start PostgreSQL service."""
        if self.use_systemd:
            result = subprocess.run(
                ["sudo", "systemctl", "start", "postgresql"],
                capture_output=True,
                text=True,
            )
        else:
            result = subprocess.run(
                ["sudo", "service", "postgresql", "start"],
                capture_output=True,
                text=True,
            )
        return result.returncode == 0

    def stop_postgres_service(self) -> bool:
        """Stop PostgreSQL service."""
        if self.use_systemd:
            result = subprocess.run(
                ["sudo", "systemctl", "stop", "postgresql"],
                capture_output=True,
                text=True,
            )
        else:
            result = subprocess.run(
                ["sudo", "service", "postgresql", "stop"],
                capture_output=True,
                text=True,
            )
        return result.returncode == 0

    def is_postgres_running(self) -> bool:
        """Check if PostgreSQL is running using pg_isready."""
        result = subprocess.run(
            ["pg_isready", "-q"],
            capture_output=True,
        )
        return result.returncode == 0

    def run_as_postgres_user(
        self, cmd: list[str], *, check: bool = True
    ) -> subprocess.CompletedProcess[str]:
        """Run command as postgres user via sudo."""
        full_cmd = ["sudo", "-n", "-u", "postgres", *cmd]
        return subprocess.run(full_cmd, capture_output=True, text=True, check=check)


def _has_systemd() -> bool:
    """Check if systemd is available."""
    return Path("/run/systemd/system").exists()


def get_strategy(p: Platform) -> PlatformStrategy:
    """Get the appropriate platform strategy."""
    match p:
        case Platform(os=OS.MACOS, homebrew_postgres=formula) if formula:
            return MacOSStrategy(formula)
        case Platform(os=OS.MACOS):
            return MacOSStrategy("postgresql@16")
        case Platform(os=OS.LINUX):
            return LinuxStrategy(use_systemd=_has_systemd())
        case _:
            msg = f"Unsupported platform: {p.os.value}"
            raise ValueError(msg)
