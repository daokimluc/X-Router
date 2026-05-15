/**
 * In-memory store for OAuth PKCE sessions.
 * Tracks pending OAuth flows with auto-expiration.
 * @module services/OAuthSessionStore
 */

import type { AccountDraft } from "./addAccount/normalize.js";

export type OAuthSessionStatus = "pending" | "completed" | "failed" | "expired";

export type OAuthSessionResult =
  | { accountId: string }
  | { error: string; errorCode?: string };

export type OAuthSession = {
  id: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  providerType: string;
  normalizedLabel: string;
  accountDraft: AccountDraft;
  authorizationUrl: string;
  status: OAuthSessionStatus;
  result?: OAuthSessionResult;
  expiresAt: number;
  createdAt: number;
};

export type OAuthSessionCreateInput = Omit<OAuthSession, "status" | "createdAt">;

export class OAuthSessionStore {
  private readonly sessions = new Map<string, OAuthSession>();
  private readonly byState = new Map<string, string>(); // state → id

  /**
   * Create a new OAuth session.
   */
  create(input: OAuthSessionCreateInput): OAuthSession {
    const session: OAuthSession = {
      ...input,
      status: "pending",
      createdAt: Date.now(),
    };

    this.sessions.set(session.id, session);
    this.byState.set(session.state, session.id);

    return structuredClone(session);
  }

  /**
   * Get session by ID.
   * Returns undefined if not found.
   * Auto-expires if past expiresAt.
   */
  getById(id: string): OAuthSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    this.checkExpired(session);
    return structuredClone(this.sessions.get(id));
  }

  /**
   * Get session by OAuth state parameter.
   * Returns undefined if not found.
   * Auto-expires if past expiresAt.
   */
  getByState(state: string): OAuthSession | undefined {
    const id = this.byState.get(state);
    if (!id) return undefined;

    return this.getById(id);
  }

  /**
   * Check if there's an active (pending) session for the given provider and label.
   */
  hasActiveSession(providerType: string, normalizedLabel: string): boolean {
    for (const session of this.sessions.values()) {
      this.checkExpired(session);
      if (
        session.providerType === providerType &&
        session.normalizedLabel === normalizedLabel &&
        session.status === "pending"
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Mark session as completed with account ID.
   */
  complete(id: string, accountId: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    session.status = "completed";
    session.result = { accountId };
  }

  /**
   * Mark session as failed with error message.
   */
  fail(id: string, error: string, errorCode?: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    session.status = "failed";
    session.result = { error, errorCode };
  }

  /**
   * Delete a session by ID.
   */
  delete(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    this.byState.delete(session.state);
    return this.sessions.delete(id);
  }

  /**
   * Get current size (for testing/monitoring).
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Check and mark session as expired if past expiresAt.
   */
  private checkExpired(session: OAuthSession): void {
    if (session.status === "pending" && Date.now() > session.expiresAt) {
      session.status = "expired";
    }
  }
}
