## Why

Three audits of the settlement path found money-conservation holes that are
independent of the storage substrate — they are domain-logic bugs in how the
buyer is charged and the seller is credited:

- **The seller is credited on money that wasn't collected.** When actual cost
  exceeds the reserved estimate, `WalletService.settleUsd` debits the extra but
  floors the wallet at zero — yet `settlementHook` still credits the seller
  `actualBaseCost × (1 − commission)` and books the full `platformMargin`. So
  seller payout debt and platform margin accrue on funds the platform never took
  in. There is no invariant that total seller debt ≤ funds collected.
- **Unlisted-route requests settle to $0.** If the leased account has no listing
  cost (`request.routed` unset), the held plan/wallet reservation is settled to
  $0 — the buyer is charged nothing, silently losing revenue, data-dependent on
  which account the pool happens to lease.
- **No refund / reversal primitive anywhere.** `topupUsd` is the only mutating
  wallet op; `markPaid` only ever *reduces* a seller's unpaid (floored at 0). A
  mistaken charge, a buyer refund, an erroneous or failed payout, or a clawback
  cannot be corrected — the books stay permanently wrong.

These are correctness bugs that produce wrong balances and wrong payout debt.
They must be fixed before real money flows. The durable settlement log from
`persistence-sqlite` is the substrate that makes reversals auditable.

## What Changes

- **Credit the seller on collected funds, not intended cost.** The settlement hook
  computes the amount the buyer was *actually charged* (after wallet flooring) and
  derives seller credit + platform margin from that, so the three figures always
  reconcile: `collected = sellerCredit + platformMargin`. If the wallet could not
  cover the full sell cost, the shortfall reduces platform margin first, never
  over-crediting the seller.
- **No free unlisted-route requests.** When `request.routed` is unset for a
  marketplace-metered request, settle against a fallback cost (house/floor price
  for the base model) instead of $0, and log a warning. A plan/PAYG request is
  never served for free due to a missing listing cost.
- **Refund / reversal primitives.** Add `WalletService.refundUsd` (credit back a
  prior charge, audited) and `SellerEarningsLedger.reverse/adjust` (increase
  `unpaid` back / correct an erroneous credit), each appended to the durable
  settlement/payout log so the history is auditable. These are the building blocks
  the lifecycle change (admin refund/reverse UI) calls — this change ships the
  primitives + invariant, not the routes/UI.
- **Solvency invariant + reconciliation.** A check (assertable in tests and
  exposed for an admin read) that `Σ collected ≥ Σ sellerCredit` and that a
  seller's `unpaid` equals `Σ credits − Σ payouts` from the log.
- **BREAKING** none externally — settlement amounts only become *more* correct;
  no API shape changes.

## Capabilities

### New Capabilities
- `money-correctness`: Settlement conserves money — the seller is credited only
  on funds actually collected, unlisted routes never settle free, and refund /
  reversal primitives with a solvency invariant keep wallet float, platform
  margin, and seller payout debt reconcilable.

### Modified Capabilities
- `two-sided-settlement`: the credit/charge computation changes from "intended
  sell cost" to "actually-collected", and the $0 unlisted-route case is closed.
  (Spec delta MODIFIES the settlement requirement.)

## Impact

- Modified (marketplace): `policy/settlementHook.ts` — derive seller credit +
  margin from collected amount; fallback cost when `routed` unset; write reversal
  rows.
- Modified (marketplace): `services/WalletService.ts` — `refundUsd`;
  `services/SellerEarningsLedger.ts` — `reverse/adjust` + payout log integration.
- New: a reconciliation/solvency helper (sums the settlement log vs payouts vs
  collected float) usable from tests and a future admin read.
- Depends on: `persistence-sqlite` (durable settlement log + payout log make
  reversals auditable and the invariant computable); `two-sided-settlement` (#6,
  the path being corrected); `lowest-cost-routing-wiring` (`request.routed`).
