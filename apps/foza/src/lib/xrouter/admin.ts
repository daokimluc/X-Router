import "server-only";
import { currentRole, can, type Permission } from "@/lib/roles";

/**
 * Admin gate for the ops console, now backed by the role system (see
 * `@/lib/roles`). `isAdmin()` is kept for callers that only need the coarse
 * "can reach admin ops" check (role >= admin). For finer control, use
 * `hasPermission()` / `canModerate()`.
 *
 * Fail-closed in production is enforced inside `roleOf()` (an unset
 * FOZA_ADMIN_EMAILS in prod yields no owner).
 */

/** True if the current user is admin or owner (coarse ops gate). */
export async function isAdmin(): Promise<boolean> {
  const cur = await currentRole();
  return cur ? cur.role === "admin" || cur.role === "owner" : false;
}

/** True if the current user can reach the admin page at all (moderator+). */
export async function canModerate(): Promise<boolean> {
  const cur = await currentRole();
  return cur ? cur.role !== "user" : false;
}

/** True if the current user holds a specific permission. */
export async function hasPermission(perm: Permission): Promise<boolean> {
  const cur = await currentRole();
  return cur ? can(cur.role, perm) : false;
}
