import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { migrateUsersFromJson } from "@/lib/db/migrate";

/**
 * User store for email/password auth, backed by SQLite (see `@/lib/db`). Foza
 * owns user identity (the integration contract: X-Router has no user accounts).
 * Passwords are bcrypt-hashed; records are durable and survive restarts.
 *
 * Public API is unchanged from the former file-backed version so callers
 * (auth.ts, the register action, the verify flow) need no changes.
 *
 * Email verification: new users start unverified and cannot sign in until they
 * click the link sent to their email. Only Gmail addresses are accepted.
 */

export type UserRecord = {
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  verified: boolean;
  verifyToken: string | null;
  verifyTokenExpires: number | null; // epoch ms
};

export type PublicUser = { name: string; email: string };

const SALT_ROUNDS = 10;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Max password length fed to bcrypt — guards against long-string CPU DoS. */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * A fixed bcrypt hash compared against when no user row exists, so an unknown
 * email costs the same wall-clock time as a wrong password for a known email
 * (defeats user-enumeration via timing). The plaintext behind it is unknown and
 * never matches a real password.
 */
const DUMMY_HASH = "$2b$10$jYNm5plydSpEHGk0sbCQtejnBBnVfDRf0zSkmzmCNIwcnGfjGBS.a";

/** Normalize an email for use as the unique key. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Only Gmail addresses are accepted. */
export function isGmail(email: string): boolean {
  return /^[^\s@]+@gmail\.com$/.test(normalizeEmail(email));
}

function newToken(): { token: string; expires: number } {
  return { token: randomBytes(32).toString("hex"), expires: Date.now() + TOKEN_TTL_MS };
}

type Row = {
  email: string;
  name: string;
  passwordHash: string;
  verified: number;
  verifyToken: string | null;
  verifyTokenExpires: number | null;
  createdAt: string;
};

function toRecord(r: Row): UserRecord {
  return {
    email: r.email,
    name: r.name,
    passwordHash: r.passwordHash,
    verified: r.verified === 1,
    verifyToken: r.verifyToken,
    verifyTokenExpires: r.verifyTokenExpires,
    createdAt: r.createdAt,
  };
}

function rawGet(email: string): Row | undefined {
  migrateUsersFromJson(); // one-time import on first access
  return db()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(normalizeEmail(email)) as Row | undefined;
}

/** Look up a user by email, or null. */
export async function getUser(email: string): Promise<UserRecord | null> {
  const r = rawGet(email);
  return r ? toRecord(r) : null;
}

// CHUNK2

export type CreateUserResult =
  | { ok: true; email: string; name: string; token: string }
  | { ok: false; reason: "duplicate" };

/**
 * Create an UNVERIFIED user with a hashed password and a fresh verify token.
 * Fails if the email already exists. Returns the token so the caller can send
 * the verification email.
 */
export async function createUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<CreateUserResult> {
  const email = normalizeEmail(input.email);
  if (rawGet(email)) return { ok: false, reason: "duplicate" };
  const passwordHash = await bcrypt.hash(
    input.password.slice(0, MAX_PASSWORD_LENGTH),
    SALT_ROUNDS,
  );
  const { token, expires } = newToken();
  const name = input.name.trim();
  const createdAt = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO users (email, name, passwordHash, verified, verifyToken, verifyTokenExpires, createdAt)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(email, name, passwordHash, token, expires, createdAt);
  return { ok: true, email, name, token };
}

export type CredentialCheck =
  | { ok: true; user: PublicUser }
  | { ok: false; reason: "invalid" | "unverified" };

/**
 * Verify email + password for sign-in. Distinguishes a bad credential from an
 * unverified account so the UI can prompt the user to verify.
 */
