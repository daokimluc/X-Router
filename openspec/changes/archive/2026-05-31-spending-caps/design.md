## Context

Pricing is already known per model via `ModelPricingService.calculateCost(...)`. Cost is computed for every successful request (`UsageRecord.estimatedCost`). No ceiling, no enforcement. We have rate limits per minute/day on request count but nothing on dollars.

`ApiKey` and `Team` types are already persisted in JSON via `PersistenceService`. Adding two fields each is straightforward.

## Goals / Non-Goals

**Goals:**
- Hard cap by USD per key and per team, daily and monthly.
- Pre-flight check that rejects requests when the running total + worst-case for the upcoming request would exceed the cap.
- Mid-flight handling: streaming requests can also exceed cap mid-completion. Acceptable to over-shoot once per request because we cannot know token count until done.
- Ledger survives restart (no reset every time gateway starts).
- Admin can see current spend and remaining budget at any time.

**Non-Goals:**
- Per-account caps (account is a credential pool, not an actor billing dimension).
- Sliding-window caps (e.g., last 24h). Calendar day/month is enough and easier to reason about.
- Currency other than USD. ModelPricing is USD-indexed already.
- Soft warnings as separate feature — that lives in a future "billing-alerts" proposal.

## Decisions

### Decision 1 — Pre-flight estimate uses `max_tokens × output_price + estimatedInputTokens × input_price`

We estimate the **upper bound** cost of the upcoming request:
- `inputTokens` ≈ `JSON.stringify(messages).length / 4`
- `outputTokens` ≈ `body.max_tokens` if provided, else 1024 default cap
- Cost = `inputTokens × inputPrice + outputTokens × outputPrice`

If `currentSpend + estimate > cap`, reject with 429 `spend_limit_exceeded`. This may reject some requests that would have actually fit — we accept this conservative bias because the alternative (allow and overshoot) costs real money.

### Decision 2 — Ledger structure: `Map<scope_id, { day_USD, month_USD, dayKey, monthKey }>`

```typescript
{
  "key:abc123":  { day: 2.34, month: 18.90, dayKey: "2026-05-28", monthKey: "2026-05" },
  "team:default":{ day: 5.10, month: 99.20, dayKey: "2026-05-28", monthKey: "2026-05" }
}
```

When a request increments and the current `dayKey` differs from today, reset day total before adding. Same for month. This lazy-resets on next access — no separate cron needed.

### Decision 3 — Inherit team caps when key cap missing

Resolution order on enforcement:
1. If `apiKey.dailySpendLimitUsd` set → use it.
2. Else if `apiKey.teamId` and `team.dailySpendLimitUsd` set → use that.
3. Else unlimited.

Same for monthly. Both day AND month checked on every request — whichever caps tighter wins.

### Decision 4 — Ledger persistence

Snapshot the entire ledger Map to JSON inside the existing `PersistedGatewayState`. On `app.close` save, on startup restore. `PersistenceService` already writes on admin mutations; for ledger we add a debounced save (max 1 write per 5s) to avoid I/O thrashing on every request.

### Decision 5 — What counts toward the ledger

Only **billable** completed requests count: `UsageRecord.estimatedCost > 0` AND HTTP success. Failed requests (5xx, timeouts) do NOT debit because the user typically didn't get value. Pre-flight rejections (4xx from our cap check) also don't debit.

### Decision 6 — Admin observability

`GET /admin/v1/spend/key/:id` returns:
```
{
  "scope": "key",
  "id":    "abc123",
  "today":      { "spent": 2.34, "cap": 10.00, "remainingPct": 76.6 },
  "thisMonth":  { "spent": 18.90, "cap": 100.00, "remainingPct": 81.1 },
  "lastBlocked": "2026-05-28T11:33:00Z" | null
}
```

`lastBlocked` is the timestamp of the most recent rejected request — useful for detecting cap-hitters.

### Decision 7 — UI surface

- ApiKeyEditModal: 2 numeric inputs in the "Limits" tab — "Daily spend cap (USD)", "Monthly spend cap (USD)". Empty = inherit team / unlimited. Tooltip explains inheritance.
- Keys list: a tiny badge `$2.34 / $10.00 today` next to keys with caps. Red when ≥90%.
- Team modal: same 2 numeric inputs.

## Risks / Trade-offs

- **Conservative estimate rejects too aggressively.** Some valid requests will be blocked when running close to the cap. Mitigation: log the pre-flight estimate vs actual diff over time; if average is e.g. 2× actual, tune to 1.5× actual.
- **Streaming overshoot.** A request started under cap can finish over cap. Acceptable: at most one request worth of overshoot per cap reset. Document.
- **Persistence write amplification.** If we persisted ledger on every request, file I/O would dominate. Debounced batch save mitigates.
- **Race condition on concurrent requests.** Two requests admitted at 99.5% of cap could both pass pre-check and together push past 100%. Mitigation: increment ledger atomically *before* dispatch with the upper estimate, then **adjust** to actual on completion (hold-and-settle pattern).
- **Calendar boundaries.** If a request straddles UTC midnight, we credit it to the start day. Document.

## Migration Plan

Additive. No data migration. Steps:
1. Implement `SpendLedgerService` and persist hooks.
2. Wire into `enforceKeyPolicy` middleware (pre-check) and routes (post-completion settle).
3. Admin endpoint, frontend modal fields, list badge.
4. Test with a synthetic key set to `$0.01/day` cap.

Rollback: `dailySpendLimitUsd` and `monthlySpendLimitUsd` defaulting to null means existing keys are not affected. Revert commits, remove fields if needed.

## Open Questions

- Calendar timezone for day boundary — UTC or operator's locale? Default UTC because gateway is single deployment. Confirm before merge.
- Should rejection responses include the cap value so the client knows when to retry? Probably yes — `Retry-After: <seconds-until-tomorrow>` header. Document.
- Do we want a "soft cap" (warn at 80%) emitted as webhook now, or strictly hard caps in this iteration? **Strict hard caps only this iteration.** Warnings = separate proposal.
