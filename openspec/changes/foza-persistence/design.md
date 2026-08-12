## Approach

Introduce one persistence module (`src/lib/db/`) that owns a single SQLite
connection and exposes typed repository functions. Existing store modules
(`users.ts`, `account-store.ts`) keep their current exported signatures but route
to SQLite underneath, so callers are largely untouched. Storage only — no business
logic, no X-Router calls.

## Driver decision: `node:sqlite` (built-in)

Verified on this machine: **Node v25.9.0**, and `require('node:sqlite')` loads
successfully. So the driver is Node's built-in `node:sqlite`:

- **Synchronous + in-process** — same property X-Router relies on for money
  correctness (no async race between read and write). Atomic writes solve the
  concurrent-`usage.recorded` corruption that a JSON file has.
- **No native module to compile** — avoids the `better-sqlite3` node-gyp / prebuilt
  friction, and avoids bundler issues with Next 16 / Turbopack.
- **Same engine as X-Router** — consistent mental model across the two services.

Fallback (only if a deploy target ships an older Node without `node:sqlite`):
`better-sqlite3`. Kept as a note, not a dependency, unless needed.

### Next.js 16 runtime constraint (AGENTS.md: read the bundled docs first)

`node:sqlite` is a Node-only API — it cannot run on the Edge runtime. Per the
Next 16 docs read for the auth work:
- **Proxy** (`src/proxy.ts`) already runs on the **Node.js runtime** in Next 16, so
  it could touch the DB — but it must not (optimistic cookie/JWT check only; no DB
  in proxy, per the auth guide's "optimistic checks" rule).
- All DB access lives in **Route Handlers, Server Actions, and server components**,
  which run on Node by default. The DB module is marked `import "server-only"` so a
  client-component import fails at build time.
- The connection is a module-level singleton on `globalThis` (same pattern the
  current in-memory stores use) so Next's dev module re-evaluation doesn't open
  many connections.

## Schema (Foza-owned state only — catalog stays live from X-Router)

```
users           id, email UNIQUE, name, passwordHash, verified,
                verifyToken, verifyTokenExpires, createdAt
                (1:1 migrate from .data/users.json)

buyers          id, userEmail FK→users, keyId (X-Router internal id),
                displayName (Foza label; X-Router has no display field),
                planId, status, createdAt
                (X-Router key.owner is set = userEmail for live grouping)

sellers         id, userEmail FK→users, sellerId (X-Router id),
                status mirror, externalRef(=userEmail), createdAt

wallet_topups   id, userEmail, keyId, vndAmount, fxRate, usdAmount,
                gatewayTxId, status, createdAt

billing_ledger  settlementId PK, requestId, buyerKeyId, baseModel,
                promptTokens, completionTokens, actualSellCost, billTrack, ts
                (one row per usage.recorded; PK = idempotency)

payable_ledger  settlementId PK, requestId, sellerId, sellerCredit, ts
                (excludes sellerId="house"; PK = idempotency)

webhook_events  dedupeKey PK (=settlementId), event, rawBody,
                signatureVerified, requestId, processedAt
                (raw log for idempotency + replay/reconcile)
```

`billing_ledger` and `payable_ledger` are created here (empty) but only *written*
by `xrouter-money-ledger`. This change ships the tables; the next change fills
them. Splitting this way keeps each change reviewable.

## Idempotency key

`settlementId` (a stable `stl_<uuid>` from X-Router's `settlement_log`) is the
primary key of both ledgers. Phase 34d.1 (verified in `settlementHook.ts:196,211`)
put `settlementId` **directly into the `usage.recorded` webhook payload** as well
as `GET /provision/settlements` — one stable id shared by the realtime webhook and
the reconcile replay. The webhook receiver MUST dedupe on `settlementId`, **not** on
`event:timestamp:JSON(data)` (two identical requests in the same second produce
identical envelopes and would be wrongly collapsed).

A second key, **`requestId`**, is present on both `/provision/usage` (token detail)
and `/provision/settlements` (money detail). It is stored on the ledger rows so a
later reconcile can join token-level usage to money-level settlement when needed.
`settlementId` = dedupe/primary key; `requestId` = cross-endpoint join key.

## Migration

On first connection, run `CREATE TABLE IF NOT EXISTS` for all tables, then if
`users` is empty and `.data/users.json` exists, import each record. The JSON file
is left untouched as a backup. A `schema_version` row guards future migrations.

## Trade-offs

- **SQLite vs Postgres** → SQLite. Single-node Foza, no separate DB server, file is
  easy to back up, `node:sqlite` is zero-install. Revisit only if Foza goes
  multi-instance (then the file becomes a contention point).
- **Repository functions vs an ORM (Prisma/Drizzle)** → plain functions + hand
  SQL. The schema is small and stable; an ORM adds a build/generate step and
  bundler surface for little gain at this size. Revisit if the schema grows.
- **Keep `.data/users.json`?** → migrate then keep as backup; delete in a later
  cleanup once SQLite is proven in use.

## Out of scope

- The ownership guard that *uses* `buyers`/`sellers` (→ `xrouter-tenant-scoping`).
- Writing/reconciling the money ledgers (→ `xrouter-money-ledger`).
- Migrating X-Router's own catalog to SQLite (that's X-Router's F1, not Foza's).
