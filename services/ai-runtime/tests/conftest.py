import pytest
from fastapi.testclient import TestClient

from ai_runtime.app import create_app
from ai_runtime.config import Settings


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Settings(app_env="test", service_version="test")))
