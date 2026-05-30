/**
 * Marketplace seam (engine side).
 *
 * The engine must never import from `marketplace/` (open-core boundary). But
 * some engine code — request-policy enforcement, persistence — needs to invoke
 * behavior the marketplace layer provides when it is enabled. This module
 * defines generic, marketplace-agnostic extension points the engine owns and
 * the marketplace fills at registration time (`registerMarketplace`).
 *
 * When the marketplace flag is off, none of these are populated and the engine
 * behaves exactly as the plain self-host gateway.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import type { InternalApiKeyRecord } from "./ApiKeyService.js";
import type { ResolvedModelCandidate } from "../router/ModelResolver.js";

/**
 * Reorders the resolved candidates for a pooled model. The marketplace fills
 * this with cheapest-seller-first ranking (lowest-cost-routing-wiring). The
 * engine calls it right after model resolution, before the failover loop, so a
 * pooled request tries the cheapest seller first and fails over to the next
 * cheapest. Identity (unchanged order) when the marketplace is off. Takes/returns
 * the engine's own candidate type — no marketplace coupling.
 */
export type CandidateRanker = (
  model: string,
  candidates: ResolvedModelCandidate[]
) => ResolvedModelCandidate[];

/**
 * Capture the routed settlement context onto the request from the account the
 * engine actually leased (lowest-cost-routing-wiring). The marketplace resolves
 * the leased account's listing cost + sell rates and stashes `request.routed`.
 * No-op when the marketplace is off or the account has no listing cost.
 */
export type RoutedCapture = (
  request: FastifyRequest,
  model: string,
  accountId: string
) => void;

/**
 * A policy check run during `enforceKeyPolicy`, after the engine's own gates.
 * Return a rejection to stop the request (the enforcer sends it and halts), or
 * `undefined`/void to allow it to proceed. Checks run in registration order;
 * the first rejection wins.
 *
 * `record` is the resolved API key record (engine type; the marketplace reads
 * its plan/wallet/overage fields). The seam imports the type only — no runtime
 * coupling, and the dependency direction stays marketplace → engine.
 */
export type KeyPolicyCheck = (ctx: {
  request: FastifyRequest;
  reply: FastifyReply;
  apiKeyHash: string;
  keyId: string;
  model: string | undefined;
  record: InternalApiKeyRecord;
}) => Promise<KeyPolicyRejection | void> | KeyPolicyRejection | void;

export type KeyPolicyRejection = {
  httpStatus: number;
  headers?: Record<string, string>;
  body: unknown;
};

/**
 * Contributes a named slice to the persisted gateway state and restores it on
 * load. `toPersisted` is called when the engine snapshots state; `slice` lands
 * under `state.marketplace[name]`.
 */
export type PersistenceContributor = {
  name: string;
  toPersisted: () => unknown;
};

/**
 * Post-request settlement hook (two-sided-settlement #6). The engine route
 * handler calls every registered settler after a billable request completes
 * (`outcome: "success"`) or fails (`outcome: "failure"`). The marketplace
 * settles the buyer (plan bucket or wallet) and credits the seller. The engine
 * passes only primitives + the request; it never imports marketplace types.
 */
export type SettlementHook = (ctx: {
  request: import("fastify").FastifyRequest;
  outcome: "success" | "failure";
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
}) => void;

/**
 * Engine-owned registry of marketplace extension points. Decorated onto the app
 * unconditionally (empty when the marketplace is off). The marketplace pushes
 * into these during `registerMarketplace`.
 */
export class MarketplaceSeam {
  readonly keyPolicyChecks: KeyPolicyCheck[] = [];
  readonly persistenceContributors: PersistenceContributor[] = [];
  readonly settlementHooks: SettlementHook[] = [];
  private candidateRanker: CandidateRanker | null = null;
  private routedCapture: RoutedCapture | null = null;

  addKeyPolicyCheck(check: KeyPolicyCheck): void {
    this.keyPolicyChecks.push(check);
  }

  addPersistenceContributor(contributor: PersistenceContributor): void {
    this.persistenceContributors.push(contributor);
  }

  addSettlementHook(hook: SettlementHook): void {
    this.settlementHooks.push(hook);
  }

  /** Register the cheapest-first candidate ranker (lowest-cost-routing-wiring). */
  setCandidateRanker(fn: CandidateRanker): void {
    this.candidateRanker = fn;
  }

  /** Register the routed-context capture run after a lease is acquired. */
  setRoutedCapture(fn: RoutedCapture): void {
    this.routedCapture = fn;
  }

  /** Capture routed settlement context from the leased account. No-op when unset. */
  captureRouted(request: FastifyRequest, model: string, accountId: string): void {
    if (!this.routedCapture) return;
    try {
      this.routedCapture(request, model, accountId);
    } catch {
      // never break the request path on a capture failure
    }
  }

  /**
   * Reorder candidates via the registered ranker. Identity when none is set
   * (marketplace off). Errors are swallowed → fall back to engine order.
   */
  rankCandidates<T extends ResolvedModelCandidate>(model: string, candidates: T[]): T[] {
    if (!this.candidateRanker) return candidates;
    try {
      return this.candidateRanker(model, candidates) as T[];
    } catch {
      return candidates;
    }
  }

  /** Run all settlement hooks (success or failure). Errors are swallowed per-hook. */
  runSettlement(ctx: Parameters<SettlementHook>[0]): void {
    for (const hook of this.settlementHooks) {
      try {
        hook(ctx);
      } catch {
        // settlement must never break the response path
      }
    }
  }

  /** Snapshot all contributor slices into a single record (for persistence). */
  collectPersisted(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const c of this.persistenceContributors) {
      out[c.name] = c.toPersisted();
    }
    return out;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    marketplaceSeam: MarketplaceSeam;
    /** Trigger a debounced/immediate persist of the full gateway state. */
    persistState: () => void;
  }
}
