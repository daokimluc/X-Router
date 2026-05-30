## Context

`enforceKeyPolicy.ts` already resolves a key record, checks model allow-lists, balance, and (Phase 32) per-key/team spend caps via `SpendLedgerService`. `ApiKey` carries `allowedModels`, `teamId`, `dailySpendLimitUsd`, `monthlySpendLimitUsd`. `Team` carries similar. With `usd-wallet` and `hourly-spend-buckets` in place, we have a USD wallet and an hour/day/month ledger with per-group scoping. What's missing is the **product** layer: the plan the buyer actually purchases, which bundles scope + buckets + overage into a named preset.

## Goals / Non-Goals

**Goals:**
- A `Plan` preset entity with the four seeded defaults, admin-extensible.
- A deterministic `model → group` mapping so a plan can be "Claude only".
- Bind a plan to a key; enforce its scope and hour/day/month caps per model group.
- Default behavior on a breached speed-limit bucket: **wait** (429 + Retry-After), per the confirmed product decision.
- A clean hook where overage hands off to PAYG (implemented later) without this change knowing how PAYG charges.

**Non-Goals:**
- Charging the wallet / crediting sellers / markup+commission math — `two-sided-settlement`.
- The website's plan catalog UI, VND pricing, or checkout — those live on the website; x-router just stores the plan and binds it.
- Per-seller direct purchase (`hoang/gpt-5.5` as a buyer-facing SKU) — that interacts with routing in `lowest-cost-routing`/`seller-supply`; plans are pooled-tier only.
- Proration/upgrades/downgrades mid-cycle — the website manages subscription lifecycle and calls provision to (re)assign the plan; x-router holds current state only.

## Decisions

### Plan shape
```
   Plan {
     id            "plan_claude"
     name          "Claude $10"
     priceUsd      10          // informational; website handles real billing
     modelGroups   ["claude"]  // ["*"] = all (pro)
     buckets       { hourUsd: 0.30, dayUsd: 1.20, monthUsd: 20.00 }
     overageEnabled false      // per-key override possible (see below)
     paygDailyLimitUsd?  null  // user-set PAYG wallet guard (two-sided-settlement uses it)
   }
```
Seeded defaults:
| id | name | priceUsd | groups | hour | day | month |
|---|---|---|---|---|---|---|
| `plan_free` | Free | 0 | `["free"]` | 0.02 | 0.05 | 0.50 |
| `plan_claude` | Claude $10 | 10 | `["claude"]` | 0.30 | 1.20 | 20.00 |
| `plan_codex` | Codex $10 | 10 | `["codex"]` | 0.30 | 1.20 | 20.00 |
| `plan_pro` | Pro $20 | 20 | `["*"]` | 0.60 | 2.40 | 40.00 |

(Numbers are seeds; admin/website tune them. `free` group = a curated set of cheap models, defined by `modelGroupOf`.)

### Plan vs. key: binding and overage override
`ApiKey.planId` binds a key to a plan. `overageEnabled` defaults from the plan but a per-key override is allowed (the buyer toggles "allow overage" on the website → provision sets it on the key). Same for `paygDailyLimitUsd` (user-set, per the confirmed decision). Resolution: key override ?? plan default.

### Model grouping
`modelGroupOf(model): string` — pure, deterministic, table-driven:
```
   claude-*, *sonnet*, *opus*, *haiku*   → "claude"
   codex-*, gpt-*, o3*, o4*               → "codex"   (or "gpt" — see open question)
   gemini-*                               → "gemini"
   (curated cheap list)                   → "free"
   else                                   → "other"
```
A plan with `modelGroups: ["*"]` matches every group. A request whose model's group isn't in the plan's groups → **403 model_not_in_plan** (unless overage+PAYG path applies for out-of-scope models, deferred to `two-sided-settlement`). The ledger scope becomes `key:<id>:grp:<group>` so each group meters independently (from `hourly-spend-buckets`).

### Enforcement order in enforceKeyPolicy
```
   resolve plan (key.planId)
        │ no plan → legacy path (admin caps only), unchanged
        ▼
   group = modelGroupOf(model)
   group in plan.modelGroups (or "*")?  ── no ──► 403 model_not_in_plan
        │ yes                                      (PAYG-for-out-of-scope deferred)
        ▼
   scope = key:<id>:grp:<group>
   reserve(scope, estimate, hourCap, dayCap, monthCap from plan.buckets)
        ├─ hour_cap_exceeded  ──► 429 + Retry-After (next hour)   [WAIT default]
        ├─ day_cap_exceeded   ──► 429 + Retry-After (next day)    [WAIT default]
        ├─ month_cap_exceeded ──► overageEnabled?
        │                          ├─ yes ──► hook: payg.shouldChargeWallet() [stub → block w/ 402 until #6]
        │                          └─ no  ──► 429/done (month budget spent)
        └─ ok ──► proceed (settle happens post-request, in #6 for two-sided; here just plan settle)
```

### PAYG handoff hook (kept minimal here)
This change introduces an interface `PaygDecision` with a default no-op implementation that, on month-cap breach with overage on, returns `{ charge: false, reason: "payg_not_implemented" }` → 402 with a clear message. `two-sided-settlement` replaces the implementation. This keeps the plan-enforcement code stable while PAYG lands separately.

## Risks / Trade-offs

- **Risk: model→group misclassification** routes spend to the wrong bucket or wrongly 403s. Mitigation: `modelGroupOf` is a single pure function with a dedicated test table; new models added there.
- **Trade-off: speed-limit = wait, not auto-PAYG.** Confirmed product decision — protects buyers from surprise charges; boost is opt-in (in #6). Documented in the 429 message ("hourly limit; retry in Ns or enable boost").
- **Risk: plan changes mid-cycle** (website reassigns plan) could orphan a group's accumulated spend. Accepted: spend buckets are keyed by group, not plan, so reassigning to another plan with the same group keeps continuity; changing groups starts a fresh bucket (intended).

## Open Questions

- Is Codex its own group or merged with `gpt`? The plan list names them separately (`codex` $10) but OpenAI models often share pricing. Default: keep `codex` distinct (matches the plan SKU); revisit if it complicates `modelGroupOf`.
- Does `free` overage ever make sense? Default: `plan_free.overageEnabled = false`, no wallet — free stays free or blocks.
