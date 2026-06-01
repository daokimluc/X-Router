/**
 * Marketplace key-policy check — usd-wallet (#1) + marketplace-plans (#3).
 *
 * Registered into the engine's enforceKeyPolicy seam. Runs after the engine's
 * own gates (expiry, IP, model allow-list, admin spend caps). Handles:
 *
 *   - Plan-bound keys: model-group scope check (403 model_not_in_plan), then
 *     reserve the request estimate against the plan's hour/day/month buckets on
 *     a per-group ledger scope. Hour/day breach → 429 wait. Month breach →
 *     overage decision (PAYG stub → 402 until #6).
 *   - Plan-less keys with a provisioned wallet: the legacy "wallet empty" 402
 *     gate (preserves usd-wallet #1 behavior).
 *
 * The reservation id (when a plan bucket is held) is stashed on the request so
 * the route handler settles it post-completion, mirroring the engine spend-cap
 * reservation. Stored under `request.planReservation`.
 */

import type { FastifyRequest } from "fastify";
import type { KeyPolicyCheck, KeyPolicyRejection } from "../../services/MarketplaceSeam.js";
import type { ModelPricingService } from "../../services/ModelPricingService.js";
import type { SpendLedgerService } from "../../services/SpendLedgerService.js";
import type { WebhookService } from "../../services/WebhookService.js";
import { secondsUntilNextHourUTC, secondsUntilNextDayUTC, secondsUntilNextMonthUTC } from "../../middleware/enforceKeyPolicy.js";
import type { WalletService } from "../services/WalletService.js";
import type { PlanService } from "../services/PlanService.js";
import type { PaygDecision } from "../services/PaygDecision.js";
import type { MarketPricingService } from "../services/MarketPricingService.js";
import type { PlanSubscriptionService } from "../services/PlanSubscriptionService.js";
import type { TokenGrantService } from "../services/TokenGrantService.js";
import { modelGroupOf, matchesGroups } from "../utils/modelGroup.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Buyer's API key id (marketplace), stashed at enforce for settlement use. */
    buyerKeyId?: string;
    /** Plan bucket reservation held in enforce, settled post-request. */
    planReservation?: { id: string; scope: string; planId?: string; group?: string; monthUsd?: number };
    /**
     * PAYG/boost reservation held in enforce when a request is charged to the
     * wallet instead of the plan bucket. `id` = "walletRes|paygDayRes". Settled
     * (or released) post-request by the route handler.
     */
    payg?: { id: string; reason: "month_overage" | "boost" };
    /**
     * marketplace-token-packs — prepaid pack reservation held in enforce when a
     * request is covered by a usable token pack (consumed ahead of plan + wallet).
     * Settled (or released) post-request on the `tokenpack` track. When set, the
     * request touches neither the plan bucket nor the wallet.
     */
    tokenPack?: { id: string; grantId: string; baseModel: string };
  }
}

export type MarketplacePolicyDeps = {
  walletService: WalletService;
  planService: PlanService;
  spendLedgerService: SpendLedgerService;
  modelPricingService: ModelPricingService;
  paygDecision: PaygDecision;
  /**
   * money-correctness — settlement charges the SELL price (cost × (1+markup)) but
   * the pre-routing estimate only has engine list cost. Inflate the estimate by
   * the default markup so the funds-check + PAYG-daily reservation are on a
   * sell-price-approximate basis (avoids passing a low estimate then draining the
   * wallet to the floor at settle). Optional — falls back to raw list cost.
   */
  marketPricingService?: MarketPricingService;
  /**
   * marketplace-plan-subscription — lazy monthly renewal. When present, a
   * plan-bound key whose period has elapsed is renewed (or downgraded) before the
   * scope/bucket checks. Optional — absent in tests that don't exercise renewal.
   */
  planSubscriptionService?: PlanSubscriptionService;
  /**
   * marketplace-token-packs — prepaid token packs consumed BEFORE plan + wallet.
   * When present, a request whose base model has a usable pack covering its
   * estimate is reserved against the pack and skips the plan/PAYG path. Optional.
   */
  tokenGrantService?: TokenGrantService;
  getBody: (req: FastifyRequest) => { messages?: Array<{ content?: unknown }>; max_tokens?: number } | undefined;
  /** provision-webhook (#7) — emit quota.blocked on a hard rejection. Optional. */
  webhookService?: WebhookService;
};

/**
 * Upper-bound (prompt + output) token estimate for a request. Shared by the
 * cost estimate (plan/PAYG) and the token-pack reserve so both agree on the same
 * basis. Heuristic: input chars / 4 + (max_tokens || 1024).
 */
