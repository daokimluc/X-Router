"use client";

import { useActionState, useState } from "react";
import { Check, Loader2, X, Wallet } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { subscribePlanAction, type SubscribeState } from "./actions";

export function SubscribeButton({
  planId,
  planName,
  priceLabel,
  walletLabel,
  isActive = false,
  currentPlanName = null,
  labels,
}: {
  planId: string;
  planName: string;
  priceLabel: string;
  walletLabel: string;
  isActive?: boolean;
  /** Name of the user's current plan when switching FROM it, else null. */
  currentPlanName?: string | null;
  labels: {
    subscribe: string;
    subscribed: string;
    switchTo: string;
    switchWarning: string;
    confirmTitle: string;
    switchConfirmTitle: string;
    allowOverage: string;
    overageDesc: string;
    cancel: string;
    confirm: string;
    confirmSwitch: string;
    topUp: string;
  };
}) {
  const [state, formAction, pending] = useActionState<SubscribeState, FormData>(
    subscribePlanAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const [overage, setOverage] = useState(false);

  const done = isActive || (state?.ok && state.planId === planId);
  // Switching = user already has a different active plan. Grant overwrites it
  // (1 key = 1 plan on the gateway), so make the action read as a switch.
  const isSwitch = !done && currentPlanName != null;

  return (
    <>
      <Button
        type="button"
        className="mt-5 w-full"
        disabled={done}
        variant={done ? "ghost" : "primary"}
        onClick={() => setOpen(true)}
      >
        {done && <Check className="h-4 w-4" />}
        {done ? labels.subscribed : isSwitch ? labels.switchTo : labels.subscribe}
      </Button>

      {open && !done && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-elevated">
            <div className="mb-5 flex items-start justify-between gap-4">
              <h2 className="text-base font-semibold text-foreground">
                {isSwitch ? labels.switchConfirmTitle : labels.confirmTitle} {planName}
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* switch warning — current plan will be replaced */}
              {isSwitch && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                  {labels.switchWarning.replace("{plan}", currentPlanName)}
                </div>
              )}

              {/* summary box */}
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <p className="text-sm font-medium">{priceLabel}</p>
                <p className="mt-1 text-xs text-muted-foreground">{walletLabel}</p>
              </div>

              {/* overage toggle */}
              <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-4 py-3">
                <div>
                  <label className="text-sm font-medium">{labels.allowOverage}</label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {labels.overageDesc}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={overage}
                  onClick={() => setOverage((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    overage ? "bg-primary" : "bg-input"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      overage ? "translate-x-[22px]" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {state?.ok === false && (
                <div className="space-y-2">
                  <p className="text-sm text-destructive">{state.error}</p>
                  {state.needTopup && (
                    <Button asChild variant="ghost" size="sm" className="w-full">
                      <Link href="/console/wallet">
                        <Wallet className="h-4 w-4" />
                        {labels.topUp}
                      </Link>
                    </Button>
                  )}
                </div>
              )}
            </div>

            <form
              action={formAction}
              className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
            >
              <input type="hidden" name="planId" value={planId} />
              <input type="hidden" name="overageEnabled" value={String(overage)} />
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSwitch ? labels.confirmSwitch : labels.confirm}
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
