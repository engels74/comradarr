#!/usr/bin/env bash
# tools/lint/no_future_annotations.sh — RULE-PY-002 gate.
#
# Forbids `from __future__ import annotations` anywhere under backend/src/comradarr/,
# backend/migrations/, or backend/tests/. PEP 649 (lazy annotations on Python 3.14)
# makes the __future__ import counterproductive (interaction caveats with deferred
# evaluation), and basedpyright `recommended` already infers identical semantics.
#
# Exit 0 — no offending imports.
# Exit 1 — at least one offender; offending lines are printed to stderr.
#
# Referenced by .omc/plans/phase-1-backend-skeleton.md Step 1.0 (R3 / C12 burndown)
# and by prek.toml / CI as a guard against accidental reintroduction.

set -euo pipefail

# Resolve repo root (the script lives at <root>/tools/lint/no_future_annotations.sh).
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"

cd "${repo_root}"

targets=(
  "backend/src/comradarr"
  "backend/migrations"
  "backend/tests"
)

# Only scan paths that exist — earlier phases may not have all three.
existing_targets=()
for t in "${targets[@]}"; do
  if [[ -e "${t}" ]]; then
    existing_targets+=("${t}")
  fi
done

if [[ ${#existing_targets[@]} -eq 0 ]]; then
  exit 0
fi

# `grep -RnE` returns 1 when no match; we invert with `!` so non-match is success.
# `--include='*.py'` + `--exclude-dir=__pycache__` + `--binary-files=without-match`
# scope the gate to *.py source files only — compiled .pyc bytecode legitimately
# embeds the literal `from __future__ import` substring (e.g. when a test file
# constructs the string at runtime to assert its absence elsewhere) and would
# otherwise produce a spurious match every time pytest's bytecode cache exists.
if matches=$(grep -RnE \
    --include='*.py' \
    --exclude-dir='__pycache__' \
    --binary-files='without-match' \
    'from __future__ import' "${existing_targets[@]}" 2>/dev/null); then
  printf 'forbidden: `from __future__ import` (RULE-PY-002)\n' >&2
  printf '%s\n' "${matches}" >&2
  exit 1
fi

exit 0
