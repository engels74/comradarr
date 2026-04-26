"""Logging module tests (Phase 1 §10.4).

Validates the canonical processor chain end-to-end without spinning up the
whole Litestar app — exercises the JSON / console renderer split, the header
redaction processor, and the secret-pattern redaction processor.
"""

import io
import json
import logging
from typing import cast

import structlog

from comradarr.core.logging import (
    configure_logging,
    header_redaction_processor,
    secret_aware_redaction_processor,
    secret_pattern_redaction_processor,
)
from comradarr.core.types import Secret
from tests.conftest import stub_settings


def test_json_renderer_emits_parseable_json() -> None:
    settings = stub_settings(overrides={"COMRADARR_LOG_FORMAT": "json"})
    configure_logging(settings)
    buffer = io.StringIO()
    handler = logging.StreamHandler(buffer)
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    log = structlog.stdlib.get_logger("test.json")
    log.info("test_event", payload="hello")
    line = buffer.getvalue().strip().splitlines()[-1]
    decoded = cast("dict[str, object]", json.loads(line))
    assert decoded["event"] == "test_event"
    assert decoded["payload"] == "hello"


def test_console_renderer_emits_non_json() -> None:
    settings = stub_settings(overrides={"COMRADARR_LOG_FORMAT": "console"})
    configure_logging(settings)
    buffer = io.StringIO()
    handler = logging.StreamHandler(buffer)
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    log = structlog.stdlib.get_logger("test.console")
    log.info("console_event", payload="hello")
    line = buffer.getvalue().strip().splitlines()[-1]
    # ConsoleRenderer output is a human-formatted line, not JSON.
    try:
        json.loads(line)
    except json.JSONDecodeError:
        return
    msg = "console renderer must not emit parseable JSON"
    raise AssertionError(msg)


def test_secret_pattern_redaction_masks_jwt_value() -> None:
    jwt_like = (
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    )
    event = {"event": "login", "token": jwt_like}
    out = secret_pattern_redaction_processor(None, "info", event)
    assert out["token"] == "<redacted>"  # noqa: S105 — assertion target, not a credential
    # Non-secret string fields are untouched.
    assert out["event"] == "login"


def test_header_redaction_masks_authorization_field() -> None:
    event = {
        "event": "request",
        "authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
        "x-api-key": "cmrr_live_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        "user_agent": "pytest",
    }
    out = header_redaction_processor(None, "info", event)
    assert out["authorization"] == "<redacted>"
    assert out["x-api-key"] == "<redacted>"
    assert out["user_agent"] == "pytest"


def test_secret_aware_redaction() -> None:
    """Secret[bytes] payloads serialize as the literal '<Secret>' marker.

    Exercises the full chain end-to-end (configure_logging + JSON renderer)
    rather than the processor in isolation so the test catches regressions
    where the processor is correct in unit form but mis-wired into the chain.
    """
    raw = b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f"
    settings = stub_settings(overrides={"COMRADARR_LOG_FORMAT": "json"})
    configure_logging(settings)
    buffer = io.StringIO()
    handler = logging.StreamHandler(buffer)
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    log = structlog.stdlib.get_logger("test.secret_aware")
    log.info("secret_event", payload=Secret(raw))
    line = buffer.getvalue().strip().splitlines()[-1]
    decoded = cast("dict[str, object]", json.loads(line))
    # The literal '<Secret>' marker is what the rendered JSON must contain --
    # NOT the raw bytes, NOT a length hint, NOT a type name like 'Secret[bytes]'.
    assert decoded["payload"] == "<Secret>"
    assert "Secret[" not in line
    assert "0x00" not in line
    assert raw.hex() not in line


def test_secret_wrapped_pattern_string_renders_secret_marker() -> None:
    """Secret[str] containing a pattern-bait value renders as '<Secret>'.

    The pattern processor's ``isinstance(value, str)`` guard skips Secret
    instances (Secret is not a str subclass and ``__bytes__`` raises), so
    the type-aware processor downstream wins outright -- proving the
    type-aware pass takes precedence over pattern-based redaction even
    when the underlying payload would have matched a known secret pattern.
    """
    argon_hash = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo"

    # Step 1: pattern processor leaves a Secret-wrapped pattern-bait alone.
    after_pattern = secret_pattern_redaction_processor(
        None,
        "info",
        {"event": "auth", "argon": Secret(argon_hash)},
    )
    assert isinstance(after_pattern["argon"], Secret)

    # Step 2: type-aware processor downstream replaces it with '<Secret>'.
    after_secret = secret_aware_redaction_processor(None, "info", after_pattern)
    assert after_secret["argon"] == "<Secret>"
    # ...and crucially NOT the pattern-redaction marker.
    assert after_secret["argon"] != "<redacted>"

    # Bare-string control: same pattern wrapped as plain str DOES render as
    # '<redacted>' from the pattern processor (proves the difference is the
    # Secret wrapper, not a chain-order accident).
    bare = secret_pattern_redaction_processor(
        None,
        "info",
        {"event": "auth", "argon": argon_hash},
    )
    assert bare["argon"] == "<redacted>"
