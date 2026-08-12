import { setRequestLocale, getTranslations } from "next-intl/server";
import { Activity, Coins, CircleDollarSign, Inbox } from "lucide-react";
import { ConsolePageHeader } from "@/components/console/page-header";
import { ledger } from "@/lib/xrouter/ledger";
import { xrouter } from "@/lib/xrouter/adapter";
import { getServerSession } from "@/lib/xrouter/session";
import { accountStore } from "@/lib/xrouter/account-store";

// Per-request, scoped to the signed-in user's own keys (never platform-wide).
export const dynamic = "force-dynamic";

/** ISO timestamp N days ago. Isolated so the render body stays pure. */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export default async function ConsoleUsage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("usagePage");

  // Scope everything to the signed-in user's own keys.
  const session = await getServerSession();
  const acct = session ? accountStore.get(session.email) : null;
  const myKeyIds = (acct?.keys ?? []).map((k) => k.keyId);

  // KPIs + per-model breakdown from this user's billing rows only.
  const mine = ledger.forKeys(myKeyIds);
  const byModel = ledger.byModelForKeys(myKeyIds);

  // Recent usage records (reconciliation-grade) for THIS user's keys. The
  // gateway filters by a single keyId, so query per key and merge.
  const since = daysAgoIso(30);
  const pages = await Promise.all(
    myKeyIds.map((id) => xrouter.getUsageSince(since, id, 50)),
  );
  const records = pages
    .flatMap((p) => p.data)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 50);
  const totalTokens = byModel.reduce((a, m) => a + m.tokens, 0);

  const kpis = [
    { icon: Activity, label: t("totalRequests"), value: String(mine.requests) },
    { icon: Coins, label: t("totalTokens"), value: totalTokens.toLocaleString() },
    { icon: CircleDollarSign, label: t("totalCost"), value: `$${mine.spendUsd.toFixed(2)}` },
  ];

  const fmtTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(locale === "vi" ? "vi-VN" : "en-US");
    } catch {
      return iso;
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <ConsolePageHeader title={t("title")} description={t("subtitle")} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-5">
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
              <k.icon className="h-4 w-4" />
              <p className="text-xs font-medium uppercase tracking-wider">
                {k.label}
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {k.value}
            </p>
          </div>
        ))}
      </div>

      {/* Per-model breakdown — what this user spent on each model */}
      {byModel.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            {t("perModelTitle")}
          </h2>
          <div className="mb-6 w-full overflow-hidden rounded-xl border border-border">
            <div className="w-full overflow-auto bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {[t("colModel"), t("colRequests"), t("totalTok"), t("colSpend")].map((c) => (
                      <th
                        key={c}
                        className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((m) => (
                    <tr key={m.model} className="border-b border-border last:border-0 hover:bg-accent/30">
                      <td className="px-4 py-3 font-mono text-xs">{m.model}</td>
                      <td className="px-4 py-3 tabular-nums">{m.requests}</td>
                      <td className="px-4 py-3 tabular-nums">{m.tokens.toLocaleString()}</td>
                      <td className="px-4 py-3 font-semibold tabular-nums">
                        ${m.spendUsd.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <h2 className="mb-2 text-sm font-semibold text-foreground">
        {t("requestLog")}
      </h2>
      <div className="w-full overflow-hidden rounded-xl border border-border">
        <div className="w-full overflow-auto bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {[t("time"), t("model"), t("input"), t("output"), t("totalTok")].map(
                  (c) => (
                    <th
                      key={c}
                      className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {c}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center">
                    <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted/50 text-muted-foreground">
                      <Inbox className="h-5 w-5" />
                    </span>
                    <p className="text-sm text-muted-foreground">{t("empty")}</p>
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr
                    key={r.requestId}
                    className="border-b border-border last:border-0 hover:bg-accent/30"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {fmtTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{r.model}</td>
                    <td className="px-4 py-3 tabular-nums">{r.promptTokens}</td>
                    <td className="px-4 py-3 tabular-nums">{r.completionTokens}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums">
                      {r.totalTokens}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span>{t("showing", { n: records.length })}</span>
          <span>{records.length >= 50 ? "50+" : "1 / 1"}</span>
        </div>
      </div>
    </div>
  );
}
