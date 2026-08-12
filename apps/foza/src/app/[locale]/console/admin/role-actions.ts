"use server";

import {
  currentRole,
  canAssignRole,
  isBootstrapOwner,
  type Role,
} from "@/lib/roles";
import { setUserRole, getUserForRole } from "@/lib/users";

export type RoleActionState = { ok: boolean; error?: string; msg?: string } | null;

const VALID: Role[] = ["owner", "admin", "moderator", "user"];

/**
 * Assign a role to a user. Owner-only (manageRoles). Guardrails:
 *  - target email must exist (a verified/registered user)
 *  - cannot change your OWN role (no self-lockout / no self-promotion games)
 *  - cannot demote a break-glass owner from FOZA_ADMIN_EMAILS (env wins anyway)
 */
export async function setRoleAction(
  _prev: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  const actor = await currentRole();
  if (!actor) return { ok: false, error: "Not signed in" };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "").trim() as Role;

  if (!email || !VALID.includes(role)) {
    return { ok: false, error: "Invalid email or role" };
  }
  if (!canAssignRole(actor.role, role)) {
    return { ok: false, error: "Forbidden" };
  }
  if (email === actor.email.toLowerCase()) {
    return { ok: false, error: "You cannot change your own role" };
  }
  if (isBootstrapOwner(email)) {
    return { ok: false, error: "This account is a bootstrap owner (set via env) and cannot be changed here" };
  }

  const target = await getUserForRole(email);
  if (!target) {
    return { ok: false, error: "No registered user with that email" };
  }

  const ok = await setUserRole(email, role);
  if (!ok) return { ok: false, error: "Failed to update role" };
  return { ok: true, msg: role };
}
