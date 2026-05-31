import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config.js";
import { hashApiKey } from "../utils/hash.js";

export type ProvisionAuthContext = {
  apiKeyHash: string;
};

declare module "fastify" {
  interface FastifyRequest {
    provisionAuth?: ProvisionAuthContext;
  }
}

/**
 * provision-webhook (#7) — authenticate /provision/* requests against the
 * dedicated provision API keys. Distinct from admin + client keys: a provision
 * key is never accepted elsewhere, and admin/client keys are never accepted
 * here. Snapshot is fine — provision keys are not changed at runtime.
 */
export function createProvisionAuthMiddleware(config: AppConfig) {
  const keys = config.provisionApiKeys;
  return async function provisionAuthMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const token = parseBearerToken(request.headers.authorization);
    if (!token || !matchesAnyKey(token, keys)) {
      await reply.code(401).send({
        error: {
          type: "authentication_error",
          message: "Missing or invalid provision API key",
          code: "invalid_provision_api_key"
        }
      });
      return;
    }
    request.provisionAuth = { apiKeyHash: hashApiKey(token) };
  };
}

/**
 * Constant-time membership: compare the candidate against every configured key
 * with timingSafeEqual (over their sha256 hashes, so unequal lengths don't leak
 * and don't throw). The provision key is a god-mode secret — avoid leaking it
 * byte-by-byte via comparison timing. Always scans all keys (no early return).
 */
function matchesAnyKey(token: string, keys: string[]): boolean {
  const candidate = createHash("sha256").update(token).digest();
  let matched = false;
  for (const key of keys) {
    const known = createHash("sha256").update(key).digest();
    if (candidate.length === known.length && timingSafeEqual(candidate, known)) {
      matched = true;
    }
  }
  return matched;
}

function parseBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
