"""Service-to-service authentication for /internal routes (ADR-0011).

Callers present an OAuth2 access token from the company IdP: Entra managed identity in Azure,
client-credentials from the mock IdP locally. We validate signature (JWKS from discovery),
issuer, audience, expiry and that the subject is an allowed caller. RS256 only.
"""

import json
import urllib.request
from functools import lru_cache
from typing import Annotated, Any

import jwt
import structlog
from fastapi import Depends, HTTPException, Request
from jwt import PyJWKClient

from ai_runtime.config import Settings, get_settings

_log = structlog.get_logger()


@lru_cache(maxsize=4)
def _jwks_client(issuer: str) -> PyJWKClient:
    discovery = issuer.rstrip("/") + "/.well-known/openid-configuration"
    if not discovery.startswith(("https://", "http://")):
        raise ValueError("issuer must be an http(s) URL")
    with urllib.request.urlopen(discovery, timeout=5) as response:  # noqa: S310 - scheme checked above
        jwks_uri = json.load(response)["jwks_uri"]
    return PyJWKClient(jwks_uri, cache_keys=True, lifespan=3600, timeout=5)


def verify_service_token(token: str, settings: Settings) -> dict[str, Any]:
    if not settings.service_auth_configured:
        raise HTTPException(503, "Service authentication is not configured")
    issuer = settings.service_auth_issuer or ""
    try:
        key = _jwks_client(issuer).get_signing_key_from_jwt(token)
        claims: dict[str, Any] = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            audience=settings.service_auth_audience,
            issuer=issuer,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            leeway=30,
        )
    except (jwt.PyJWTError, OSError, KeyError, ValueError) as exc:
        _log.warning("service_auth_rejected", reason=type(exc).__name__)
        raise HTTPException(401, "Invalid service token") from exc
    if str(claims.get("sub", "")).lower() not in settings.allowed_callers:
        _log.warning("service_auth_rejected", reason="caller_not_allowed")
        raise HTTPException(403, "Caller is not allowed")
    return claims


def require_service_caller(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> dict[str, Any]:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Missing service token")
    return verify_service_token(token, settings)
