"""Behavioral gate: basedpyright rejects ``Secret[bytes]`` in a ``bytes`` sink.

Shells ``uv run basedpyright tests/typecheck/secret_misuse.py --outputjson``,
parses the JSON diagnostic stream, and asserts at least one **error**-severity
diagnostic with rule ``reportArgumentType`` (or its known-equivalent siblings)
on the misuse fixture. This is the static-typing defense-in-depth twin of the
runtime :meth:`Secret.__bytes__` raise (Phase 3 §5.3.6 acceptance criterion 5).

Why subprocess + JSON instead of import-and-call: basedpyright's Python API
isn't stable; the JSON CLI is the documented integration shape. Running it
in a subprocess also ensures the file under test is exercised exactly the
way CI exercises it, with the project's basedpyright configuration applied.
"""

import json
import subprocess
from pathlib import Path
from typing import cast

_FIXTURE = Path(__file__).parent / "typecheck" / "secret_misuse.py"

# basedpyright's "recommended" mode flags this misuse with one of these rules
# depending on the inference path it takes (argument type vs. assignment vs.
# call signature). Any one of them satisfies the gate — what we're really
# asserting is "the type checker did not accept this".
_ACCEPTABLE_RULES: frozenset[str] = frozenset(
    {"reportArgumentType", "reportAssignmentType", "reportCallIssue"},
)


def test_secret_misuse_fails_typecheck() -> None:
    """basedpyright must emit at least one error-severity diagnostic on the fixture."""
    # `--project` points at tests/typecheck/pyrightconfig.json so the misuse
    # fixture is analyzed under its own config — the suite-wide pyproject.toml
    # excludes tests/typecheck from the project-wide sweep (the fixture
    # contains *deliberate* type errors and would otherwise fail CI), and
    # basedpyright honors `exclude` even for files passed explicitly.
    proc = subprocess.run(  # noqa: S603 — argv is a fixed list, no shell, no user input
        [  # noqa: S607 — uv is on PATH in dev/CI
            "uv",
            "run",
            "basedpyright",
            "--project",
            str(_FIXTURE.parent),
            str(_FIXTURE),
            "--outputjson",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    # basedpyright emits the JSON payload on stdout regardless of exit code;
    # a non-zero exit just signals "errors were found", which is what we want.
    payload = cast("dict[str, object]", json.loads(proc.stdout))
    diagnostics = cast("list[dict[str, object]]", payload.get("generalDiagnostics", []))

    matching = [
        d
        for d in diagnostics
        if d.get("severity") == "error" and cast("str | None", d.get("rule")) in _ACCEPTABLE_RULES
    ]
    assert matching, (
        "basedpyright did not flag Secret[bytes] passed to a bytes-only sink; "
        f"full payload: {payload!r}"
    )
