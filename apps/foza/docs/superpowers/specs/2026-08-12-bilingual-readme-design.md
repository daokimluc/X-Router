# Bilingual README Design for XRouter

## Objective

Replace the default Next.js README with a persuasive, evidence-based, bilingual
English–Vietnamese README that helps an OpenAI reviewer and open-source
developers quickly understand this repository's role in the XRouter ecosystem,
its current maturity, technical scope, and intended use of Codex for Open Source
support.

## Audience and positioning

- Primary audience: Codex for Open Source reviewers and international OSS
  maintainers.
- Secondary audience: developers evaluating or contributing to XRouter.
- Primary language: English, with a Vietnamese translation immediately after
  each major section.
- Project status: public beta, still under active development, with a small
  group of internal users. The README must not describe XRouter as production
  software or imply broad adoption.
- Capacity figures: `120M+ requests`, `150+ models`, `30+ providers`, and
  `<2000ms` may appear only as design targets/capacity goals, never as achieved
  production metrics.
- Repository boundary: this repository is the Foza web/control plane around
  X-Router, not the complete gateway implementation. Foza owns the website,
  Auth.js identity, console, account/resource mappings, payment top-ups, and a
  SQLite mirror ledger. X-Router owns the gateway and its catalog, plans,
  sellers, listings, wallet, and settlement APIs. The two systems communicate
  over HTTP through the server-only adapter.
- Runtime boundary: this repository does not implement an end-user
  `/v1/chat/completions` proxy. Its gateway integration is primarily control
  plane, provisioning, catalog reads, payment/settlement coordination, and
  webhook ingestion.

## Content structure

1. Hero section with concise value proposition and status badges/links where
   evidence exists.
2. One-paragraph explanation of the problem: fragmented AI providers, tools,
   credentials, billing, and observability.
3. Solution overview positioning the project as the web/control plane for an
   OpenAI-compatible X-Router gateway and model/provider marketplace. Explain
   the Foza ↔ X-Router boundary rather than claiming that this repository
   contains the entire gateway.
4. “Why it matters to open source” section focused on transparent operations,
   provider choice, cost control, and maintainability for small teams.
5. Current capabilities, limited to behavior evidenced in the repository:
   authenticated buyer console; a working marketplace that displays live or
   fallback listings and per-listing metrics, supports buyer subscriptions and
   prepaid token-pack purchases, and allows platform/seller listing creation.
   Describe the marketplace subscribe action precisely as connecting a model to
   an existing or newly created buyer key; do not imply that the button itself
   executes a separate listing purchase or settlement transaction. Do not claim
   that marketplace search/filter controls are complete: the current controls
   are presentational UI without filtering handlers;
   API-key lifecycle; plan and wallet flows; usage and settlement records;
   seller earnings summary; admin moderation/catalog controls; authenticated and
   idempotent X-Router/SePay webhooks; server-side secret handling; persistent
   SQLite money/event records; reconciliation backstop; and mock fallback.
6. Compact Mermaid architecture diagram showing clients → gateway → providers
   and the website/admin/ledger boundary. The diagram must label X-Router as an
   external service and avoid implying that the gateway runtime is inside this
   repository.
7. Quick start using the repository's actual npm scripts and `.env.example`,
   including the distinction between local mock mode and live X-Router mode;
   with a clear note that the project is in public beta.
8. “How Codex support will be used” with three priorities:
   security/reliability/observability first; maintainer automation second;
   gateway/marketplace roadmap third. Include concrete outputs rather than
   unsupported promises.
9. Roadmap framed as planned work, not shipped functionality. Marketplace must
   be described as shipped/current functionality; only future expansion such as
   broader provider coverage, richer discovery, and additional routing or
   marketplace automation belongs in the roadmap.
10. Contribution, security reporting, license/project-status notes, and link
    to the official Codex for Open Source program.

## Evidence matrix for README claims

### Shipped in this repository

- Buyer marketplace page: `src/app/[locale]/console/marketplace/page.tsx`.
- Buyer model subscription and key selection/creation:
  `src/app/[locale]/console/marketplace/actions.ts`.
- Prepaid token-pack purchase intent, server-side price recomputation, bounded
  pack sizes, and owner-scoped status polling:
  `src/app/[locale]/console/marketplace/buy-pack-actions.ts`.
- The marketplace subscribe action connects a selected model to an existing or
  newly created buyer key and records that mapping in Foza:
  `src/app/[locale]/console/marketplace/actions.ts`.
- Buyer plans and cancellation/overage flows:
  `src/app/[locale]/console/plans/actions.ts`.
- API-key lifecycle: `src/app/[locale]/console/keys/actions.ts`.
- Wallet top-up intent and payment status:
  `src/app/[locale]/console/wallet/actions.ts`.
- Provider registration and owner-scoped listing creation:
  `src/app/[locale]/console/provider/actions.ts` and
  `src/app/[locale]/console/provider/listing-actions.ts`.
- Provider listing management: `src/app/[locale]/console/models/actions.ts`.
- Admin seller, markup, plan, catalog, webhook, role, and house-listing
  controls: `src/app/[locale]/console/admin/actions.ts` and
  `src/app/[locale]/console/admin/page.tsx`.
- Seller earnings view: `src/app/[locale]/console/earnings/page.tsx`.
- Authenticated X-Router webhook with HMAC verification, event deduplication,
  reversal handling, and ledger feeding:
  `src/app/api/webhooks/xrouter/route.ts`.
