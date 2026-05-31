## Context

`SpendLedgerService.LedgerEntry` holds `{ dayKey, monthKey, day, month, lastBlocked }` and `reserve` checks `dayCap`/`monthCap`. `rollover(entry)` resets `day` when `dayKey` changes and `month` when `monthKey` changes — lazily, on access, no cron. Scope keys are flat strings like `key:abc123` or `team:default`.

The marketplace plan needs three windows (hour/day/month) and needs them **per model scope**: the "Claude $10" plan caps Claude spend at hour $0.30 / day $1.20 / month $20; if the buyer also calls a Codex model under a different plan, that meters separately. So we need both a finer time window and a scope dimension for the model group.

## Goals / Non-Goals

**Goals:**
- Add an hour window with the same lazy-rollover discipline as day/month.
- Let the scope key carry a model-group segment so spend buckets are independent per group.
- Keep day/month semantics and the hold-and-settle contract exactly as they are.
- Backward-tolerant persistence: entries written before this change (no hour fields) load cleanly.

**Non-Goals:**
- Defining *what* the model groups are or *which* plan maps to which group — that's `marketplace-plans`. The ledger only stores whatever scope string the caller passes.
- Sliding/rolling-window-of-last-60-minutes. We use calendar-aligned hours (`YYYY-MM-DDTHH` UTC) for the same reason day/month are calendar-aligned: simple, restart-safe, no per-event history.
- The decision to wait vs. boost-to-PAYG when an hour cap is hit — that's policy in `marketplace-plans`/`two-sided-settlement`. Here, a breached cap simply returns the rejection reason.

## Decisions

### Hour window mirrors day/month exactly
```
   LedgerEntry  (before)            LedgerEntry  (after)
   ┌───────────────────┐            ┌───────────────────────┐
   │ dayKey   "2026-05-29"          │ hourKey  "2026-05-29T14"│  ← new
   │ monthKey "2026-05"  │          │ dayKey   "2026-05-29"   │
   │ day      number     │          │ monthKey "2026-05"      │
   │ month    number     │          │ hour     number         │  ← new
   │ lastBlocked         │          │ day      number         │
   └───────────────────┘            │ month    number         │
                                     │ lastBlocked             │
                                     └───────────────────────┘
```
`hourKey = new Date().toISOString().slice(0,13)` → `"2026-05-29T14"`. `rollover` adds: `if (entry.hourKey !== nowHour) { entry.hour = 0; entry.hourKey = nowHour }`. Check order in `reserve`: **hour → day → month** (tightest/shortest first), so the most specific `Retry-After` is returned.

### Model-group scope segment
The scope string convention extends from `key:<id>` to optionally `key:<id>:grp:<group>`. The ledger does not parse or interpret it — callers build it. `marketplace-plans` will compute the group from the model (`claude-* → "claude"`, `codex-*/gpt-* → "codex"`, etc.) and pass the composed scope. A plan-less key keeps using the flat `key:<id>` scope, so nothing breaks.

```
   buyer key abc, plan "Claude $10", calls claude-sonnet-4-6
        scope = "key:abc:grp:claude"   → independent hour/day/month bucket
   same key later calls a codex model under PAYG
        scope = "key:abc:grp:codex"    → separate bucket, separate caps
```

### Retry-After granularity
`reserve` returns `reason: "hour_cap_exceeded" | "day_cap_exceeded" | "month_cap_exceeded"`. The middleware maps each to the right helper: hour → `secondsUntilNextHourUTC()`, day → `secondsUntilNextDayUTC()`, month → `secondsUntilNextMonthUTC()`.

### Persistence tolerance
On `load`, an entry lacking `hourKey`/`hour` is treated as a fresh hour (`hour=0`, `hourKey=<now>`). No migration step needed; the first `rollover` after load normalizes it.

## Risks / Trade-offs

- **Risk: clock/timezone confusion.** All windows are UTC, consistent with the existing day/month. The website renders local time; x-router stays UTC. Documented.
- **Trade-off: calendar hour, not rolling 60 min.** A burst right before `:00` then again right after gets two hours' worth. Accepted — same trade-off already made for day/month, and it massively simplifies state (no per-request history). Plans can set the hour cap conservatively to absorb this.
- **Risk: scope-string typos create silent separate buckets.** Mitigation: the group function lives in one place (`marketplace-plans`), unit-tested; the ledger is dumb on purpose.

## Open Questions

- Do we ever need a *week* window? Not for the current plan shapes (hour/day/month). Left out; the pattern makes adding one trivial later.
