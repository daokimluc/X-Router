export type ProxyType = "http" | "vercel";

export type ProxyTestStatus = "unknown" | "active" | "error";

export type ProxyPool = {
  id: string;
  name: string;
  proxyUrl: string;
  noProxy: string;
  isActive: boolean;
  strictProxy: boolean;
  type: ProxyType;
  testStatus: ProxyTestStatus;
  lastTestedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProxyPoolCreateInput = {
  name: string;
  proxyUrl: string;
  noProxy?: string;
  isActive?: boolean;
  strictProxy?: boolean;
  type?: ProxyType;
};

export type ProxyPoolUpdateInput = Partial<ProxyPoolCreateInput>;

export type ProxyPoolWithUsage = ProxyPool & {
  boundConnectionCount: number;
};

export type ProxyFetchOptions = {
  enabled: boolean;
  url?: string;
  noProxy?: string;
  strictProxy?: boolean;
  vercelRelayUrl?: string;
};

export type ProxyTestResult = {
  ok: boolean;
  status: number;
  statusText?: string;
  error?: string;
  elapsedMs: number;
  testedAt: string;
};
