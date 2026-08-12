import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { ConsoleShell } from "@/components/console/console-shell";
import { isAdmin } from "@/lib/xrouter/admin";
import { getServerSession } from "@/lib/xrouter/session";
import { accountStore } from "@/lib/xrouter/account-store";
import { xrouter } from "@/lib/xrouter/adapter";

export default async function ConsoleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const admin = await isAdmin();

  return (
    <ConsoleShell
      isAdmin={admin}
      balanceSlot={
        <Suspense fallback={<span className="skeleton inline-block h-4 w-12 align-middle" />}>
          <WalletBalance />
        </Suspense>
      }
    >
      {children}
    </ConsoleShell>
  );
}

/**
 * Live wallet balance for the topbar. Streamed behind a Suspense boundary so
 * the (best-effort) X-Router call never blocks the console shell from
 * rendering. Falls back to the locally cached balance, then 0.
 */
async function WalletBalance() {
  const session = await getServerSession();
  const acct = session ? accountStore.get(session.email) : null;
  let balanceUsd = 0;
  if (acct?.keyId) {
    try {
      balanceUsd = (await xrouter.getWallet(acct.keyId)).walletUsd;
    } catch {
      balanceUsd = acct.walletUsd ?? 0;
    }
  }
  return <>${balanceUsd.toFixed(2)}</>;
}
