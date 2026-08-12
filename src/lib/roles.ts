import "server-only";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/xrouter/session";

/**
 * Role-based access control for the ops console.
 *
 * Four tiers (highest → lowest): owner > admin > moderator > user.
 *  - owner     — everything, including managing other people's roles
 *  - admin     — all ops (plans, catalog, money reverse, sellers) EXCEPT roles
 *  - moderator — seller queue only (approve/suspend/reject)
 *  - user      — no ops access
 *
 * Source of truth is the `users.role` column. On top of that, emails listed in
 * `FOZA_ADMIN_EMAILS` are ALWAYS treated as `owner` (break-glass bootstrap): it
 * solves "who makes the first admin" and is a recovery path if the DB roles get
 * locked out. These bootstrap owners cannot be demoted from the UI.
 *
 * Fail-closed in production: if FOZA_ADMIN_EMAILS is empty AND no DB owner
 * exists yet, nobody is owner (a signed-in user is at most their DB role).
 */

export type Role = "owner" | "admin" | "moderator" | "user";

const RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2, owner: 3 };

export type Permission =
  | "manageRoles" // owner only — change others' roles
  | "managePlans" // plans CRUD, markup
  | "manageCatalog" // canonical models, house listings, webhook
  | "moneyReverse" // mark seller paid / payout
  | "manageSellers"; // approve/suspend/reject seller queue

/** Minimum role required for each permission. */
const MIN_ROLE: Record<Permission, Role> = {
  manageRoles: "owner",
  managePlans: "admin",
  manageCatalog: "admin",
  moneyReverse: "admin",
  manageSellers: "moderator",
};

/** Emails that are always `owner` (break-glass), from FOZA_ADMIN_EMAILS. */
function bootstrapOwners(): string[] {
  return (process.env.FOZA_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** True if this email is a break-glass owner from env (cannot be demoted). */
export function isBootstrapOwner(email: string): boolean {
  return bootstrapOwners().includes(email.trim().toLowerCase());
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Read the stored DB role for an email (defaults to "user"). */
function dbRole(email: string): Role {
  const row = db()
    .prepare("SELECT role FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as { role?: string } | undefined;
  const r = row?.role;
  return r === "owner" || r === "admin" || r === "moderator" ? r : "user";
}

/** Effective role for an email: max(DB role, env bootstrap owner). */
export function roleOf(email: string): Role {
  const env = isBootstrapOwner(email) ? "owner" : "user";
  const stored = dbRole(email);
  // In non-prod, an empty FOZA_ADMIN_EMAILS still lets a local dev act as owner
  // so the console is reachable (mirrors the old isAdmin dev fail-open).
  const devFallback: Role =
    !isProd() && bootstrapOwners().length === 0 ? "owner" : "user";
  return highest(env, stored, devFallback);
}

function highest(...roles: Role[]): Role {
  return roles.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "user");
}

/** Resolve the current session's effective role, or "user" if signed out. */
export async function currentRole(): Promise<{ email: string; role: Role } | null> {
  const session = await getServerSession();
  if (!session) return null;
  return { email: session.email, role: roleOf(session.email) };
}

/** Whether a role satisfies a permission. */
export function can(role: Role, perm: Permission): boolean {
  return RANK[role] >= RANK[MIN_ROLE[perm]];
}

/** Whether `actor` may assign `target` role (owner-only, and never above self). */
export function canAssignRole(actorRole: Role, target: Role): boolean {
  return actorRole === "owner" && RANK[target] <= RANK.owner;
}
