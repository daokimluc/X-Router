import "server-only";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { db } from "@/lib/db";

/**
 * One-time migration of the former file-backed user store
 * (`.data/users.json`) into the SQLite `users` table. Runs at most once per
 * process (guarded), and only imports if the table is empty. The JSON file is
 * left in place as a backup — not deleted.
 */

const USERS_JSON = path.join(process.cwd(), ".data", "users.json");

const g = globalThis as unknown as { __fozaUsersMigrated?: boolean };

type LegacyUser = {
  name?: string;
  email?: string;
  passwordHash?: string;
  createdAt?: string;
  verified?: boolean;
  verifyToken?: string | null;
  verifyTokenExpires?: number | null;
};

export function migrateUsersFromJson(): void {
  if (g.__fozaUsersMigrated) return;
  g.__fozaUsersMigrated = true;

  const conn = db();
  const count = conn.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (count.c > 0) return; // already has users — nothing to import
  if (!existsSync(USERS_JSON)) return;

  let legacy: LegacyUser[];
  try {
    const parsed = JSON.parse(readFileSync(USERS_JSON, "utf8"));
    legacy = Array.isArray(parsed) ? parsed : [];
  } catch {
    return; // unreadable/corrupt — skip, leave file as-is
  }

  const insert = conn.prepare(
    `INSERT OR IGNORE INTO users
       (email, name, passwordHash, verified, verifyToken, verifyTokenExpires, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const u of legacy) {
    if (!u.email || !u.passwordHash) continue;
    insert.run(
      u.email.trim().toLowerCase(),
      (u.name ?? u.email).trim(),
      u.passwordHash,
      u.verified ? 1 : 0,
      u.verifyToken ?? null,
      u.verifyTokenExpires ?? null,
      u.createdAt ?? new Date().toISOString(),
    );
  }
}
