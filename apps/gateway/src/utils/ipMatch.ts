/**
 * IP allowlist matching.
 *
 * Supports single IPs and CIDRs in IPv4 and IPv6.
 * Handles IPv4-mapped IPv6 addresses (::ffff:1.2.3.4 matches 1.2.3.4 entries).
 */

import ipaddr from "ipaddr.js";

/**
 * Validate that a string is a parseable single IP or CIDR.
 * Returns true for both IPv4 and IPv6.
 */
export function isValidIpOrCidr(entry: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed) return false;
  if (trimmed.includes("/")) {
    return ipaddr.isValidCIDR(trimmed);
  }
  return ipaddr.isValid(trimmed);
}

function normalizeAddr(addr: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  try {
    const parsed = ipaddr.parse(addr);
    // Convert IPv4-mapped IPv6 to IPv4 for cross-family matching.
    if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      return (parsed as ipaddr.IPv6).toIPv4Address();
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Returns true if `clientIp` matches any entry in the allowlist.
 * Empty/undefined allowlist returns true (no restriction).
 */
export function ipMatches(clientIp: string, allowlist: string[] | undefined): boolean {
  if (!allowlist || allowlist.length === 0) return true;

  const client = normalizeAddr(clientIp);
  if (!client) return false;

  for (const entry of allowlist) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    if (trimmed.includes("/")) {
      // CIDR
      let cidr: [ipaddr.IPv4 | ipaddr.IPv6, number];
      try {
        cidr = ipaddr.parseCIDR(trimmed);
      } catch {
        continue;
      }
      const cidrFamily = cidr[0].kind();
      if (cidrFamily !== client.kind()) continue;
      if (client.match(cidr)) return true;
    } else {
      // Single IP — must match exactly
      const target = normalizeAddr(trimmed);
      if (!target) continue;
      if (target.kind() !== client.kind()) continue;
      if (client.toNormalizedString() === target.toNormalizedString()) return true;
    }
  }

  return false;
}
