"""Background process manager for long-running processes like dev server."""

import os
import subprocess
import threading
from collections import deque
from contextlib import suppress
from pathlib import Path
from typing import TYPE_CHECKING

from comradarr_dev.core.state import remove_state

if TYPE_CHECKING:
    from collections.abc import Callable


class BackgroundProcessManager:
    """Manages long-running background processes like the dev server."""

    def __init__(self) -> None:
        self._dev_server_process: subprocess.Popen[str] | None = None
        self._output_thread: threading.Thread | None = None
        self._stop_event: threading.Event = threading.Event()
        self._cleanup_callback: Callable[[], None] | None = None
        self._output_buffer: deque[str] = deque(maxlen=1000)
        self._buffer_lock: threading.Lock = threading.Lock()

    @property
    def dev_server_running(self) -> bool:
        """Check if the dev server is currently running."""
        if self._dev_server_process is None:
            return False
        return self._dev_server_process.poll() is None

    def drain_output_buffer(self) -> list[str]:
        """Drain and return all buffered output lines (thread-safe)."""
        with self._buffer_lock:
            lines = list(self._output_buffer)
            self._output_buffer.clear()
            return lines

    def start_dev_server(
        self,
        cmd: list[str],
        cwd: Path,
        env: dict[str, str],
        cleanup_callback: Callable[[], None] | None = None,
    ) -> bool:
        """Start the dev server and buffer output for polling.

        Args:
            cmd: Command to run (e.g., ["bun", "run", "dev", "--port", "5173"])
            cwd: Working directory
            env: Environment variables
            cleanup_callback: Optional function to call when server stops

        Returns:
            True if started successfully, False otherwise
        """
        if self.dev_server_running:
            return False

        try:
            self._dev_server_process = subprocess.Popen(
                cmd,
                cwd=cwd,
                env={**os.environ, **env},
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            self._cleanup_callback = cleanup_callback
            self._stop_event.clear()
            self._output_buffer.clear()

            self._output_thread = threading.Thread(
                target=self._stream_output,
                daemon=True,
                name="dev-server-output",
            )
            self._output_thread.start()

            return True
        except Exception:
            self._dev_server_process = None
            return False

    def stop_dev_server(self, timeout: float = 10.0) -> None:
        """Stop the running dev server gracefully.

        Args:
            timeout: Seconds to wait before force killing
        """
        self._stop_event.set()

        if (
            self._dev_server_process is not None
            and self._dev_server_process.poll() is None
        ):
            self._dev_server_process.terminate()

        if self._output_thread is not None and self._output_thread.is_alive():
            self._output_thread.join(timeout=min(2.0, timeout))
        self._output_thread = None

        if self._dev_server_process is not None:
            try:
                _ = self._dev_server_process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                self._dev_server_process.kill()
                _ = self._dev_server_process.wait()

        if self._cleanup_callback is not None:
            with suppress(Exception):
                self._cleanup_callback()
            self._cleanup_callback = None

        self._dev_server_process = None
        remove_state()

    def _stream_output(self) -> None:
        """Stream subprocess output into the buffer (runs in background thread)."""
        if self._dev_server_process is None or self._dev_server_process.stdout is None:
            return

        stdout = self._dev_server_process.stdout

        with suppress(Exception):
            for line in stdout:
                if self._stop_event.is_set():
                    break
                with self._buffer_lock:
                    self._output_buffer.append(line.rstrip("\n"))

        if self._dev_server_process.poll() is not None:
            if self._cleanup_callback is not None:
                with suppress(Exception):
                    self._cleanup_callback()
                self._cleanup_callback = None

    def get_pid(self) -> int | None:
        """Get the PID of the running dev server process."""
        if self._dev_server_process is not None:
            return self._dev_server_process.pid
        return None
