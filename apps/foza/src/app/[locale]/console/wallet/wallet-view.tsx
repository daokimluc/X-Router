"use client";

import { useState, useEffect, useActionState } from "react";
import { Plus, X, QrCode, Inbox, Loader2, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmTopupAction, topupStatusAction, type TopupState } from "./actions";

type Labels = Record<string, string>;
type Step = "wallet" | "topup" | "payment";
type Payment = NonNullable<Extract<TopupState, { ok: true }>["payment"]> & { usd: number };

const QUICK = [5, 10, 25, 50, 100];

function vndFmt(n: number) {
  return n.toLocaleString("vi-VN") + " đ";
}

export function WalletView({ labels, balanceUsd = 0 }: { labels: Labels; balanceUsd?: number }) {
  const [step, setStep] = useState<Step>("wallet");
  const [amount, setAmount] = useState(5);
  const [payment, setPayment] = useState<Payment | null>(null);

  function openTopup() {
    setAmount(5);
    setPayment(null);
    setStep("topup");
  }
  // Called by the topup form once the server returns the memo + bank details.
  function onTopupStarted(p: Payment) {
    setPayment(p);
    setStep("payment");
  }

  return (
    <>
      {/* Balance card */}
      <div className="mb-6 rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {labels.balance}
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
              ${balanceUsd.toFixed(2)}
            </p>
          </div>
          <Button onClick={openTopup}>
            <Plus className="h-4 w-4" />
            {labels.topup}
          </Button>
        </div>
      </div>

      {/* Transaction history */}
      <h2 className="mb-2 text-sm font-semibold text-foreground">
        {labels.history}
      </h2>
      <div className="w-full overflow-hidden rounded-xl border border-border">
        <div className="w-full overflow-auto bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {[labels.colType, labels.colDesc, labels.colDate, labels.colAmount].map(
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
              <tr>
                <td colSpan={4} className="px-4 py-16 text-center">
                  <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted/50 text-muted-foreground">
                    <Inbox className="h-5 w-5" />
                  </span>
                  <p className="text-sm text-muted-foreground">{labels.empty}</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span>{labels.pageSize}</span>
          <span>1 / 1</span>
        </div>
      </div>

      {/* TOPUP MODAL */}
      {step === "topup" && (
        <Modal title={labels.topupTitle} onClose={() => setStep("wallet")}>
          <div className="space-y-5 py-2">
            <div>
              <label className="mb-2 block text-sm font-medium">
                {labels.quickPacks}
              </label>
              <div className="grid grid-cols-5 gap-2">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setAmount(q)}
                    className={`rounded-lg border px-2 py-2 text-sm font-semibold transition-colors ${
                      amount === q
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    ${q}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">
                {labels.customAmount}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <input
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
                  className="h-10 w-full rounded-lg border border-input bg-background pl-7 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-4">
              <span className="text-sm text-muted-foreground">{labels.total}</span>
              <span className="text-lg font-bold tabular-nums text-foreground">
                ${amount.toFixed(2)}
              </span>
            </div>
          </div>
          <TopupSubmit
            amount={amount}
            labels={labels}
            onStarted={onTopupStarted}
            onCancel={() => setStep("wallet")}
          />
        </Modal>
      )}

      {/* PAYMENT MODAL */}
      {step === "payment" && payment && (
        <Modal title={labels.paymentTitle} onClose={() => setStep("wallet")}>
          <PaymentScreen
            labels={labels}
            payment={payment}
            onDone={() => setStep("wallet")}
          />
        </Modal>
      )}
    </>
  );
}

/** Topup modal footer: submit the amount, get the server memo + bank details. */
function TopupSubmit({
  amount,
  labels,
  onStarted,
  onCancel,
}: {
  amount: number;
  labels: Labels;
  onStarted: (p: Payment) => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState<TopupState, FormData>(
    confirmTopupAction,
    null,
  );

  // When the action returns the payment instructions, advance to the QR screen.
  useEffect(() => {
    if (state?.ok && state.payment) {
      onStarted({ ...state.payment, usd: state.usd });
    }
  }, [state, onStarted]);

  return (
    <form action={formAction} className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
      <input type="hidden" name="usd" value={amount} />
      <Button type="button" variant="ghost" onClick={onCancel}>
        {labels.cancel}
      </Button>
      <Button type="submit" disabled={pending || amount <= 0}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
        {labels.qrCode}
      </Button>
      {state?.ok === false && (
        <p className="text-sm text-destructive sm:self-center">{state.error}</p>
      )}
    </form>
  );
}

/**
 * QR + bank-transfer instructions, driven by server data. Polls the top-up
 * status every few seconds; when SePay's webhook credits it, shows success.
 */
function PaymentScreen({
  labels,
  payment,
  onDone,
}: {
  labels: Labels;
  payment: Payment;
  onDone: () => void;
}) {
  const [credited, setCredited] = useState(false);
  const [copied, setCopied] = useState(false);

  // Poll for the webhook to confirm the transfer (every 4s, stop when credited).
  useEffect(() => {
    if (credited) return;
    let active = true;
    const id = setInterval(async () => {
      try {
        const res = await topupStatusAction(payment.memo);
        if (active && res.status === "credited") setCredited(true);
      } catch {
        /* transient — keep polling */
      }
    }, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [payment.memo, credited]);

  function copyMemo() {
    navigator.clipboard.writeText(payment.memo);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (credited) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/10 p-5 text-center">
        <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-success/15 text-success">
          <Check className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-success">
          {labels.paid} — ${payment.usd.toFixed(2)}
        </p>
        <Button size="sm" className="mt-4" onClick={onDone}>
          {labels.close}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {labels.checking}
      </div>

      {/* QR + bank info (server-authoritative) */}
      <div className="rounded-lg border border-border p-4">
        <p className="mb-3 text-sm font-medium">{labels.bankInfo}</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={payment.qrUrl}
          alt="VietQR"
          width={176}
          height={176}
          className="mx-auto mb-3 h-44 w-44 rounded-lg border border-border bg-white"
        />
        <p className="mb-3 text-center text-xs text-muted-foreground">{labels.scanQr}</p>
        <Row label={labels.account} value={payment.bankAccount} mono />
        <Row label={labels.bank} value={payment.bankName} />
        <Row label={labels.amount} value={vndFmt(payment.vnd)} />
        <div className="flex items-center justify-between gap-3 py-1.5">
          <span className="shrink-0 text-xs text-muted-foreground">{labels.transferNote}</span>
          <button
            type="button"
            onClick={copyMemo}
            className="flex items-center gap-1.5 truncate font-mono text-sm font-semibold text-foreground hover:text-primary"
          >
            {payment.memo}
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* instructions */}
      <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
        <p className="mb-2 font-medium">{labels.guide}</p>
        <ol className="space-y-1.5 text-muted-foreground">
          <li>1. {labels.guide1}</li>
          <li>
            2. {labels.guide2}{" "}
            <span className="font-semibold text-foreground">{vndFmt(payment.vnd)}</span>
          </li>
          <li>
            3. {labels.guide3}{" "}
            <span className="font-mono font-semibold text-foreground">{payment.memo}</span>
          </li>
        </ol>
      </div>

      <Button variant="ghost" size="sm" className="w-full" onClick={onDone}>
        {labels.close}
      </Button>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-elevated">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={`truncate text-sm font-semibold text-foreground ${mono ? "font-mono" : "tabular-nums"}`}
      >
        {value}
      </span>
    </div>
  );
}