- Authenticated SePay webhook with payment matching, single-winner top-up
  claiming, retry-safe crediting, and token-pack grants:
  `src/app/api/webhooks/sepay/route.ts`.
- Persistent money/event state and idempotency tables:
  `src/lib/db/index.ts` and `src/lib/xrouter/ledger.ts`.
- Settlement reconciliation and periodic backstop:
  `src/lib/xrouter/reconcile.ts` and
  `src/lib/xrouter/reconcile-scheduler.ts`.
- Server-only X-Router client with separate provision/admin/internal auth
  dimensions, five-second request timeout, and retry handling for rate limits:
  `src/lib/xrouter/client.ts` and `src/lib/xrouter/config.ts`.
- Buyer keys are stored locally only in masked form; gateway, webhook, payment,
  and Auth.js secrets are environment-driven and server-only:
  `src/lib/xrouter/account-store.ts`, `src/lib/xrouter/config.ts`, and
  `.env.example`.
- Per-listing metrics preserve distinct time horizons and render missing values
  as `—`; this is a useful observability detail, but not proof of a global
  latency or uptime SLO: `src/lib/xrouter/types.ts` and
  `src/app/[locale]/console/marketplace/page.tsx`.
- Provider earnings currently expose summary figures; the provider-log table is
  not populated yet, so the README must not claim detailed earnings history or
  complete provider analytics.

### Live integration versus development fallback

- `src/lib/xrouter/config.ts` enables live integration when
  `MARKETPLACE_ENABLED=true` or `XROUTER_ENABLED=true`.
- `src/lib/xrouter/adapter.ts` reads live X-Router data when enabled; read
  paths fall back to typed mock data on failure, while provision/admin writes
  surface typed errors.
- `src/lib/xrouter/mock.ts` and `src/lib/data.ts` contain deterministic demo
  fixtures. They are not evidence of production usage or adoption.
- `.env.example` intentionally defaults to `MARKETPLACE_ENABLED=false`.
- Search/filter controls on the marketplace page are currently presentational;
  they do not yet filter the listing collection.
- The checked-in `.env.local` is deployment-specific and must not be treated as
  a public configuration contract. Payment behavior also depends on deployment
  SePay/bank environment variables that are not all present in `.env.example`.

### Claims to exclude or qualify

- Do not claim this repository implements the entire X-Router gateway.
- Do not claim this repository exposes a complete end-user LLM proxy/API; no
  `/v1/chat/completions` route exists here.
- Do not present marketing cards, seeded fixtures, or target capacity figures
  as observed production metrics.
- Do not claim production readiness, uptime, certifications, broad adoption, or
  public API availability without separate evidence.
- Do not describe model subscription as a separate purchase transaction; it
  currently connects the model to a buyer key, while token-pack and wallet
  payment flows are handled separately.
- Do not describe website authentication as X-Router OAuth; the current code
  reads server sessions through Auth.js.
- Do not describe all edge signals as durable: money ledgers and webhook event
  records are persisted, while transient edge signals are held in memory.
- Do not claim automatic key disable/revocation on plan cancellation unless the
  code is changed; the current cancellation action clears the plan binding but
  does not wind down the key.
- Do not claim seller approval is fully synchronized across the X-Router and
  Foza local status stores; the current admin approval action updates X-Router,
  while the durable local seller status is not visibly refreshed.
- Do not claim the provider console exposes every adapter/admin capability:
  seller-term editing, rejection, and payout handlers exist in server code but
  are not all exposed as visible UI flows.
- Do not claim the provider log is a complete earnings history: the current
  earnings page renders summary values while its provider-log table is empty.
- Do not present the aggregate `avgLatency` or marketing/provider dashboard
  numbers as measured live telemetry; the live aggregate adapter returns `—`
  for average latency and several marketing cards contain hardcoded demo data.
- Do not claim payment recovery is fully automatic in every crash scenario;
  a process crash between payment claim and finalization can leave a row for
  manual reconciliation.
- Do not claim reconciliation is an unlimited event-processing system; the
  current sweep reads up to 1,000 records per query and does not paginate.
- Treat historical OpenSpec/docs claims as supporting context, not proof of
  current behavior, when they conflict with the implementation.

## Tone and claims policy

- Confident, specific, and maintainer-oriented; avoid marketing superlatives.
- Prefer “designed for”, “currently supports”, “in public beta”, and “planned”
  where appropriate.
- Do not claim production scale, uptime, adoption, security certification, or
  completed roadmap items without repository evidence.
- Keep the English section readable when skimming; Vietnamese follows without
  duplicating every code comment or implementation detail.
- Use the official OpenAI program wording only for describing the program's
  published support; do not imply endorsement or acceptance.

## Verification criteria

- README no longer contains the create-next-app template text.
- Every feature claim maps to a source file or project document already in the
  repository, and the README distinguishes Foza-owned behavior from
  X-Router-owned behavior.
- Target figures are explicitly labeled as targets.
- Public-beta maturity and internal-user status are explicit.
- Codex support priorities are concrete and ordered.
- Quick start commands match `package.json`.
- Quick start explains live integration versus mock mode and does not imply
  that the gateway source is contained in this repository.
- Architecture description does not imply an end-user chat-completions route or
  measured production telemetry that the code does not provide.
- Markdown headings, links, code fences, and Mermaid syntax are valid.
- The document remains useful to both an English-speaking reviewer and a
  Vietnamese maintainer without requiring external context.
