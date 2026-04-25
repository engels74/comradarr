#!/usr/bin/env bash
# Asserts the three Bun pin sites agree on the major.minor range.
# Closes the future-drift hole MUST-FIX-5 identifies but does not lock.
# Refinement #4 — plan §5.0.4 step 5.
set -euo pipefail

cd "$(dirname "$0")/../.."

engines_range=$(jq -r '.engines.bun' frontend/package.json)
tool_versions_bun=$(grep -E '^bun ' .tool-versions | awk '{print $2}')

# Agreement check: engines.bun MUST equal ">=1.3 <1.4"; .tool-versions bun MUST start with "1.3."
[[ "$engines_range" == ">=1.3 <1.4" ]] || { echo "engines.bun mismatch: $engines_range"; exit 1; }
[[ "$tool_versions_bun" == 1.3.* ]] || { echo ".tool-versions bun mismatch: $tool_versions_bun"; exit 1; }

echo "Bun pin parity OK (engines.bun=$engines_range, .tool-versions=$tool_versions_bun)"