function estimateUpperBoundTokens(
  body: { messages?: Array<{ content?: unknown }>; max_tokens?: number } | undefined
): { inputTokens: number; outputTokens: number; total: number } {
  const messages = body?.messages ?? [];
  const inputChars = JSON.stringify(messages).length;
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = body?.max_tokens && body.max_tokens > 0 ? body.max_tokens : 1024;
  return { inputTokens, outputTokens, total: inputTokens + outputTokens };
}

function estimateUpperBoundCost(
  model: string,
  body: { messages?: Array<{ content?: unknown }>; max_tokens?: number } | undefined,
  pricing: ModelPricingService
): number {
  const { inputTokens, outputTokens } = estimateUpperBoundTokens(body);
  return pricing.calculateCost(model, inputTokens, outputTokens).totalCost;
}

export function createMarketplacePolicyCheck(deps: MarketplacePolicyDeps): KeyPolicyCheck {
  const evaluate = function marketplacePolicyCheck(ctx: Parameters<KeyPolicyCheck>[0]): KeyPolicyRejection | void {
    const { keyId, model, record } = ctx;
    const planId = record.planId;

    // ── Token pack (marketplace-token-packs): consume BEFORE plan + wallet ────
    // A prepaid pack covering this request's estimate is reserved and the request
    // skips the plan/PAYG path entirely (touches neither bucket nor wallet). An
    // oversized request (estimate > remaining) is left intact and falls through.
    if (model && deps.tokenGrantService) {
      ctx.request.buyerKeyId = keyId; // settlement needs it on the tokenpack track too
      const grant = deps.tokenGrantService.findUsable(keyId, model);
      if (grant) {
        const estTokens = estimateUpperBoundTokens(deps.getBody(ctx.request)).total;
        const r = deps.tokenGrantService.reserve({ grantId: grant.id, estTokens });
        if (r.ok) {
          ctx.request.tokenPack = { id: r.reservationId, grantId: grant.id, baseModel: model };
          return; // allow — settled on the tokenpack track
        }
        // r.ok === false → oversized vs remaining; fall through (no split).
      }
    }

    // ── Lazy monthly renewal (marketplace-plan-subscription) ─────────────────
    // For a plan-bound key, settle any due renewal BEFORE scope/bucket checks.
    // A renewal may charge the wallet (period advances) or downgrade the key to
    // Free when underfunded — in which case the request is rejected and the key
    // falls to the plan-less path on its next request.
    if (planId && deps.planSubscriptionService) {
      const r = deps.planSubscriptionService.renewIfDue(keyId);
      if (r.changed && r.kind === "downgraded") {
        return reject(402, {
          error: {
            type: "insufficient_balance",
            message: "Plan renewal failed: wallet underfunded. Subscription downgraded to Free. Top up and re-subscribe.",
            code: "plan_renewal_failed"
          }
        });
      }
    }

    // ── Plan-less key: legacy wallet-empty gate (usd-wallet #1) ──────────────
    if (!planId) {
      if (deps.walletService.isProvisioned(keyId) && deps.walletService.getUsd(keyId) <= 0) {
        return reject(402, {
          error: { type: "insufficient_balance", message: "API key wallet is empty. Contact admin for a USD top-up.", code: "balance_exhausted" }
        });
      }
      return;
    }

    // ── Plan-bound key ───────────────────────────────────────────────────────
    ctx.request.buyerKeyId = keyId; // for settlement (wallet.low etc.)
    const plan = deps.planService.get(planId);
    if (!plan) return; // plan was deleted; treat as plan-less (no scope/bucket)
    if (!model) return; // no model on this route → no scope/bucket enforcement

    const group = modelGroupOf(model);
    if (!matchesGroups(group, plan.modelGroups, model)) {
      return reject(403, {
        error: {
          type: "forbidden",
          message: `Model "${model}" (group "${group}") is not included in plan "${plan.name}".`,
          code: "model_not_in_plan"
        }
      });
    }

    const scope = `key:${keyId}:grp:${group}`;
    // Inflate the list-cost estimate by the default markup so the reservation +
    // PAYG funds-check approximate the sell price actually charged at settle.
    const markupMult = 1 + (deps.marketPricingService?.getDefaultMarkup() ?? 0);
    const estimateUsd = estimateUpperBoundCost(model, deps.getBody(ctx.request), deps.modelPricingService) * markupMult;
    const reserve = deps.spendLedgerService.reserve({
      scope,
      estimateUsd,
      hourCap: plan.buckets.hourUsd,
      dayCap: plan.buckets.dayUsd,
      monthCap: plan.buckets.monthUsd
    });

    if (reserve.ok) {
      ctx.request.planReservation = { id: reserve.reservationId, scope, planId, group, monthUsd: plan.buckets.monthUsd };
      return;
    }

    const overageEnabled = record.overageEnabled ?? plan.overageEnabled;
    const paygDailyLimitUsd = record.paygDailyLimitUsd ?? plan.paygDailyLimitUsd ?? null;
    const boostEnabled = record.boostEnabled === true || boostHeaderSet(ctx.request);

    // Hour / day speed-limit. Default = WAIT (429). Boost is opt-in: when enabled
    // AND overage is on, serve via PAYG without touching the month budget.
    if (reserve.reason === "hour_cap_exceeded" || reserve.reason === "day_cap_exceeded") {
      if (boostEnabled && overageEnabled) {
        const decision = deps.paygDecision.decide({ keyId, reason: "boost", estimateUsd, paygDailyLimitUsd });
        if (decision.charge) {
          ctx.request.payg = { id: decision.reservationId, reason: "boost" };
          return;
        }
        const rej = rejectionForPaygFailure(decision);
        if (rej) return rej;
      }
      const retryAfter = reserve.reason === "hour_cap_exceeded" ? secondsUntilNextHourUTC() : secondsUntilNextDayUTC();
      return reject(429, {
        error: {
          type: "rate_limit_exceeded",
          message: `Plan speed limit reached (${reserve.reason}). Retry in ${retryAfter}s${overageEnabled ? " or enable boost (x-allow-boost)" : ""}.`,
          code: "spend_limit_exceeded"
        }
      }, { "Retry-After": String(retryAfter) });
    }

    // Month budget exhausted → overage decision.
    if (!overageEnabled) {
      return reject(429, {
        error: {
          type: "rate_limit_exceeded",
          message: `Monthly plan budget exhausted for group "${group}". Overage is disabled.`,
          code: "spend_limit_exceeded"
        }
      }, { "Retry-After": String(secondsUntilNextMonthUTC()) });
    }

    const decision = deps.paygDecision.decide({ keyId, reason: "month_overage", estimateUsd, paygDailyLimitUsd });
    if (decision.charge) {
      ctx.request.payg = { id: decision.reservationId, reason: "month_overage" };
      return;
    }
    const rej = rejectionForPaygFailure(decision);
    if (rej) return rej;
    // Fallback (shouldn't reach): treat as insufficient funds.
    return reject(402, {
      error: { type: "insufficient_balance", message: "Insufficient wallet funds for pay-as-you-go.", code: "balance_exhausted" }
    });
  };

  // Wrap: emit quota.blocked (provision-webhook #7) on any hard rejection.
  return function marketplacePolicyCheckWithEmit(ctx) {
    const rejection = evaluate(ctx);
    if (rejection && deps.webhookService) {
      const code = (rejection.body as { error?: { code?: string } })?.error?.code;
      void deps.webhookService.notifyBusiness("quota.blocked", {
        keyId: ctx.keyId,
        httpStatus: rejection.httpStatus,
        reason: code ?? "unknown",
        model: ctx.model ?? null
      });
    }
    return rejection;
  };
}

