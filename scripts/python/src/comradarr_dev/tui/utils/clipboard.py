"""Clipboard utility for cross-platform copy support."""

import pyperclip


def copy_to_clipboard(text: str) -> bool:
    """Copy text to the system clipboard.

    Uses pyperclip for reliable cross-platform support across different
    terminal emulators (including macOS Terminal.app which doesn't support
    OSC 52 escape sequences).

    Args:
        text: The text to copy to the clipboard.

    Returns:
        True if the copy was successful, False otherwise.
    """
    try:
        pyperclip.copy(text)
        return True
    except Exception:
        return False
