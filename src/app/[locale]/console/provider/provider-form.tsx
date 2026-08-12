"use client";

import { useActionState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { registerSellerAction, type ProviderState } from "./actions";

type Labels = Record<string, string>;

export function ProviderForm({ labels }: { labels: Labels }) {
  const [state, formAction, pending] = useActionState<ProviderState, FormData>(
    registerSellerAction,
    null,
  );

  if (state?.ok) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/10 p-6 text-center">
        <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-success text-white">
          <Check className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-foreground">{labels.submitted}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {labels.sellerId}: {state.sellerId} · {state.status}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">{labels.registerTitle}</h2>
      <form action={formAction} className="mt-5 space-y-4">
        <Field name="displayName" label={labels.displayName} required placeholder="Hoang" />
        <Field name="slug" label={labels.slug} required placeholder="hoang" hint={labels.slugHint} />
        <Field name="email" label={labels.email} required type="email" placeholder="you@example.com" />
        <Field name="telegram" label={labels.telegram} required placeholder="@username" />
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            {labels.description}{" "}
            <span className="font-normal text-muted-foreground">({labels.optional})</span>
          </label>
          <textarea
            name="description"
            rows={3}
            maxLength={500}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
          />
          <div className="mt-1 text-right text-xs text-muted-foreground">0/500</div>
        </div>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" required className="h-4 w-4 rounded border-input accent-primary" />
          <span>
            {labels.agree}{" "}
            <a href="#" className="font-medium text-primary hover:underline">
              {labels.terms}
            </a>
          </span>
        </label>
        {state?.ok === false && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {labels.submit}
        </Button>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  required,
  type = "text",
  placeholder,
  hint,
}: {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
        {hint && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{hint}</span>
        )}
      </label>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
      />
    </div>
  );
}
