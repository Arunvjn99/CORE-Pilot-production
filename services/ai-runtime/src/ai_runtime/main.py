"""ASGI entrypoint: `uvicorn ai_runtime.main:app`."""

from ai_runtime.app import create_app

app = create_app()
