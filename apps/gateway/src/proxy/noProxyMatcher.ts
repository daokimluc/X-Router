/**
 * Determines whether a target URL should bypass the proxy based on
 * a comma-separated list of no-proxy patterns.
 *
 * Pattern matching rules:
 * - `*` matches all hostnames (bypass everything)
 * - `.example.com` matches any subdomain of example.com, and example.com itself
 * - `example.com` matches the hostname exactly (case-insensitive)
 *
 * @param targetUrl - The full URL of the outbound request
 * @param noProxyPatterns - Comma-separated list of bypass patterns
 * @returns true if the proxy should be bypassed for this URL
 */
export function shouldBypassProxy(
  targetUrl: string,
  noProxyPatterns: string
): boolean {
  if (!noProxyPatterns) {
    return false;
  }

  let hostname: string;
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    // Invalid URL — don't bypass, let the proxy handle it
    return false;
  }

  const patterns = noProxyPatterns.split(",");

  for (const raw of patterns) {
    const pattern = raw.trim().toLowerCase();

    if (!pattern) {
      continue;
    }

    if (pattern === "*") {
      return true;
    }

    if (pattern.startsWith(".")) {
      // Dot-prefix pattern: matches subdomains and the domain itself
      // e.g., ".example.com" matches "sub.example.com" and "example.com"
      if (
        hostname.endsWith(pattern) ||
        hostname === pattern.slice(1)
      ) {
        return true;
      }
    } else {
      // Exact hostname match (case-insensitive)
      if (hostname === pattern) {
        return true;
      }
    }
  }

  return false;
}
