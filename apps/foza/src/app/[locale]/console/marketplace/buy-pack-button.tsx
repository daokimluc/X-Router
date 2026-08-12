"use client";

import { useState, useEffect, useActionState } from "react";
import { Loader2, X, Coins, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buyTokenPackAction,
  packStatusAction,
  type BuyPackState,
} from "./buy-pack-actions";

type Labels = Record<string, string>;
type PackPayment = NonNullable<Extract<BuyPackState, { ok: true }>["payment"]> & {
  usd: number;
  tokens: number;
};

const PACKS = [1_000_000, 5_000_000, 10_000_000];

function fmtTokens(n: number) {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}K`;
}
function vndFmt(n: number) {
  return n.toLocaleString("vi-VN") + " đ";
}

/** Buy a prepaid token pack for a model. Price = sell OUTPUT rate × tokens. */
export function BuyPackButton({
  baseModel,
  sellOutputPerM,
  labels,
}: {
  baseModel: string;
  sellOutputPerM: number;
  labels: Labels;
}) {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState(5_000_000);
  const [payment, setPayment] = useState<PackPayment | null>(null);

  const usd = Math.round((sellOutputPerM * tokens) / 1_000_000 * 100) / 100;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="mt-2 w-full"
        onClick={() => {
          setPayment(null);
          setTokens(5_000_000);
          setOpen(true);
        }}
      >
        <Coins className="h-4 w-4" />
        {labels.buyPack}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative z-10 max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-elevated">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">{labels.buyPackTitle}</h3>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{baseModel}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {payment ? (
              <PackPaymentScreen labels={labels} payment={payment} onDone={() => setOpen(false)} />
            ) : (
              <PackPicker
                baseModel={baseModel}
                tokens={tokens}
                setTokens={setTokens}
                usd={usd}
                labels={labels}
                onStarted={setPayment}
                onCancel={() => setOpen(false)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function PackPicker({
  baseModel,
  tokens,
  setTokens,
  usd,
  labels,
  onStarted,
  onCancel,
}: {
  baseModel: string;
  tokens: number;
  setTokens: (n: number) => void;
  usd: number;
  labels: Labels;
  onStarted: (p: PackPayment) => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState<BuyPackState, FormData>(
    buyTokenPackAction,
    null,
  );

  useEffect(() => {
    if (state?.ok && state.payment) {
      onStarted({ ...state.payment, usd: state.usd, tokens: state.tokens });
    }
  }, [state, onStarted]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="baseModel" value={baseModel} />
      <input type="hidden" name="tokens" value={tokens} />
      <input type="hidden" name="usd" value={usd} />

      <div>
        <label className="mb-2 block text-sm font-medium">{labels.packSize}</label>
        <div className="grid grid-cols-3 gap-2">
          {PACKS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setTokens(p)}
              className={`rounded-lg border px-2 py-2 text-sm font-semibold transition-colors ${
                tokens === p
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:border-primary/40"
              }`}
            >
              {fmtTokens(p)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <span className="text-sm text-muted-foreground">
          {fmtTokens(tokens)} {labels.tokens}
        </span>
        <span className="text-lg font-bold tabular-nums text-foreground">${usd.toFixed(2)}</span>
      </div>

      {state?.ok === false && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {labels.cancel}
        </Button>
        <Button type="submit" size="sm" disabled={pending || usd <= 0}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {labels.continue}
        </Button>
      </div>
    </form>
  );
}

function PackPaymentScreen({
  labels,
  payment,
  onDone,
}: {
  labels: Labels;
  payment: PackPayment;
  onDone: () => void;
}) {
  const [credited, setCredited] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (credited) return;
    let active = true;
    const id = setInterval(async () => {
      try {
        const res = await packStatusAction(payment.memo);
        if (active && res.status === "credited") setCredited(true);
      } catch {
        /* keep polling */
      }
    }, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [payment.memo, credited]);

  if (credited) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/10 p-5 text-center">
        <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-success/15 text-success">
          <Check className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-success">
          {labels.packCredited} — {fmtTokens(payment.tokens)} {labels.tokens}
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
      <div className="rounded-lg border border-border p-4">
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
            onClick={() => {
              navigator.clipboard.writeText(payment.memo);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center gap-1.5 truncate font-mono text-sm font-semibold text-foreground hover:text-primary"
          >
            {payment.memo}
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <Button variant="ghost" size="sm" className="w-full" onClick={onDone}>
        {labels.close}
      </Button>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={`truncate text-sm font-semibold text-foreground ${mono ? "font-mono" : "tabular-nums"}`}>
        {value}
      </span>
    </div>
  );
}
