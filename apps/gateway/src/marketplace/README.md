# Marketplace layer (proprietary)

This directory holds the **commercial P2P marketplace** layer that turns the
x-router engine into a two-sided API marketplace: USD wallets, plans, sellers,
lowest-cost routing, two-sided settlement, and the website-facing provision +
webhook contract.

It is **separate on purpose** (open-core model):

- The **core engine** (`apps/gateway/src/` outside this folder) can be
  open-sourced on its own. To produce a clean core build, delete this
  `marketplace/` directory and the single `registerMarketplace(...)` call site
  in `app.ts` — nothing else in the engine references it.
- This layer is gated behind `config.marketplaceEnabled`
  (`MARKETPLACE_ENABLED=true`). When off, none of this code is even imported
  (see the dynamic `import()` in `app.ts`), so the community build runs exactly
  like the plain engine.

## The one invariant

**`core/` (the engine) MUST NOT import from `marketplace/`. Only
`marketplace/` imports from the engine.**

Dependency direction is one-way: `marketplace → engine`. This is what keeps the
core extractable. A test (`test/marketplaceBoundary.test.ts`) enforces it — if
any engine file imports from `marketplace/`, that test fails.

## Single entry point

The entire layer is wired through one function:

```ts
// marketplace/index.ts
export function registerMarketplace(app: FastifyInstance, deps: MarketplaceDeps): void
```

`app.ts` calls it in exactly one place, only when the flag is on:

```ts
if (config.marketplaceEnabled) {
  const { registerMarketplace } = await import("./marketplace/index.js");
  registerMarketplace(app, { config, persistedState });
}
```

## Contents (built incrementally over 7 OpenSpec changes)

| Change | Adds here |
|---|---|
| `usd-wallet` | `services/WalletService.ts` |
| `hourly-spend-buckets` | extends engine `SpendLedgerService` (hour window) — wired from here |
| `marketplace-plans` | `services/PlanService.ts`, `utils/modelGroup.ts` |
| `seller-supply` | `services/SellerService.ts` |
| `lowest-cost-routing` | `services/MarketPricingService.ts`, routing strategy |
| `two-sided-settlement` | `services/SellerEarningsLedger.ts`, settlement wiring |
| `provision-webhook` | `routes/provision.ts`, `middleware/provisionAuth.ts`, business webhook |
