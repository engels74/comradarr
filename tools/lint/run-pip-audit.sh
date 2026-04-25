#!/usr/bin/env bash
# tools/lint/run-pip-audit.sh
#
# Wraps `pip-audit --strict` for the Comradarr backend.
#
# Two adaptations of plan §5.0.2 step 8 / plan line 145
# (`uv run pip-audit --strict`) are documented as §3.1 deviations:
#
# 1. The local `comradarr` package is installed editable by `uv sync`.
#    `pip-audit --strict` would fail on it ("Dependency not found on PyPI"
#    for `comradarr 0.0.0`, and `--skip-editable` still fails under
#    `--strict`). We feed pip-audit the resolved requirements without the
#    local project (`uv export --no-emit-project`) plus `--disable-pip`
#    (which requires hashes — supplied by uv export) so pip-audit does not
#    try to spawn an ensurepip-using temp env (which fails on macOS+CPython
#    3.14.3 with SIGABRT).
#
# 2. `--ignore-vuln CVE-2026-3219` suppresses an unfixable CVE in pip
#    26.0.1, which is a transitive dependency of pip-audit (via pip-api).
#    Pip 26.0.1 is the latest available release; no upstream fix exists at
#    Phase 0 sign-off. This suppression is the temporary mitigation; F-11
#    in plan §7 tracks removal once a pip release ships a fix.
#
# This script is the single source of truth for the audit invocation; CI
# (.github/workflows/ci.yml) and the Definition of Done (README.md / plan
# §5) call this script rather than reproducing the flags inline.
set -euo pipefail

cd "$(dirname "$0")/../../backend"

# Suppressed CVEs (each must have a §3.1 deviation entry + follow-up):
#   CVE-2026-3219 — pip 26.0.1 transitive of pip-audit; no upstream fix; F-11.
SUPPRESSED_CVES=(
  "CVE-2026-3219"
)

ignore_args=()
for cve in "${SUPPRESSED_CVES[@]}"; do
  ignore_args+=("--ignore-vuln" "$cve")
done

uv export --no-emit-project --format requirements-txt 2>/dev/null \
  | uv run pip-audit --strict --disable-pip --requirement /dev/stdin "${ignore_args[@]}"
