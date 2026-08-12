"use client";

import { useActionState, useState } from "react";
import { Plus, Search, Copy, Check, X, Power, RotateCw, Trash2 } from "lucide-react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createKeyAction,
  disableKeyAction,
  enableKeyAction,
  revokeKeyAction,
  rotateKeyAction,
  type CreateKeyState,
  type KeyLifecycleState,
} from "./actions";

export type KeyRow = {
  keyId: string;
  label: string;
  masked: string;
  models: string[];
  requests: number;
  cost: string;
  enabled: boolean;
  expiresAt: string | null;
};

type KeyLabels = {
  newKey: string;
  search: string;
  allStatus: string;
  colName: string;
  colModels: string;
  colRequests: string;
  colCost: string;
  colStatus: string;
  connected: string;
  details: string;
  empty: string;
  emptyHint: string;
  keyName: string;
  created: string;
  copy: string;
  create: string;
  cancel: string;
  pageSize: string;
  showing: string;
  enabled: string;
  disabled: string;
  disable: string;
  enable: string;
  revoke: string;
  rotate: string;
  rotated: string;
  hideRevoked: string;
};

export function KeysManager({
  keys,
  labels,
}: {
  keys: KeyRow[];
  labels: KeyLabels;
}) {
  const [state, formAction, pending] = useActionState<CreateKeyState, FormData>(
    createKeyAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hideRevoked, setHideRevoked] = useState(true);

  const visibleKeys = hideRevoked ? keys.filter((k) => k.enabled) : keys;

  const columns = [
    labels.colName,
    labels.colModels,
    labels.colRequests,
    labels.colCost,
    labels.colStatus,
  ];

  return (
    <div className="space-y-4">
      {/* created-key banner */}
      {state?.ok && (
        <div className="rounded-xl border border-success/30 bg-success/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-success">
            <Check className="h-4 w-4" /> {labels.created}
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-3">
            <code className="flex-1 truncate font-mono text-sm">{state.key}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(state.key);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {labels.copy}
            </Button>
          </div>
        </div>
      )}

      {/* toolbar */}
      <div className="w-full overflow-hidden rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card p-3">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder={labels.search}
              className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground">
              <input
                type="checkbox"
                checked={hideRevoked}
                onChange={(e) => setHideRevoked(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              {labels.hideRevoked}
            </label>
            <Button size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {open ? labels.cancel : labels.newKey}
            </Button>
          </div>
        </div>

        {/* inline create form */}
        {open && !state?.ok && (
          <form
            action={formAction}
            className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 p-3"
          >
            <input
              name="label"
              placeholder={labels.keyName}
              className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
            <Button size="sm" type="submit" disabled={pending}>
              {labels.create}
            </Button>
          </form>
        )}
        {state?.ok === false && (
          <p className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {state.error}
          </p>
        )}

        {/* table */}
        <div className="w-full overflow-auto bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {columns.map((c, i) => (
                  <th
                    key={c + i}
                    className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleKeys.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-16 text-center">
                    <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted/50 text-muted-foreground">
                      <Inbox className="h-5 w-5" />
                    </span>
                    <p className="text-sm text-muted-foreground">{labels.empty}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {labels.emptyHint}
                    </p>
                  </td>
                </tr>
              ) : (
                visibleKeys.map((k) => (
                  <tr
                    key={k.keyId}
                    className="border-b border-border last:border-0 hover:bg-accent/30"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{k.label}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {k.masked}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">
                        {labels.connected} {k.models.length}
                      </span>
                      {k.models[0] && (
                        <div className="font-mono text-xs text-foreground">
                          {k.models[0]}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{k.requests}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{k.cost}</td>
                    <td className="px-4 py-3">
                      <KeyActions row={k} labels={labels} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            {visibleKeys.length > 0
              ? labels.showing.replace("{n}", String(visibleKeys.length))
              : labels.pageSize}
          </span>
          <span>1 / 1</span>
        </div>
      </div>
    </div>
  );
}

function KeyActions({ row, labels }: { row: KeyRow; labels: KeyLabels }) {
  const [, disable, disabling] = useActionState<KeyLifecycleState, FormData>(disableKeyAction, null);
  const [, enable, enabling] = useActionState<KeyLifecycleState, FormData>(enableKeyAction, null);
  const [revState, revoke, revoking] = useActionState<KeyLifecycleState, FormData>(revokeKeyAction, null);
  const [rotState, rotate, rotating] = useActionState<KeyLifecycleState, FormData>(rotateKeyAction, null);
  const [copied, setCopied] = useState(false);

  const rotatedKey = rotState?.ok && rotState.action === "rotate" ? rotState.key : null;
  const err =
    (revState && !revState.ok && revState.error) ||
    (rotState && !rotState.ok && rotState.error) ||
    null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            row.enabled
              ? "bg-success/15 text-success"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {row.enabled ? labels.enabled : labels.disabled}
        </span>
        {row.enabled ? (
          <form action={disable}>
            <input type="hidden" name="keyId" value={row.keyId} />
            <button type="submit" disabled={disabling} title={labels.disable} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary">
              <Power className="h-3.5 w-3.5" />
            </button>
          </form>
        ) : (
          <form action={enable}>
            <input type="hidden" name="keyId" value={row.keyId} />
            <button type="submit" disabled={enabling} title={labels.enable} className="grid h-7 w-7 place-items-center rounded-md text-success hover:bg-success/10">
              <Power className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
        <form action={rotate}>
          <input type="hidden" name="keyId" value={row.keyId} />
          <button type="submit" disabled={rotating} title={labels.rotate} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary">
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        </form>
        <form action={revoke}>
          <input type="hidden" name="keyId" value={row.keyId} />
          <button type="submit" disabled={revoking} title={labels.revoke} className="grid h-7 w-7 place-items-center rounded-md text-destructive hover:bg-destructive/10">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
      {rotatedKey && (
        <div className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2 py-1">
          <span className="text-[11px] text-success">{labels.rotated}</span>
          <code className="max-w-[180px] truncate font-mono text-[11px]">{rotatedKey}</code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(rotatedKey);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
      {err && <span className="text-[11px] text-destructive">{err}</span>}
    </div>
  );
}
