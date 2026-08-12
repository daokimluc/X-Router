"use client";

import { useActionState } from "react";
import { CheckCircle2, Clock, CalendarDays, CalendarRange, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  toggleOverageAction,
  cancelPlanAction,
  type PlanMutState,
} from "./actions";

export type ActivePlan = {
  name: string;
  overageEnabled: boolean;
  expiresLabel: string;
  quota: {
    hour: { used: number; cap: number };
    day: { used: number; cap: number };
    month: { used: number; cap: number };
  };
};

export function ActivePlanPanel({
  plan,
  labels,
}: {
  plan: ActivePlan;
  labels: Record<string, string>;
}) {
  const [, toggle, toggling] = useActionState<PlanMutState, FormData>(
    toggleOverageAction,
    null,
  );
  const [, cancel, cancelling] = useActionState<PlanMutState, FormData>(
    async () => cancelPlanAction(),
    null,
  );

  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-5">
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-lg font-semibold">{plan.name}</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
              <CheckCircle2 className="h-3 w-3" />
              {labels.active}
            </span>
            {plan.overageEnabled && (
              <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                {labels.overageOn}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{plan.expiresLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <form action={toggle}>
            <input type="hidden" name="enable" value={String(!plan.overageEnabled)} />
            <Button type="submit" size="sm" variant="ghost" disabled={toggling}>
              {toggling && <Loader2 className="h-4 w-4 animate-spin" />}
              {labels.allowOverage}
            </Button>
          </form>
          <form action={cancel}>
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              disabled={cancelling}
              className="text-destructive hover:bg-destructive/10"
            >
              {cancelling && <Loader2 className="h-4 w-4 animate-spin" />}
              {labels.cancel}
            </Button>
          </form>
        </div>
      </div>

      <p className="mb-3 text-sm font-medium text-foreground">{labels.usageThisPeriod}</p>
      <div className="space-y-4">
        <QuotaBar icon={Clock} label={labels.hourly} q={plan.quota.hour} />
        <QuotaBar icon={CalendarDays} label={labels.daily} q={plan.quota.day} />
        <QuotaBar icon={CalendarRange} label={labels.monthly} q={plan.quota.month} />
      </div>
    </div>
  );
}

function QuotaBar({
  icon: Icon,
  label,
  q,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  q: { used: number; cap: number };
}) {
  const pct = q.cap > 0 ? Math.min(100, (q.used / q.cap) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {q.used} / {q.cap}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
