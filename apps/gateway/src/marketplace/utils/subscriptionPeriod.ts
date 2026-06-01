/**
 * Subscription period math — marketplace-plan-subscription.
 *
 * Pure, wall-clock-independent helper so the renewal date logic is unit-testable
 * in isolation. A subscription period advances exactly one calendar month,
 * preserving the day-of-month and clamping to the last day of a shorter target
 * month (Stripe-style): Jan 31 → Feb 28 (or 29 in a leap year), not March 2/3.
 *
 * Periods are carried as epoch-millisecond numbers on the key record so they
 * round-trip through JSON + the SQLite config store with no date revival.
 */

/**
 * Return the epoch-ms one calendar month after `fromMs`, same day-of-month,
 * clamped to the target month's last day, and preserving the time-of-day.
 */
export function addOneCalendarMonth(fromMs: number): number {
  const d = new Date(fromMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-11
  const day = d.getUTCDate();
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const seconds = d.getUTCSeconds();
  const ms = d.getUTCMilliseconds();

  // Target month (handles December → January rollover via the +1 below).
  const targetYear = month === 11 ? year + 1 : year;
  const targetMonth = month === 11 ? 0 : month + 1;

  // Clamp the day to the target month's length (UTC day 0 of month+1 = last day).
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInTargetMonth);

  return Date.UTC(targetYear, targetMonth, targetDay, hours, minutes, seconds, ms);
}