/** Map a non-charging PAYG decision to an HTTP rejection (or undefined to fall through). */
function rejectionForPaygFailure(decision: { charge: false; reason: string; retryAfterSeconds?: number }): KeyPolicyRejection | undefined {
  if (decision.reason === "payg_not_implemented") {
    return reject(402, {
      error: { type: "insufficient_balance", message: "Monthly budget exhausted and pay-as-you-go is not enabled yet.", code: "payg_not_implemented" }
    });
  }
  if (decision.reason === "payg_daily_limit") {
    return reject(429, {
      error: { type: "rate_limit_exceeded", message: "PAYG daily limit reached.", code: "payg_daily_limit_exceeded" }
    }, decision.retryAfterSeconds ? { "Retry-After": String(decision.retryAfterSeconds) } : undefined);
  }
  if (decision.reason === "insufficient_funds") {
    return reject(402, {
      error: { type: "insufficient_balance", message: "Insufficient wallet funds for pay-as-you-go.", code: "balance_exhausted" }
    });
  }
  return undefined;
}

function boostHeaderSet(request: FastifyRequest): boolean {
  const h = request.headers?.["x-allow-boost"];
  return h === "true" || h === "1";
}

function reject(httpStatus: number, body: unknown, headers?: Record<string, string>): KeyPolicyRejection {
  return { httpStatus, body, headers };
}
