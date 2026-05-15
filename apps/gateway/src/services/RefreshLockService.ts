import type { ProviderAccount } from "../providers/base/ProviderAccount.js";
import type { ProviderContext, SessionRefreshResult } from "../providers/base/types.js";
import { KeyedMutex } from "../utils/mutex.js";

export class RefreshLockService {
  private readonly mutex = new KeyedMutex();

  async runForAccount(
    account: ProviderAccount,
    refresh: () => Promise<SessionRefreshResult>,
    _context?: ProviderContext
  ): Promise<SessionRefreshResult> {
    return this.mutex.runExclusive(account.id, refresh);
  }
}

