"""Process management utilities."""

import os
import signal
import subprocess
import time
from collections.abc import Callable
from pathlib import Path


def is_process_running(pid: int) -> bool:
    """Check if a process with the given PID is running."""
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def kill_process_tree(pid: int, *, timeout: float = 10.0) -> bool:
    """Kill a process and all its children gracefully, then forcefully."""
    if not is_process_running(pid):
        return True

    try:
        os.kill(pid, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        return True

    start = time.monotonic()
    while is_process_running(pid) and (time.monotonic() - start) < timeout:
        time.sleep(0.1)

    if is_process_running(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass

    return not is_process_running(pid)


def find_process_on_port(port: int) -> int | None:
    """Find the PID of a process listening on the given port."""
    result = subprocess.run(
        ["lsof", "-t", "-i", f":{port}"],
        capture_output=True,
        text=True,
    )

    if result.returncode == 0 and result.stdout.strip():
        try:
            return int(result.stdout.strip().split("\n")[0])
        except ValueError:
            pass

    return None


def find_processes_by_pattern(pattern: str) -> list[int]:
    """Find PIDs of processes matching the given pattern."""
    result = subprocess.run(
        ["pgrep", "-f", pattern],
        capture_output=True,
        text=True,
    )

    if result.returncode == 0 and result.stdout.strip():
        pids: list[int] = []
        for line in result.stdout.strip().split("\n"):
            try:
                pids.append(int(line))
            except ValueError:
                continue
        return pids

    return []


def wait_for_port(port: int, *, timeout: float = 30.0) -> bool:
    """Wait for a port to become available (process listening)."""
    start = time.monotonic()
    while (time.monotonic() - start) < timeout:
        if find_process_on_port(port) is not None:
            return True
        time.sleep(0.5)
    return False


def is_port_in_use(port: int) -> bool:
    """Check if a port is in use."""
    return find_process_on_port(port) is not None


def run_command(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    check: bool = True,
    capture_output: bool = True,
) -> subprocess.CompletedProcess[str]:
    """Run a command with optional environment variables."""
    full_env = os.environ.copy()
    if env:
        full_env.update(env)

    return subprocess.run(
        cmd,
        cwd=cwd,
        env=full_env,
        capture_output=capture_output,
        text=True,
        check=check,
    )


def run_background(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    log_file: Path | None = None,
) -> subprocess.Popen[str]:
    """Run a command in the background."""
    full_env = os.environ.copy()
    if env:
        full_env.update(env)

    if log_file:
        log_handle = log_file.open("w")
        return subprocess.Popen(
            cmd,
            cwd=cwd,
            env=full_env,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )

    return subprocess.Popen(
        cmd,
        cwd=cwd,
        env=full_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
        start_new_session=True,
    )


def run_streaming(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    on_output: Callable[[str], None] | None = None,
) -> int:
    """Run command with real-time output streaming.

    Args:
        cmd: Command and arguments to run
        cwd: Working directory for command
        env: Environment variables (merged with current env)
        on_output: Callback for each output line

    Returns:
        Exit code from the process
    """
    full_env = os.environ.copy()
    if env:
        full_env.update(env)

    process = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=full_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    if process.stdout and on_output:
        for line in process.stdout:
            on_output(line.rstrip("\n"))

    return process.wait()
