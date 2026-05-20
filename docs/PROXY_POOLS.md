# Proxy Pools

Proxy pools let you route gateway requests through SOCKS5/HTTP proxies or Vercel relay endpoints. Useful for bypassing IP-based rate limits or geo-restrictions.

## Concepts

- **Proxy Pool** — a named collection of proxy URLs with health tracking
- **Vercel Relay** — a serverless relay deployed on Vercel that forwards requests (no SOCKS5 needed)
- **Strict mode** — if the proxy fails, the request fails (no direct fallback)
- **Non-strict mode** — if the proxy fails, the request falls back to direct connection

## Creating a Proxy Pool

Dashboard → Proxy Pools → Add Pool

Or via API:

```bash
curl -X POST http://localhost:3100/admin/v1/proxy-pools \
  -H "Authorization: Bearer ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Proxies",
    "type": "socks5",
    "proxyUrl": "socks5://user:pass@proxy.example.com:1080",
    "strictProxy": false
  }'
```

## Vercel Relay

Deploy a relay function on Vercel and use it as a proxy:

```bash
curl -X POST http://localhost:3100/admin/v1/proxy-pools \
  -H "Authorization: Bearer ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Vercel Relay",
    "type": "vercel",
    "proxyUrl": "https://my-relay.vercel.app",
    "strictProxy": false
  }'
```

## Batch Import

Dashboard → Proxy Pools → Batch Import — paste a list of proxy URLs (one per line):

```
socks5://user:pass@1.2.3.4:1080
http://user:pass@5.6.7.8:8080
socks5://9.10.11.12:1080
```

## Health Testing

Dashboard → Proxy Pools → select pool → Health Check

The gateway tests each proxy by making a request to a known endpoint and marks proxies as active/dead. Dead proxies are automatically disabled.

## Assigning to Provider Accounts

Dashboard → Providers → select provider → select account → Proxy Pool dropdown

Or via API when creating an account:

```bash
curl -X POST http://localhost:3100/admin/v1/accounts \
  -H "Authorization: Bearer ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "providerInstanceId": "provider_codex_main",
    "displayName": "Codex via Proxy",
    "credentialType": "oauth",
    "metadata": {
      "proxyPoolId": "pool_abc123"
    }
  }'
```

## No-Proxy Patterns

Exclude specific domains from proxy routing:

```json
{
  "noProxy": "localhost,127.0.0.1,*.internal.company.com"
}
```
