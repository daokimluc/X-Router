"use client";

import { useActionState, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { marketSubscribeAction, type MarketSubscribeState } from "./actions";

export type KeyOption = { keyId: string; label: string };

export function SubscribeButton({
  model,
  keys,
  labels,
}: {
  model: string;
  keys: KeyOption[];
  labels: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<MarketSubscribeState, FormData>(
    marketSubscribeAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">(
    keys.length > 0 ? "existing" : "new",
  );

  const done = state?.ok && state.model === model;

  return (
    <>
      <Button
        type="button"
        size="sm"
        className="mt-auto w-full"
        variant={done ? "ghost" : "primary"}
        disabled={done}
        onClick={() => setOpen(true)}
      >
        {done && <Check className="h-4 w-4" />}
        {done ? labels.subscribed : labels.subscribe}
      </Button>

      {open && !done && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-elevated">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">{labels.modalTitle}</h3>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {model}
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* mode tabs */}
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("existing")}
                disabled={keys.length === 0}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                  mode === "existing"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border"
                }`}
              >
                {labels.addExisting}
              </button>
              <button
                type="button"
                onClick={() => setMode("new")}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  mode === "new"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border"
                }`}
              >
                {labels.createNew}
              </button>
            </div>

            <form action={formAction} className="space-y-4">
              <input type="hidden" name="model" value={model} />
              {mode === "existing" ? (
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    {labels.chooseKey}
                  </label>
                  <select
                    name="keyId"
                    defaultValue={keys[0]?.keyId}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                  >
                    {keys.map((k) => (
                      <option key={k.keyId} value={k.keyId}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <input type="hidden" name="keyId" value="__new__" />
                  <label className="mb-1.5 block text-sm font-medium">
                    {labels.keyName}
                  </label>
                  <input
                    name="label"
                    placeholder={model}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                  />
                </div>
              )}

              {state?.ok === false && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  {labels.cancel}
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {labels.subscribe}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
