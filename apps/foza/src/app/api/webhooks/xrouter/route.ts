import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { xrouterConfig } from "@/lib/xrouter/config";
import { ledger } from "@/lib/xrouter/ledger";
import { accountStore } from "@/lib/xrouter/account-store";
import { recordWebhookEvent } from "@/lib/db";
import type {
  WebhookEnvelope,
  UsageRecordedData,
  QuotaBlockedData,
  WalletLowData,
  GrantExhaustedData,
  SupplyUnhealthyData,
  PlanRenewedData,
  PlanDowngradedData,
  SettlementReversedData,
} from "@/lib/xrouter/types";

/** Verify X-Provision-Signature = "sha256=<hmac of exact raw body>". */
function verifySignature(rawBody: string, header: string | null): boolean {
  if (!xrouterConfig.webhookSecret || !header) return false;
  const expected =
    "sha256=" +
    createHmac("sha256", xrouterConfig.webhookSecret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  // Hash the EXACT raw body bytes (not a re-serialization).
  const rawBody = await request.text();
  const signature = request.headers.get("x-provision-signature");

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let envelope: WebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody) as WebhookEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!envelope?.event || !envelope?.timestamp) {
    return NextResponse.json({ error: "malformed envelope" }, { status: 400 });
  }

  // Idempotency keyed by settlementId (Phase 34d.1) — stable per settle, so two
  // identical requests in the same second are NOT collapsed. The reversal event
  // carries the SAME settlementId as the original usage.recorded, so it MUST be
  // namespaced by event or it would be dropped as a "duplicate" of the original
  // settle (and the reversal would never be applied). Fall back to a content key
  // only for non-settlement events that carry no settlementId.
  const data = (envelope.data ?? {}) as Partial<UsageRecordedData>;
  const dedupeKey =
    envelope.event === "settlement.reversed" && data.settlementId
      ? `reversed:${data.settlementId}`
      : (data.settlementId ??
        `${envelope.event}:${envelope.timestamp}:${JSON.stringify(envelope.data)}`);
  const isNew = recordWebhookEvent({
    dedupeKey,
    event: envelope.event,
    rawBody,
    signatureVerified: true,
    requestId: data.requestId,
  });
  if (!isNew) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // Feed the ledger per event type.
  switch (envelope.event) {
    case "usage.recorded":
      ledger.recordUsage(envelope.data as UsageRecordedData);
      break;
    case "quota.blocked":
      ledger.recordBlock(envelope.data as QuotaBlockedData);
      break;
    case "wallet.low":
      ledger.recordWalletLow(envelope.data as WalletLowData);
      break;
    case "grant.exhausted":
      ledger.recordGrantExhausted(envelope.data as GrantExhaustedData);
      break;
    case "supply.unhealthy":
      ledger.recordSupplyUnhealthy(envelope.data as SupplyUnhealthyData);
      break;
    case "plan.renewed": {
      // Paid plan auto-renewed: refresh the cached wallet balance.
      const d = envelope.data as PlanRenewedData;
      if (d.keyId) accountStore.setWalletByKey(d.keyId, d.walletUsd);
      break;
    }
    case "plan.downgraded": {
      // Renewal underfunded → key dropped to Free. Mirror it locally.
      const d = envelope.data as PlanDowngradedData;
      if (d.keyId) {
        accountStore.clearPlanByKey(d.keyId);
        accountStore.setWalletByKey(d.keyId, d.walletUsd);
      }
      break;
    }
    case "settlement.reversed": {
      // A settled request was reversed/refunded — unwind our mirrored money
      // (buyer spend, seller payable, platform margin). markReversed is
      // idempotent and excludes the row from all totals. The reconcile sweep
      // (reversedSince) is the backstop if this realtime event is missed.
      const d = envelope.data as SettlementReversedData;
      if (d.settlementId) ledger.markReversed(d.settlementId);
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
