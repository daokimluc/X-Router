"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  ListingEditor,
  type InstanceOpt,
  type AccountOpt,
} from "../provider/listing-editor";

/**
 * "Add model" entry point on the My Models page. For an approved seller it
 * toggles the ListingEditor (source=seller, sellerId resolved server-side). For
 * a non-seller it points them to provider registration.
 */
export function AddModelPanel({
  isApprovedSeller,
  canonicalModels,
  instances,
  accounts,
  labels,
}: {
  isApprovedSeller: boolean;
  canonicalModels: string[];
  instances: InstanceOpt[];
  accounts: AccountOpt[];
  labels: {
    addModel: string;
    cancel: string;
    notSeller: string;
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
}) {
  const [open, setOpen] = useState(false);

  if (!isApprovedSeller) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
        <p className="text-sm text-muted-foreground">{labels.notSeller}</p>
        <Button asChild size="sm" variant="ghost">
          <Link href="/console/provider">{labels.addModel}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {open ? labels.cancel : labels.addModel}
        </Button>
      </div>
      {open && (
        <ListingEditor
          source="seller"
          canonicalModels={canonicalModels}
          instances={instances}
          accounts={accounts}
          labels={{
            title: labels.title,
            model: labels.model,
            inputPrice: labels.inputPrice,
            outputPrice: labels.outputPrice,
            instance: labels.instance,
            account: labels.account,
            create: labels.create,
            created: labels.created,
            noAccounts: labels.noAccounts,
          }}
        />
      )}
    </div>
  );
}
