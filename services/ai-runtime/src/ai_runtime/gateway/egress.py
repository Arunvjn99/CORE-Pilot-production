"""SSRF-safe egress for provider calls (docs/security/provider-endpoint-ssrf.md).

Every request: resolve the host once, reject if ANY address is non-global (unless the host is
operator allow-listed, or private targets are permitted outside production), then connect to the
checked address with the original Host header and TLS SNI. Re-resolution (DNS rebinding) is
impossible because the client never sees the host name again. Redirects are never followed.
"""

import asyncio
import ipaddress
import json
import socket
from dataclasses import dataclass

import httpx2

MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class EgressBlockedError(Exception):
    """Destination is not allowed. Message is safe to log; never shown verbatim to users."""


def is_blocked_address(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return not ip.is_global or ip.is_multicast


@dataclass(frozen=True, slots=True)
class EgressPolicy:
    allow_private: bool
    allowed_private_hosts: tuple[str, ...] = ()
    require_https: bool = True

    def permits_private(self, host: str) -> bool:
        return self.allow_private or host.lower() in self.allowed_private_hosts


async def _resolve(host: str, port: int) -> list[str]:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        return [host]
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise httpx2.ConnectError(f"cannot resolve {host}") from exc
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


class PinnedTransport(httpx2.AsyncBaseTransport):
    def __init__(self, policy: EgressPolicy, inner: httpx2.AsyncBaseTransport | None = None) -> None:
        self._policy = policy
        self._inner = inner or httpx2.AsyncHTTPTransport(retries=0)

    async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
        url = request.url
        if url.scheme not in ("https", "http") or (self._policy.require_https and url.scheme != "https"):
            raise EgressBlockedError("scheme not allowed")
        if url.userinfo:
            raise EgressBlockedError("credentials in URL")
        host = url.host
        port = url.port or (443 if url.scheme == "https" else 80)
        addresses = await _resolve(host, port)
        if not addresses:
            raise httpx2.ConnectError(f"no addresses for {host}")
        if not self._policy.permits_private(host) and any(is_blocked_address(a) for a in addresses):
            raise EgressBlockedError("destination resolves to a non-public address")
        # Every address was checked above; try them in order (e.g. ::1 then 127.0.0.1).
        last_error: httpx2.ConnectError | None = None
        for pinned in addresses:
            request.url = url.copy_with(host=pinned)
            request.extensions = {**request.extensions, "sni_hostname": host}
            try:
                return await self._inner.handle_async_request(request)
            except httpx2.ConnectError as exc:
                last_error = exc
        assert last_error is not None  # noqa: S101 - addresses is non-empty
        raise last_error

    async def aclose(self) -> None:
        await self._inner.aclose()


def egress_client(
    policy: EgressPolicy, timeout: float, inner: httpx2.AsyncBaseTransport | None = None
) -> httpx2.AsyncClient:
    return httpx2.AsyncClient(
        transport=PinnedTransport(policy, inner),
        follow_redirects=False,
        timeout=httpx2.Timeout(timeout, connect=min(timeout, 5.0)),
        trust_env=False,  # never route through ambient proxies
    )


async def read_json_capped(response: httpx2.Response) -> object:
    body = bytearray()
    async for chunk in response.aiter_bytes():
        body.extend(chunk)
        if len(body) > MAX_RESPONSE_BYTES:
            raise ValueError("response too large")
    return json.loads(bytes(body))
