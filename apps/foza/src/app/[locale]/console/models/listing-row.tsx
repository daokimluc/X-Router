"use client";

import { useActionState } from "react";
import { Power, Trash2, Loader2 } from "lucide-react";
import { ProviderLogo } from "@/components/brand/brand-logo";
import {
  toggleListingAction,
  deleteListingAction,
  type ListingActionState,
} from "./actions";

export type MyListing = {
  id: string;
  model: string;
  namespaced: string;
  provider: string;
  inputPerM: string;
  outputPerM: string;
  enabled: boolean;
  requests: string;
};

export function ListingRow({
  listing,
  labels,
}: {
  listing: MyListing;
  labels: Record<string, string>;
}) {
  const [toggleState, toggle, toggling] = useActionState<ListingActionState, FormData>(
    toggleListingAction,
    null,
  );
  const [delState, del, deleting] = useActionState<ListingActionState, FormData>(
    deleteListingAction,
    null,
  );

  // Optimistic enabled state after a successful toggle.
  const enabled = toggleState?.ok ? !listing.enabled : listing.enabled;
  const removed = delState?.ok;
  if (removed) return null;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-background text-foreground [&_svg]:h-5 [&_svg]:w-5">
        <ProviderLogo provider={listing.provider} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">
            {listing.model}
          </p>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
              enabled
                ? "bg-success/15 text-success"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {enabled ? labels.active : labels.disabled}
          </span>
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {listing.namespaced}
        </p>
      </div>

      <div className="hidden text-right sm:block">
        <p className="text-xs text-muted-foreground">{labels.pricing}</p>
        <p className="font-mono text-xs text-foreground">
          {listing.inputPerM} / {listing.outputPerM}
          <span className="text-muted-foreground"> /M</span>
        </p>
      </div>

      <div className="hidden text-right md:block">
        <p className="text-xs text-muted-foreground">{labels.requests}</p>
        <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {listing.requests}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <form action={toggle}>
          <input type="hidden" name="id" value={listing.id} />
          <input type="hidden" name="enabled" value={String(enabled)} />
          <button
            type="submit"
            disabled={toggling}
            title={enabled ? labels.disable : labels.enable}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            {toggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Power className="h-4 w-4" />
            )}
          </button>
        </form>
        <form action={del}>
          <input type="hidden" name="id" value={listing.id} />
          <button
            type="submit"
            disabled={deleting}
            title={labels.delete}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
