"use client";

import { useActionState, useMemo, useState } from "react";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createListingAction,
  type ListingCreateState,
} from "./listing-actions";

export type InstanceOpt = { id: string; name: string; type: string };
export type AccountOpt = { id: string; providerInstanceId: string; displayName: string; status: string };

export type ListingEditorLabels = {
  title: string;
  model: string;
  inputPrice: string;
  outputPrice: string;
  instance: string;
  account: string;
  create: string;
  created: string;
  noAccounts: string;
};

/**
 * Create-listing form. `source` fixes the trust path: "house" (admin) or
 * "seller" (the caller's own seller — sellerId resolved server-side). The
 * sellerId is never sent from here; the action derives it.
 */
export function ListingEditor({
  source,
  canonicalModels,
  instances,
  accounts,
  labels,
}: {
  source: "house" | "seller";
  canonicalModels: string[];
  instances: InstanceOpt[];
  accounts: AccountOpt[];
  labels: ListingEditorLabels;
}) {
  const [state, action, pending] = useActionState<ListingCreateState, FormData>(
    createListingAction,
    null,
  );
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");

  // Accounts filtered to the chosen instance (an account belongs to one instance).
  const instanceAccounts = useMemo(
    () => accounts.filter((a) => a.providerInstanceId === instanceId),
    [accounts, instanceId],
  );

  const inputCls =
    "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30";

  return (
    <form action={action} className="space-y-3 rounded-xl border border-border bg-card p-5">
      <input type="hidden" name="source" value={source} />
      <p className="text-sm font-semibold text-foreground">{labels.title}</p>

      <div>
        <label className="mb-1 block text-xs font-medium">{labels.model}</label>
        <select name="baseModel" className={inputCls} defaultValue={canonicalModels[0] ?? ""}>
          {canonicalModels.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium">{labels.inputPrice}</label>
          <input name="inputPerM" type="number" step="0.01" min="0" defaultValue="0" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">{labels.outputPrice}</label>
          <input name="outputPerM" type="number" step="0.01" min="0" defaultValue="0" className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium">{labels.instance}</label>
          <select
            name="providerInstanceId"
            className={inputCls}
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
          >
            {instances.map((i) => (
              <option key={i.id} value={i.id}>{i.name} ({i.type})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">{labels.account}</label>
          <select name="providerAccountId" className={inputCls} disabled={instanceAccounts.length === 0}>
            {instanceAccounts.length === 0 ? (
              <option value="">{labels.noAccounts}</option>
            ) : (
              instanceAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.displayName} · {a.status}</option>
              ))
            )}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || instanceAccounts.length === 0}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {state?.ok ? (
            <span className="inline-flex items-center gap-1">
              <Check className="h-4 w-4" /> {labels.created}
            </span>
          ) : (
            labels.create
          )}
        </Button>
        {state?.ok && (
          <code className="font-mono text-xs text-success">{state.namespacedModel}</code>
        )}
        {state?.ok === false && (
          <span className="text-sm text-destructive">{state.error}</span>
        )}
      </div>
    </form>
  );
}
