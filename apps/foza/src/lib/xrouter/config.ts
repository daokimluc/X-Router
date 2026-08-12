import "server-only";

/** X-Router integration config, read from environment (server-only). */
export const xrouterConfig = {
  url: process.env.XROUTER_URL ?? "http://localhost:8080",
  /** Provision key — the dedicated /provision/* auth dimension (reads + writes). */
  provisionKey: process.env.XROUTER_PROVISION_KEY ?? "",
  /** Admin key — the /admin/v1/* dimension (plan CRUD, canonical, seller terms…).
   *  God-mode; server-only, gated behind FOZA_ADMIN_EMAILS at the action layer. */
  adminKey: process.env.XROUTER_ADMIN_KEY ?? "",
  /** Internal key — for end-user LLM calls (/v1/*) and public reads. */
  internalKey: process.env.XROUTER_INTERNAL_KEY ?? "",
  /** Shared secret X-Router signs business webhooks with (HMAC-SHA256). */
  webhookSecret: process.env.XROUTER_WEBHOOK_SECRET ?? "",
  /**
   * Master switch. The doc calls it MARKETPLACE_ENABLED; XROUTER_ENABLED is kept
   * as an alias. While X-Router is being built, keep this false.
   */
  enabled:
    process.env.MARKETPLACE_ENABLED === "true" ||
    process.env.XROUTER_ENABLED === "true",
  /** Per-request timeout for gateway calls (ms). */
  timeoutMs: 5000,
} as const;

/**
 * Payment config for the SePay bank-transfer gateway (server-only). SePay reads
 * balance changes on the linked bank account and POSTs a webhook when money
 * arrives; we match the transfer by its memo (= the pending top-up id, with a
 * short prefix) and credit the wallet. Auth is a shared API key SePay sends as
 * `Authorization: Apikey <key>`.
 */
export const paymentConfig = {
  /** Shared key SePay sends in the webhook Authorization header. */
  sepayApiKey: process.env.SEPAY_API_KEY ?? "",
  /** Receiving bank account number (display + sanity-check vs webhook). */
  bankAccount: process.env.SEPAY_BANK_ACCOUNT ?? "",
  /** Bank short name for the QR (e.g. "MBBank", "Vietcombank"). */
  bankName: process.env.SEPAY_BANK_NAME ?? "",
  /** Account holder name (display). */
  bankAccountName: process.env.SEPAY_BANK_ACCOUNT_NAME ?? "",
  /** Memo prefix prepended to the top-up id (must match SePay's configured code prefix). */
  memoPrefix: process.env.PAYMENT_MEMO_PREFIX ?? "VEXA",
  /** USD→VND rate used to compute the transfer amount shown to the buyer. */
  usdToVndRate: Number(process.env.USD_TO_VND_RATE ?? 26324),
} as const;