export async function checkCredentials(
  email: string,
  password: string,
): Promise<CredentialCheck> {
  const r = rawGet(email);
  // Always run one bcrypt comparison so a missing user and a wrong password
  // take the same time (no timing oracle for enumeration). Cap the input length
  // first so an attacker can't drive CPU with a megabyte-long "password".
  const candidate = password.slice(0, MAX_PASSWORD_LENGTH);
  const valid = await bcrypt.compare(candidate, r?.passwordHash ?? DUMMY_HASH);
  if (!r || !valid) return { ok: false, reason: "invalid" };
  if (r.verified !== 1) return { ok: false, reason: "unverified" };
  return { ok: true, user: { name: r.name, email: r.email } };
}

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "expired" | "already" };

/** Consume a verification token: mark the user verified and clear the token. */
export async function verifyEmailToken(token: string): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: "invalid" };
  migrateUsersFromJson();
  const r = db()
    .prepare("SELECT * FROM users WHERE verifyToken = ?")
    .get(token) as Row | undefined;
  if (!r) return { ok: false, reason: "invalid" };
  if (r.verified === 1) return { ok: false, reason: "already" };
  if (!r.verifyTokenExpires || r.verifyTokenExpires < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  db()
    .prepare(
      "UPDATE users SET verified = 1, verifyToken = NULL, verifyTokenExpires = NULL WHERE email = ?",
    )
    .run(r.email);
  return { ok: true, email: r.email };
}

export type ResendResult =
  | { ok: true; email: string; name: string; token: string }
  | { ok: false; reason: "not-found" | "already" };

/** Issue a fresh verify token for an unverified user (for "resend email"). */
export async function setVerifyToken(email: string): Promise<ResendResult> {
  const r = rawGet(email);
  if (!r) return { ok: false, reason: "not-found" };
  if (r.verified === 1) return { ok: false, reason: "already" };
  const { token, expires } = newToken();
  db()
    .prepare("UPDATE users SET verifyToken = ?, verifyTokenExpires = ? WHERE email = ?")
    .run(token, expires, r.email);
  return { ok: true, email: r.email, name: r.name, token };
}

export type StaffRow = {
  email: string;
  name: string;
  role: string;
  verified: boolean;
};

/** Set a user's stored role. Returns false if the email doesn't exist. */
export async function setUserRole(email: string, role: string): Promise<boolean> {
  const e = normalizeEmail(email);
  const res = db().prepare("UPDATE users SET role = ? WHERE email = ?").run(role, e);
  return Number(res.changes) > 0;
}

/** List users with an elevated stored role (owner/admin/moderator). */
export async function listStaff(): Promise<StaffRow[]> {
  const rows = db()
    .prepare(
      "SELECT email, name, role, verified FROM users WHERE role IN ('owner','admin','moderator') ORDER BY role, email",
    )
    .all() as Array<{ email: string; name: string; role: string; verified: number }>;
  return rows.map((r) => ({ email: r.email, name: r.name, role: r.role, verified: r.verified === 1 }));
}

/** Look up a single user for role display (email/name/role), or null. */
export async function getUserForRole(email: string): Promise<StaffRow | null> {
  const r = rawGet(email) as (Row & { role?: string }) | undefined;
  if (!r) return null;
  return { email: r.email, name: r.name, role: r.role ?? "user", verified: r.verified === 1 };
}

/**
 * Ensure a row exists for a federated (e.g. Google) sign-in so roles can be
 * attached. Google accounts never call createUser, so without this they'd be
 * absent from the users table. Idempotent: inserts on first sign-in (verified,
 * no password — auth is delegated to the provider), and only refreshes the
 * display name on later sign-ins — NEVER touches an existing role.
 */
export async function upsertOAuthUser(input: {
  email: string;
  name?: string | null;
}): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!email) return;
  const name = (input.name ?? email).trim() || email;
  db()
    .prepare(
      `INSERT INTO users (email, name, passwordHash, verified, verifyToken, verifyTokenExpires, createdAt, role)
       VALUES (?, ?, '', 1, NULL, NULL, ?, 'user')
       ON CONFLICT(email) DO UPDATE SET name = excluded.name, verified = 1`,
    )
    .run(email, name, new Date().toISOString());
}

