# cr-dev

CLI tool for Comradarr development workflows: PostgreSQL management, test execution, and dev server lifecycle.

## Setup

Requires Python 3.14+ and [uv](https://docs.astral.sh/uv/).

```bash
uv sync --dev
```

## Commands

```bash
# Interactive TUI
uv run cr-dev menu

# Database management
uv run cr-dev db install|start|stop|status|setup|teardown|reset

# Development server
uv run cr-dev dev              # Ephemeral database
uv run cr-dev dev --persist    # Persistent database
uv run cr-dev stop

# Run tests
uv run cr-dev test all|unit|integration
```

## From Project Root

```bash
bun run test:db:setup    # Setup test database
bun run test             # Run all tests
```
