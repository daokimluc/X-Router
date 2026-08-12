import { setRequestLocale, getTranslations } from "next-intl/server";
import { ConsolePageHeader } from "@/components/console/page-header";
import { WalletView } from "./wallet-view";
import { getServerSession } from "@/lib/xrouter/session";
import { accountStore } from "@/lib/xrouter/account-store";
import { xrouter } from "@/lib/xrouter/adapter";

// Reads the live wallet balance per request.
export const dynamic = "force-dynamic";

export default async function ConsoleWallet({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("walletPage");

  // Resolve the live balance for the current user's key (if they have one).
  let balanceUsd = 0;
  const session = await getServerSession();
  if (session) {
    const acct = accountStore.get(session.email);
    if (acct) {
      const w = await xrouter.getWallet(acct.keyId);
      balanceUsd = w.walletUsd;
    }
  }

  const labels = {
    balance: t("balance"),
    topup: t("topup"),
    history: t("history"),
    colType: t("colType"),
    colDesc: t("colDesc"),
    colDate: t("colDate"),
    colAmount: t("colAmount"),
    empty: t("empty"),
    pageSize: t("pageSize"),
    topupTitle: t("topupTitle"),
    quickPacks: t("quickPacks"),
    customAmount: t("customAmount"),
    total: t("total"),
    cancel: t("cancel"),
    qrCode: t("qrCode"),
    paymentTitle: t("paymentTitle"),
    payInfo: t("payInfo"),
    pending: t("pending"),
    txCode: t("txCode"),
    amount: t("amount"),
    remaining: t("remaining"),
    checking: t("checking"),
    bankInfo: t("bankInfo"),
    scanQr: t("scanQr"),
    account: t("account"),
    bank: t("bank"),
    transferNote: t("transferNote"),
    guide: t("guide"),
    guide1: t("guide1"),
    guide2: t("guide2"),
    guide3: t("guide3"),
    close: t("close"),
    iPaid: t("iPaid"),
    paid: t("paid"),
    pendingConfirm: t("pendingConfirm"),
  };

  return (
    <div className="mx-auto max-w-4xl">
      <ConsolePageHeader title={t("title")} description={t("subtitle")} />
      <WalletView labels={labels} balanceUsd={balanceUsd} />
    </div>
  );
}
