"""Command runner service for async command execution."""

import asyncio
from collections.abc import Callable
from typing import TYPE_CHECKING

from comradarr_dev.core.logging import set_textual_log

if TYPE_CHECKING:
    from comradarr_dev.tui.widgets.output_log import OutputLog


class CommandRunner:
    """Service for running commands asynchronously with output capture."""

    output_log: OutputLog

    def __init__(self, output_log: OutputLog) -> None:
        self.output_log = output_log

    async def run_command(
        self,
        command_func: Callable[..., object],
        *args: object,
        **kwargs: object,
    ) -> bool:
        """Run a command function asynchronously.

        Routes output to the log widget via the logging context.

        Args:
            command_func: The command function to run
            *args: Positional arguments for the command
            **kwargs: Keyword arguments for the command

        Returns:
            True if command succeeded, False otherwise
        """
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                None,
                lambda: self._run_with_context(command_func, *args, **kwargs),
            )
            return True
        except SystemExit as e:
            return e.code == 0 if e.code is not None else True
        except Exception as e:
            _ = self.output_log.log_error(f"Command failed: {e}")
            return False

    def _run_with_context(
        self,
        command_func: Callable[..., object],
        *args: object,
        **kwargs: object,
    ) -> None:
        """Run command with logging context set."""
        set_textual_log(self.output_log)
        try:
            _ = command_func(*args, **kwargs)
        finally:
            set_textual_log(None)
