import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from ai_runtime.config import Settings
from ai_runtime.correlation import resolve_correlation_id


def test_liveness(client: TestClient) -> None:
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ai-runtime", "version": "test", "checks": {}}


def test_correlation_id_propagated_and_sanitised(client: TestClient) -> None:
    assert (
        client.get("/health/live", headers={"x-correlation-id": "trace-12345678"}).headers["x-correlation-id"]
        == "trace-12345678"
    )
    replaced = client.get("/health/live", headers={"x-correlation-id": "bad id"}).headers["x-correlation-id"]
    assert replaced != "bad id"
    assert len(replaced) == 36


def test_error_envelope(client: TestClient) -> None:
    response = client.get("/nope", headers={"x-correlation-id": "trace-12345678"})
    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "NOT_FOUND", "message": "Not Found", "correlationId": "trace-12345678"}
    }


def test_docs_disabled_by_default(client: TestClient) -> None:
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_production_rejects_docs() -> None:
    with pytest.raises(ValidationError):
        Settings(app_env="production", api_docs_enabled=True)


def test_settings_require_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_ENV", raising=False)
    with pytest.raises(ValidationError):
        Settings()


@pytest.mark.parametrize("value", [None, "", "short", "x" * 65, "a\nb-12345678"])
def test_resolve_correlation_id_rejects(value: str | None) -> None:
    assert len(resolve_correlation_id(value)) == 36
