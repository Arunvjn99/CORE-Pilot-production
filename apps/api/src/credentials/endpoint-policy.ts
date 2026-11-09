import { BlockList, isIP } from 'node:net';

/**
 * Save-time SSRF policy for customer-supplied provider endpoints (Azure OpenAI, Ollama).
 *
 * This is a static check on the URL only. It cannot stop DNS rebinding: a public name may
 * later resolve to a private address. The egress component (AI runtime gateway) must
 * therefore resolve, re-check every address with the same ranges, pin the connection to the
 * checked address and refuse redirects. See docs/security/provider-endpoint-ssrf.md.
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

const INTERNAL_HOST = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

export type EndpointViolation = string;

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped?.[1]) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return false;
}

/**
 * Returns a reason when the endpoint is not acceptable, or null.
 * `production` additionally requires HTTPS and forbids private/internal targets unless the
 * host is explicitly allow-listed by the operator (e.g. a self-hosted Ollama in the VNet).
 */
export function checkProviderEndpoint(
  raw: string,
  options: { production: boolean; allowedPrivateHosts: readonly string[] },
): EndpointViolation | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Must be a valid URL';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Must use http or https';
  if (url.username || url.password) return 'Must not contain credentials';
  if (url.search || url.hash) return 'Must not contain a query string or fragment';
  if (!options.production) return null;

  if (url.protocol !== 'https:') return 'Must use https';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (options.allowedPrivateHosts.includes(host)) return null;
  if (isBlockedAddress(host)) return 'Must not target a private, loopback or link-local address';
  if (INTERNAL_HOST.test(host) || !host.includes('.')) return 'Must be a public host name';
  return null;
}
