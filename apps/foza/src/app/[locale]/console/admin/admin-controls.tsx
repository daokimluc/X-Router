"use client";

import { useActionState } from "react";
import { Check, Loader2, Trash2, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  approveSellerAction,
  suspendSellerAction,
  setMarkupAction,
  setWebhookAction,
  savePlanAction,
  deletePlanAction,
  addCanonicalAction,
  removeCanonicalAction,
  type AdminState,
} from "./actions";
import { setRoleAction, type RoleActionState } from "./role-actions";

export function SellerRow({
  seller,
  labels,
}: {
  seller: { id: string; displayName: string; status: string };
  labels: { approve: string; suspend: string };
}) {
  const [aState, approve, approving] = useActionState<AdminState, FormData>(
    approveSellerAction,
    null,
  );
  const [, suspend, suspending] = useActionState<AdminState, FormData>(
    suspendSellerAction,
    null,
  );
  const done = aState?.ok;

  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {seller.displayName}
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {seller.id}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {done ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
            <Check className="h-4 w-4" /> {aState?.msg}
          </span>
        ) : (
          <>
            <form action={approve}>
              <input type="hidden" name="sellerId" value={seller.id} />
              <Button type="submit" size="sm" disabled={approving}>
                {approving && <Loader2 className="h-4 w-4 animate-spin" />}
                {labels.approve}
              </Button>
            </form>
            <form action={suspend}>
              <input type="hidden" name="sellerId" value={seller.id} />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                disabled={suspending}
                className="text-destructive hover:bg-destructive/10"
              >
                {suspending && <Loader2 className="h-4 w-4 animate-spin" />}
                {labels.suspend}
              </Button>
            </form>
          </>
        )}
      </div>
    </li>
  );
}

export function MarkupForm({
  defaultMarkup,
  labels,
}: {
  defaultMarkup: number;
  labels: { label: string; hint: string; save: string; saved: string };
}) {
  const [state, action, pending] = useActionState<AdminState, FormData>(
    setMarkupAction,
    null,
  );
  return (
    <form action={action} className="rounded-xl border border-border bg-card p-5">
      <label className="mb-1.5 block text-sm font-medium">{labels.label}</label>
      <p className="mb-3 text-xs text-muted-foreground">{labels.hint}</p>
      <div className="flex items-center gap-2">
        <input
          name="defaultMarkup"
          type="number"
          step="0.01"
          min="0"
          defaultValue={defaultMarkup}
          className="h-10 w-32 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
        />
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {state?.ok ? `${labels.saved} (${state.msg})` : labels.save}
        </Button>
      </div>
      {state?.ok === false && (
        <p className="mt-2 text-sm text-destructive">{state.error}</p>
      )}
    </form>
  );
}

export function WebhookForm({
  config,
  labels,
}: {
  config: { url: string; enabled: boolean; secretSet: boolean };
  labels: {
    url: string;
    secret: string;
    secretSet: string;
    enabled: string;
    save: string;
    saved: string;
  };
}) {
  const [state, action, pending] = useActionState<AdminState, FormData>(
    setWebhookAction,
    null,
  );
  return (
    <form action={action} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium">{labels.url}</label>
        <input
          name="url"
          type="url"
          defaultValue={config.url}
          placeholder="https://vexa.ai/api/webhooks/xrouter"
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">{labels.secret}</label>
        <input
          name="secret"
          type="password"
          placeholder={config.secretSet ? "••••••••" : ""}
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
        />
        {config.secretSet && (
          <p className="mt-1 text-xs text-muted-foreground">{labels.secretSet}</p>
        )}
      </div>
      <label className="flex items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={config.enabled}
          className="h-4 w-4 rounded border-input accent-primary"
        />
        {labels.enabled}
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {state?.ok ? `${labels.saved} (${state.msg})` : labels.save}
        </Button>
        {state?.ok === false && (
          <span className="text-sm text-destructive">{state.error}</span>
        )}
      </div>
    </form>
  );
}

type PlanLite = {
  id: string;
  name: string;
  priceUsd: number;
  modelGroups: string[];
  buckets: { hourUsd: number; dayUsd: number; monthUsd: number };
  overageEnabled: boolean;
};

/** Create or edit one plan. `plan` undefined → create form. */
export function PlanEditor({
  plan,
  labels,
}: {
  plan?: PlanLite;
  labels: { name: string; price: string; groups: string; hour: string; day: string; month: string; overage: string; save: string; create: string; saved: string; del: string };
}) {
  const [state, save, saving] = useActionState<AdminState, FormData>(savePlanAction, null);
  const [delState, del, deleting] = useActionState<AdminState, FormData>(deletePlanAction, null);
  const inputCls =
    "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30";

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <form action={save} className="space-y-3">
        {plan && <input type="hidden" name="id" value={plan.id} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium">{labels.name}</label>
            <input name="name" defaultValue={plan?.name} className={inputCls} placeholder="Pro" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">{labels.price}</label>
            <input name="priceUsd" type="number" step="0.01" min="0" defaultValue={plan?.priceUsd ?? 0} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">{labels.groups}</label>
          <input name="modelGroups" defaultValue={plan?.modelGroups.join(", ")} className={inputCls} placeholder="claude, codex, gemini" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium">{labels.hour}</label>
            <input name="hourUsd" type="number" step="0.01" min="0" defaultValue={plan?.buckets.hourUsd ?? 0} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">{labels.day}</label>
            <input name="dayUsd" type="number" step="0.01" min="0" defaultValue={plan?.buckets.dayUsd ?? 0} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">{labels.month}</label>
            <input name="monthUsd" type="number" step="0.01" min="0" defaultValue={plan?.buckets.monthUsd ?? 0} className={inputCls} />
          </div>
        </div>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" name="overageEnabled" defaultChecked={plan?.overageEnabled} className="h-4 w-4 rounded border-input accent-primary" />
          {labels.overage}
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {state?.ok ? `${labels.saved} (${state.msg})` : plan ? labels.save : labels.create}
          </Button>
          {state?.ok === false && <span className="text-sm text-destructive">{state.error}</span>}
        </div>
      </form>
      {plan && (
        <form action={del} className="mt-3 border-t border-border pt-3">
          <input type="hidden" name="id" value={plan.id} />
          <Button type="submit" size="sm" variant="ghost" disabled={deleting} className="text-destructive hover:bg-destructive/10">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {labels.del}
          </Button>
          {delState?.ok === false && <span className="ml-2 text-sm text-destructive">{delState.error}</span>}
        </form>
      )}
    </div>
  );
}

