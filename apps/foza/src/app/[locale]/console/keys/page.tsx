import { setRequestLocale, getTranslations } from "next-intl/server";
import { ConsolePageHeader } from "@/components/console/page-header";
import { KeysManager } from "./keys-manager";
import { getServerSession } from "@/lib/xrouter/session";
import { accountStore } from "@/lib/xrouter/account-store";
import { ledger } from "@/lib/xrouter/ledger";
import { xrouter } from "@/lib/xrouter/adapter";

// Reads the user's keys + per-key usage per request.
export const dynamic = "force-dynamic";

export default async function ConsoleKeys({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("keysPage");

  const session = await getServerSession();
  const acct = session ? accountStore.get(session.email) : null;

  // Live key state (enabled/expiresAt) from X-Router, keyed by id. Best-effort:
  // empty when disabled/unreachable, so the UI still renders local data.
  const live = session ? await xrouter.listKeys(session.email) : [];
  const liveById = new Map(live.map((k) => [k.id, k]));

  const keys = (acct?.keys ?? []).map((k) => {
    const usage = ledger.forKey(k.keyId);
    const state = liveById.get(k.keyId);
    return {
      keyId: k.keyId,
      label: k.label,
      masked: k.keyMasked,
      models: k.models,
      requests: usage.requests,
      cost: `$${usage.spendUsd.toFixed(2)}`,
      enabled: state ? state.enabled : true,
      expiresAt: state?.expiresAt ?? null,
    };
  });

  const totalRequests = keys.reduce((a, k) => a + k.requests, 0);
  const totalCostUsd = (acct?.keys ?? []).reduce(
    (a, k) => a + ledger.forKey(k.keyId).spendUsd,
    0,
  );

  // Token packs across all of the user's keys (compact form from listKeys).
  const fmtTokens = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
  const fmtExpiry = (ms: number | null) =>
    ms ? new Date(ms).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US") : "—";
  const packs = live.flatMap((k) =>
    (k.tokenPacks ?? []).map((p) => ({
      baseModel: p.baseModel,
      remaining: fmtTokens(p.tokensRemaining),
      expires: fmtExpiry(p.expiresAt),
      depleted: p.tokensRemaining === 0 || (p.expiresAt != null && p.expiresAt <= Date.now()),
    })),
  );

  return (
    <div className="mx-auto max-w-6xl">
      <ConsolePageHeader title={t("title")} description={t("subtitle")} />

      {keys.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          <Stat label={t("statKeys")} value={String(keys.length)} />
          <Stat label={t("statRequests")} value={String(totalRequests)} />
          <Stat label={t("statCost")} value={`$${totalCostUsd.toFixed(2)}`} />
        </div>
      )}

      {packs.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground">{t("tokenPacks")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {packs.map((p, i) => (
              <div
                key={`${p.baseModel}-${i}`}
                className="rounded-xl border border-border bg-card p-4"
              >
                <p className="truncate font-mono text-xs text-muted-foreground">{p.baseModel}</p>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${p.depleted ? "text-muted-foreground line-through" : "text-foreground"}`}>
                  {p.remaining}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">{t("tokensLeft")}</span>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("expires")} {p.expires}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <KeysManager
        keys={keys}
        labels={{
          newKey: t("newKey"),
          search: t("search"),
          allStatus: t("allStatus"),
          colName: t("colName"),
          colModels: t("colModels"),
          colRequests: t("colRequests"),
          colCost: t("colCost"),
          colStatus: t("colStatus"),
          connected: t("connected"),
          details: t("details"),
          empty: t("empty"),
          emptyHint: t("emptyHint"),
          keyName: t("keyName"),
          created: t("created"),
          copy: t("copy"),
          create: t("create"),
          cancel: t("cancel"),
          pageSize: t("pageSize"),
          // Raw template — the client fills {n} after filtering revoked keys.
          // Calling t("showing") here would throw on the missing placeholder.
          showing: t.raw("showing"),
          enabled: t("enabled"),
          disabled: t("disabled"),
          disable: t("disable"),
          enable: t("enable"),
          revoke: t("revoke"),
          rotate: t("rotate"),
          rotated: t("rotated"),
          hideRevoked: t("hideRevoked"),
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
