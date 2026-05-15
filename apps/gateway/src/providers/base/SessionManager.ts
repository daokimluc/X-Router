import type { ProviderAccount } from "./ProviderAccount.js";
import type { ProviderContext, SessionRefreshResult } from "./types.js";

export type SessionManager = {
  refreshSession(
    account: ProviderAccount,
    context: ProviderContext
  ): Promise<SessionRefreshResult>;
};

