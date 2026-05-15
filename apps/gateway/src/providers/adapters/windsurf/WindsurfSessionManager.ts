import type { ProviderAccount } from "../../base/ProviderAccount.js";
import type { SessionManager } from "../../base/SessionManager.js";
import type { ProviderContext, SessionRefreshResult } from "../../base/types.js";

export class WindsurfSessionManager implements SessionManager {
  async refreshSession(
    _account: ProviderAccount,
    _context: ProviderContext
  ): Promise<SessionRefreshResult> {
    return {
      refreshed: false,
      message: "Windsurf token refresh is configured for a later phase"
    };
  }
}

