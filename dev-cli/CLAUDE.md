# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is `cr-dev`, a Python CLI tool for Comradarr development workflows. It manages PostgreSQL databases, runs tests, and provides a dev server lifecycle with isolated databases. Built with Typer for CLI and Textual for TUI.

**Python 3.14 required** - Uses modern features like `slots=True` dataclasses, `TypeIs` for type narrowing, and pattern matching.

## Commands

### Development
```bash
# Install dependencies (uses uv)
uv sync --dev

# Run CLI directly
uv run cr-dev --help

# Run the interactive TUI menu
uv run cr-dev menu
```

### Type Checking & Linting
```bash
uv run basedpyright src tests
uv run ruff check src tests
uv run ruff format src tests
```

### Testing
```bash
# Run all tests
uv run pytest

# Run single test file
uv run pytest tests/test_config.py

# Run specific test
uv run pytest tests/test_config.py::TestDevConfig::test_default_port

# With coverage
uv run pytest --cov=src
```

## Architecture

### CLI Structure (`src/cr_dev/`)

```
cli.py          # Main Typer app with subcommands
menu.py         # Launches Textual TUI
commands/       # CLI command modules
  db.py         # Database: install, start, stop, status, setup, teardown, reset, env
  dev.py        # Dev server: ephemeral/persistent/reconnect modes
  test.py       # Test runner: all, unit, integration
  stop.py       # Graceful dev server shutdown
```

### Core Layer (`core/`)

- **config.py** - `TestDbConfig` and `DevConfig` dataclasses with auto-generated secrets
- **platform.py** - Platform detection with strategy pattern (`MacOSStrategy`, `LinuxStrategy`)
- **state.py** - State persistence via `/tmp/cr-dev-state.json` and credentials in `.cr-dev-dbs.json`
- **process.py** - Process management utilities
- **logging.py** - Console output helpers compatible with both CLI and TUI modes

### TUI Layer (`tui/`)

- **app.py** - Main Textual `App` with screen management
- **screens/main_menu.py** - 15-item menu with keyboard shortcuts (1-9, 0, -, =, [, ], \)
- **screens/database_management.py** - Saved database management
- **services/process_manager.py** - Background process handling for dev server
- **widgets/** - Custom widgets: menu items, output log, server status, status bar

### Key Patterns

**Platform Strategy**: `detect_platform()` returns a `Platform` dataclass, then `get_strategy()` returns the appropriate `MacOSStrategy` (Homebrew-based) or `LinuxStrategy` (apt/systemd-based).

**Dev Server Modes**:
- Ephemeral: Creates random `comradarr_dev_XXXXXXXX` database, dropped on exit
- Persistent: Named database preserved across sessions, credentials saved
- Reconnect: Reuses saved credentials to reconnect to existing database

**TUI/CLI Dual Mode**: `core/logging.py` detects whether output should go to Rich console or Textual's output widget via `get_textual_log()`.

## Configuration

All tooling configured in `pyproject.toml`:
- **basedpyright**: `typeCheckingMode = "recommended"`, `pythonVersion = "3.14"`
- **ruff**: Line length 88, rules include E4/E7/E9/F/I/B/UP/S/C4/RUF
- **pytest**: `--import-mode=importlib`, test paths in `tests/`, source in `src/`

## Dependencies

- **typer** - CLI framework
- **textual** - TUI framework
- **psycopg[binary]** - PostgreSQL driver for database management

Dev server commands shell out to `bun run dev` and `bunx drizzle-kit migrate` (parent project uses Bun).