/** Manage the canonical base-model list (precondition for listings). */
export function CanonicalManager({
  models,
  labels,
}: {
  models: string[];
  labels: { add: string; placeholder: string; remove: string };
}) {
  const [, add, adding] = useActionState<AdminState, FormData>(addCanonicalAction, null);
  const [, remove] = useActionState<AdminState, FormData>(removeCanonicalAction, null);
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <form action={add} className="mb-4 flex items-center gap-2">
        <input
          name="model"
          placeholder={labels.placeholder}
          className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
        />
        <Button type="submit" size="sm" disabled={adding}>
          {adding && <Loader2 className="h-4 w-4 animate-spin" />}
          {labels.add}
        </Button>
      </form>
      <ul className="flex flex-wrap gap-2">
        {models.map((m) => (
          <li key={m} className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 py-1 pl-3 pr-1.5 text-sm">
            <span className="font-mono">{m}</span>
            <form action={remove}>
              <input type="hidden" name="model" value={m} />
              <button type="submit" aria-label={labels.remove} className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

type RoleLabels = {
  hint: string;
  email: string;
  role: string;
  add: string;
  addHint: string;
  save: string;
  saved: string;
  roleOwner: string;
  roleAdmin: string;
  roleModerator: string;
  roleUser: string;
  self: string;
  locked: string;
  empty: string;
};

type StaffMember = { email: string; name: string; role: string; verified: boolean };

/** Owner-only: list current staff + assign roles, plus add a user by email. */
export function RoleManager({
  staff,
  currentEmail,
  labels,
}: {
  staff: StaffMember[];
  currentEmail: string;
  labels: RoleLabels;
}) {
  const roleLabel = (r: string) =>
    r === "owner" ? labels.roleOwner : r === "admin" ? labels.roleAdmin : r === "moderator" ? labels.roleModerator : labels.roleUser;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{labels.hint}</p>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {staff.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{labels.empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {staff.map((m) => (
              <RoleRow
                key={m.email}
                member={m}
                isSelf={m.email.toLowerCase() === currentEmail.toLowerCase()}
                roleLabel={roleLabel}
                labels={labels}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Add / set role by email */}
      <AddRoleForm labels={labels} />
    </div>
  );
}

function RoleRow({
  member,
  isSelf,
  roleLabel,
  labels,
}: {
  member: StaffMember;
  isSelf: boolean;
  roleLabel: (r: string) => string;
  labels: RoleLabels;
}) {
  const [state, action, pending] = useActionState<RoleActionState, FormData>(setRoleAction, null);
  // A bootstrap owner (env) can't be edited; the server rejects it, but we also
  // lock the control to make that obvious. Heuristic: current "owner" rows are
  // left editable except self; the server is the real guard.
  const locked = isSelf;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{member.name || member.email}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">{member.email}</p>
      </div>
      {locked ? (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
          {roleLabel(member.role)} · {labels.self}
        </span>
      ) : (
        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="email" value={member.email} />
          <select
            name="role"
            defaultValue={member.role}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"
          >
            <option value="owner">{labels.roleOwner}</option>
            <option value="admin">{labels.roleAdmin}</option>
            <option value="moderator">{labels.roleModerator}</option>
            <option value="user">{labels.roleUser}</option>
          </select>
          <Button type="submit" size="sm" variant="ghost" disabled={pending}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {state?.ok ? labels.saved : labels.save}
          </Button>
          {state?.ok === false && <span className="text-xs text-destructive">{state.error}</span>}
        </form>
      )}
    </li>
  );
}

function AddRoleForm({ labels }: { labels: RoleLabels }) {
  const [state, action, pending] = useActionState<RoleActionState, FormData>(setRoleAction, null);
  return (
    <form action={action} className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <UserCog className="h-4 w-4" />
        {labels.add}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{labels.addHint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder={labels.email}
          className="h-9 min-w-[14rem] flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
        />
        <select
          name="role"
          defaultValue="moderator"
          className="h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-primary"
        >
          <option value="admin">{labels.roleAdmin}</option>
          <option value="moderator">{labels.roleModerator}</option>
          <option value="owner">{labels.roleOwner}</option>
          <option value="user">{labels.roleUser}</option>
        </select>
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {state?.ok ? labels.saved : labels.save}
        </Button>
      </div>
      {state?.ok === false && <p className="mt-2 text-xs text-destructive">{state.error}</p>}
      {state?.ok && <p className="mt-2 text-xs text-success">{labels.saved}</p>}
    </form>
  );
}

