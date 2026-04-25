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
    secret_pattern_redaction_processor,
)
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
