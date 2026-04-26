#!/usr/bin/env bash
# tools/lint/check_alembic_clean.sh
#
# Asserts `alembic check` reports no diff between the model graph
# (Base.metadata under comradarr/db/models/__init__.py) and the latest
# Alembic revision on disk. A drift means somebody changed a model without
# updating the migration — the runtime would silently apply an outdated
# baseline to a fresh schema.
#
# Why this is a *manual-stage* prek hook (NOT auto-run on commit):
# * `alembic check` opens a live connection to DATABASE_URL and runs
#   autogenerate against it. That makes it slow + dependency-heavy
#   (a developer with no Postgres available would have every commit
#   blocked otherwise). Pre-commit needs to be fast.
# * The CI integration workflow (.github/workflows/integration.yaml)
#   already covers this gate via `tests/db/test_alembic_baseline.py`,
#   which exercises both `alembic check` (autogenerate empty diff) and
#   the upgrade/downgrade round-trip against the service container's
#   real Postgres 16.
# * The hook is therefore opt-in for developers who want a fast local
#   loop while editing models. Invoke explicitly:
#     prek run --hook-stage manual check_alembic_clean
#
# Run requirement: DATABASE_URL must point at a reachable Postgres that
# already holds the latest migration applied (otherwise `alembic check`
# would emit drift unrelated to the developer's edits). The simplest
# local setup is the one in `docs/runbook/postgres-roles.md` §"Local
# development setup".
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "check_alembic_clean: DATABASE_URL is not set" >&2
  echo "  This hook needs a live Postgres for alembic to introspect." >&2
  echo "  See docs/runbook/postgres-roles.md '§Local development setup'." >&2
  exit 1
fi

cd "$(dirname "$0")/../../backend"

# `alembic check` exits non-zero when autogenerate detects a diff. The
# `-x` exits the script on that failure; the explicit echo keeps the
# error visible above prek's own truncation.
if ! uv run alembic check; then
  echo "check_alembic_clean: drift detected between Base.metadata and HEAD revision." >&2
  echo "  Run \`uv run alembic revision --autogenerate -m '<change description>'\`," >&2
  echo "  hand-patch the partial-index / ENUM-ordering / DESC-index lines per" >&2
  echo "  plan §3 Milestone 7 step 24, then commit the new revision." >&2
  exit 1
fi
