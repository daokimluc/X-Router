## Context

`settlementHook.ts` today (success path): computes `actualSellCost` from the
routed sell rates, credits `sellerCredit = actualBaseCost × (1 − commission)`,
books `platformMargin = actualSellCost − sellerCredit`, then settles the buyer
side (`spendLedger.settle` or `wallet.settleUsd`). The buyer settle can floor at
zero (`WalletService.settleUsd` → `Math.max(0, …)`), but the seller credit and
margin are computed *before* and *independently* of what the wallet could
actually cover. When `request.routed` is unset, `actualSellCost = 0` and the
reservation is released — a free request.

`persistence-sqlite` adds `settlement_log` (per-request) and `payouts` (per
mark-paid) tables. This change uses them to make reversals auditable and the
solvency invariant computable.

## Goals / Non-Goals

**Goals:**
- Conservation: for every settled request, `collected = sellerCredit +
  platformMargin`, where `collected` is what the buyer side actually moved.
- Never credit a seller more than was collected for that request.
- No marketplace-metered request settles for free due to a missing listing cost.
- Refund (buyer) and reverse/adjust (seller payout) primitives, audited in the log.
- A solvency invariant that holds across the whole ledger and is testable.

**Non-Goals:**
- Admin routes/UI for refund/reverse — that's `marketplace-lifecycle` /
  `admin-marketplace-ui`. This change ships the service primitives + invariant.
- Changing pricing/markup math (`lowest-cost-routing` stands).
- Partial-capture or installment billing — out of scope.
- Currency/FX — website concern.

## Decisions

### Credit from collected, not from intended
Settlement order becomes: settle the buyer side FIRST and learn the amount
actually moved, THEN derive seller credit and margin from it.

```
   collected = buyer-side settle returns the actual amount debited
               (plan bucket delta, or wallet delta after flooring)
   if seller != house:
       sellerCredit  = min( actualBaseCost × (1−commission), collected )
       platformMargin = collected − sellerCredit        // margin absorbs shortfall first
   else:
       platformMargin = collected                       // house: all margin
```
So if the wallet could only cover part of the sell cost, the platform margin
shrinks (possibly to zero) before the seller is shorted, and `collected =
sellerCredit + platformMargin` always holds. The seller is never credited on
uncollected money.

Implementation note: `settleUsd`/`spendLedger.settle` need to **return the actual
delta applied** so the hook knows `collected` (today they return void). Small
signature addition.

### Unlisted route → fallback cost, not $0
When `request.routed` is unset for a request that HELD a plan/wallet reservation
(i.e. a marketplace-metered request), settle against a fallback:
- the house listing's cost for the base model if one exists, else
- the plan/engine model cost (`ModelPricingService`) as the sell basis.
Never settle to $0 for a metered request. Log `warn` with the model + accountId
so operators see unlisted supply serving paid traffic. (A genuinely
non-marketplace request — no reservation held — is untouched; the hook already
early-returns when neither planReservation nor payg is set.)

### Refund / reversal primitives
- `WalletService.refundUsd(keyId, usd, reason)`: credit funds back to a wallet,
  append a `wallet_ledger`/settlement-log reversal row. Distinct from `topupUsd`
  (which is "buyer paid more in") — refund is "we returned a prior charge".
- `SellerEarningsLedger.reverse(sellerId, usd, reason)`: increase `unpaid` back
  (undo an erroneous credit) and `adjust` for corrections; both logged. `markPaid`
  already reduces unpaid — reverse is its inverse for clawbacks/failed payouts.
- All reversals carry a `reason` + are appended to the durable log, so the audit
  trail shows charge → refund, credit → reverse, payout → clawback.

### Solvency invariant
A helper computes, from the SQLite logs:
- per seller: `unpaid == Σ settlement_log.seller_credit − Σ payouts` (must match
  the live aggregate),
- globally: `Σ collected ≥ Σ seller_credit` (platform never owes more than it
  took), and `platformMargin_total == Σ collected − Σ seller_credit`.
Exposed as a read (for a future admin "books health" panel) and asserted in tests.
A violation is a logged error, not a request-time failure.

## Risks / Trade-offs

- **Settle-then-credit reordering.** Changes the hook's sequence and needs the
  settle methods to return the applied delta. Mitigation: additive return value;
  existing callers ignoring it still compile; thorough settlement tests.
- **Fallback cost choice could under/over-charge** an unlisted route. Mitigation:
  house cost is the natural ceiling and is usually present; the engine model cost
  is a safe basis otherwise. It's strictly better than $0, and logged for review.
- **Reverse/refund without routes is half a feature** until the lifecycle change
  wires admin UI. Accepted — shipping the audited primitive + invariant first lets
  the UI change be thin and safe, and tests can exercise the primitives directly.
- **Invariant on floored settles**: when margin absorbs a shortfall to zero and
  the wallet still couldn't cover the seller's base cost, the seller IS shorted
  (credited only `collected`). That's correct (can't pay what wasn't collected)
  but means a seller can be under-credited on an underfunded PAYG burst. Surface
  it via the warning log; the real guard is the PAYG daily limit + funds check at
  reserve time (already present) making this rare.

## Open Questions

- When margin can't absorb the full shortfall and the seller would be shorted:
  short the seller (current lean — money must conserve) or have the platform eat
  it (book negative margin)? Lean: short + warn; never book negative margin
  silently. Confirm.
- Should refund reduce the platform's recorded margin / seller credit for the
  original request (full reversal) or just credit the wallet (goodwill credit)?
  Lean: support both — `refundUsd` for goodwill (wallet only), and a
  `reverseSettlement(logId)` for a true full reversal that also unwinds seller
  credit + margin. Decide granularity in tasks.
