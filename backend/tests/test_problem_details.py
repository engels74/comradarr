"""RFC 9457 application/problem+json envelope tests (Phase 1 §10.3)."""

from typing import cast

from litestar import Litestar, get
from litestar.testing import AsyncTestClient

from comradarr.errors import ComradarrError
from comradarr.errors.handlers import (
    comradarr_error_handler,
    unhandled_exception_handler,
)
from comradarr.errors.validation import ValidationError


@get("/probe-comradarr-error", sync_to_thread=False)
async def _raise_validation_error() -> None:
    raise ValidationError(
        "stub-validation",
        errors=[{"loc": ["field"], "msg": "required"}],
    )


@get("/probe-unhandled", sync_to_thread=False)
async def _raise_runtime_error() -> None:
    raise RuntimeError("internal-test-only-do-not-leak")


def _probe_app() -> Litestar:
    return Litestar(
        route_handlers=[_raise_validation_error, _raise_runtime_error],
        exception_handlers={
            ComradarrError: comradarr_error_handler,
            Exception: unhandled_exception_handler,
        },
    )


async def test_comradarr_error_returns_problem_json_envelope() -> None:
    async with AsyncTestClient(app=_probe_app()) as client:
        response = await client.get("/probe-comradarr-error")

    content_type: str = response.headers["content-type"]
    assert content_type.startswith("application/problem+json")
    body = cast("dict[str, object]", response.json())
    # RFC 9457 required keys (instance is optional when no correlation id is bound).
    type_value = body["type"]
    assert isinstance(type_value, str) and type_value.startswith("urn:comradarr:")
    assert isinstance(body["title"], str) and body["title"]
    assert isinstance(body["status"], int) and body["status"] == response.status_code
    assert isinstance(body["detail"], str) and body["detail"]
    # ValidationError extension member.
    assert body["errors"] == [{"loc": ["field"], "msg": "required"}]


async def test_unhandled_exception_returns_internal_unexpected() -> None:
    async with AsyncTestClient(app=_probe_app(), raise_server_exceptions=False) as client:
        response = await client.get("/probe-unhandled")

    assert response.status_code == 500
    content_type: str = response.headers["content-type"]
    assert content_type.startswith("application/problem+json")
    body = cast("dict[str, object]", response.json())
    assert body["type"] == "urn:comradarr:internal.unexpected"
    assert body["status"] == 500
    detail = body["detail"]
    # Generic detail — internal exception message must not leak.
    assert isinstance(detail, str)
    assert "internal-test-only-do-not-leak" not in detail
