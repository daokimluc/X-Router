/**
 * SellerEarningsLedger — two-sided-settlement (#6).
 *
 * Per-seller accrued USD credit (cost minus commission), rolled up by day /
 * month / lifetime, plus an `unpaid` balance the website reduces when it settles
 * a payout. Distinct from the buyer-debit WalletService (#1): this is the
 * seller-credit side. The `house` seller is never credited — its "earnings" are
 * just platform cost, tracked as platform margin instead.
 *
 * Lazy day/month rollover, debounced persistence — same discipline as
 * SpendLedgerService / WalletService.
 */

const HOUSE_SELLER_ID = "house";

export type SellerEarnings = {
  dayKey: string;
  monthKey: string;
  day: number;
  month: number;
  lifetime: number;
  unpaid: number;
};

export type SellerEarningsSnapshot = {
  sellerId: string;
  day: number;
  month: number;
  lifetime: number;
  unpaid: number;
};

export type PersistedSellerEarnings = {
  entries: Record<string, SellerEarnings>;
  /** Running platform-margin total (USD) for the admin dashboard. */
  platformMargin?: number;
};

function dayKeyNow(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthKeyNow(): string {
  return new Date().toISOString().slice(0, 7);
}

function rollover(e: SellerEarnings): SellerEarnings {
  const d = dayKeyNow();
  const m = monthKeyNow();
  if (e.dayKey !== d) {
    e.day = 0;
    e.dayKey = d;
  }
  if (e.monthKey !== m) {
    e.month = 0;
    e.monthKey = m;
  }
  return e;
}

export class SellerEarningsLedger {
  private readonly entries = new Map<string, SellerEarnings>();
  private platformMargin = 0;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private onPersist?: () => void;

  setPersistCallback(cb: () => void): void {
    this.onPersist = cb;
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty && this.onPersist) {
        this.dirty = false;
        this.onPersist();
      }
    }, 5000);
  }

  private getOrInit(sellerId: string): SellerEarnings {
    let e = this.entries.get(sellerId);
    if (!e) {
      e = { dayKey: dayKeyNow(), monthKey: monthKeyNow(), day: 0, month: 0, lifetime: 0, unpaid: 0 };
      this.entries.set(sellerId, e);
    }
    return e;
  }

  /** Credit a seller. House is never credited (no-op). */
  credit(sellerId: string, usd: number): void {
    if (sellerId === HOUSE_SELLER_ID || usd <= 0) return;
    const e = this.getOrInit(sellerId);
    rollover(e);
    e.day += usd;
    e.month += usd;
    e.lifetime += usd;
    e.unpaid += usd;
    this.scheduleSave();
  }

  /** Record platform margin (the markup + commission retained). */
  recordPlatformMargin(usd: number): void {
    if (usd === 0) return;
    this.platformMargin += usd;
    this.scheduleSave();
  }

  getPlatformMargin(): number {
    return this.platformMargin;
  }

  /** The website calls this after settling a payout off-platform. Reduces unpaid only. */
  markPaid(sellerId: string, usd: number): SellerEarningsSnapshot {
    const e = this.getOrInit(sellerId);
    rollover(e);
    e.unpaid = Math.max(0, e.unpaid - usd);
    this.scheduleSave();
    return this.snapshot(sellerId);
  }

  snapshot(sellerId: string): SellerEarningsSnapshot {
    const e = this.entries.get(sellerId);
    if (!e) return { sellerId, day: 0, month: 0, lifetime: 0, unpaid: 0 };
    rollover(e);
    return { sellerId, day: e.day, month: e.month, lifetime: e.lifetime, unpaid: e.unpaid };
  }

  toPersisted(): PersistedSellerEarnings {
    const out: PersistedSellerEarnings = { entries: {}, platformMargin: this.platformMargin };
    for (const [k, v] of this.entries) out.entries[k] = { ...v };
    return out;
  }

  load(state: PersistedSellerEarnings | undefined | null): void {
    this.entries.clear();
    this.platformMargin = 0;
    if (!state) return;
    if (typeof state.platformMargin === "number") this.platformMargin = state.platformMargin;
    if (state.entries) {
      for (const [k, v] of Object.entries(state.entries)) this.entries.set(k, { ...v });
    }
  }

  clear(): void {
    this.entries.clear();
    this.platformMargin = 0;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }
}
