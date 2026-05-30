/**
 * WebhookService — sends notifications to configured webhook URLs (Discord/Slack)
 * when important events occur (circuit breaker trip, account cooldown, etc.)
 *
 * provision-webhook (#7) adds a SECOND, separate channel for marketplace
 * BUSINESS events: machine-parseable JSON POSTed to a dedicated target and
 * HMAC-signed so the website can verify authenticity. Kept distinct from the
 * Discord/Slack ops channel above.
 */

import { createHmac } from "node:crypto";

export type WebhookConfig = {
  enabled: boolean;
  url: string;
  events: WebhookEvent[];
};

export type WebhookEvent =
  | "circuit_breaker.open"
  | "circuit_breaker.close"
  | "account.cooldown"
  | "account.disabled"
  | "rate_limit.exceeded"
  | "provider.error"
  // provision-webhook (#7) — marketplace business events
  | "usage.recorded"
  | "grant.exhausted"
  | "wallet.low"
  | "quota.blocked"
  | "supply.unhealthy";

/** Business webhook target — separate from the ops (Discord/Slack) config. */
export type BusinessWebhookConfig = {
  enabled: boolean;
  url: string;
  secret: string;
  events: WebhookEvent[];
};

export type WebhookPayload = {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
};

export class WebhookService {
  private config: WebhookConfig = {
    enabled: false,
    url: "",
    events: []
  };

  private businessConfig: BusinessWebhookConfig = {
    enabled: false,
    url: "",
    secret: "",
    events: []
  };

  getConfig(): WebhookConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<WebhookConfig>): WebhookConfig {
    this.config = { ...this.config, ...partial };
    return this.getConfig();
  }

  getBusinessConfig(): BusinessWebhookConfig {
    return { ...this.businessConfig };
  }

  updateBusinessConfig(partial: Partial<BusinessWebhookConfig>): BusinessWebhookConfig {
    this.businessConfig = { ...this.businessConfig, ...partial };
    return this.getBusinessConfig();
  }

  /**
   * Emit a marketplace business event: raw JSON envelope POSTed to the business
   * target with an HMAC-SHA256 signature over the exact body. Best-effort —
   * failures are swallowed and never block the originating request.
   */
  async notifyBusiness(event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
    const cfg = this.businessConfig;
    if (!cfg.enabled || !cfg.url) return;
    if (cfg.events.length > 0 && !cfg.events.includes(event)) return;

    const payload: WebhookPayload = { event, timestamp: new Date().toISOString(), data };
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", cfg.secret).update(body).digest("hex");

    try {
      await fetch(cfg.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Provision-Signature": `sha256=${signature}`
        },
        body,
        signal: AbortSignal.timeout(5000)
      });
    } catch {
      // Best-effort — never block the main flow.
    }
  }

  async notify(event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
    if (!this.config.enabled || !this.config.url) return;
    if (this.config.events.length > 0 && !this.config.events.includes(event)) return;

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data
    };

    try {
      // Detect Discord vs Slack format
      const isDiscord = this.config.url.includes("discord.com/api/webhooks");
      const body = isDiscord
        ? this.formatDiscord(payload)
        : this.formatSlack(payload);

      await fetch(this.config.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000)
      });
    } catch {
      // Silently ignore webhook failures — don't block main flow
    }
  }

  private formatDiscord(payload: WebhookPayload): Record<string, unknown> {
    const color = payload.event.includes("error") || payload.event.includes("open") || payload.event.includes("disabled")
      ? 0xef4444
      : payload.event.includes("cooldown") || payload.event.includes("exceeded")
        ? 0xf59e0b
        : 0x10b981;

    return {
      embeds: [{
        title: `⚡ ${payload.event.replace(/\./g, " ").replace(/_/g, " ")}`,
        description: Object.entries(payload.data)
          .map(([k, v]) => `**${k}**: ${String(v)}`)
          .join("\n"),
        color,
        timestamp: payload.timestamp,
        footer: { text: "AI Gateway" }
      }]
    };
  }

  private formatSlack(payload: WebhookPayload): Record<string, unknown> {
    const emoji = payload.event.includes("error") || payload.event.includes("open")
      ? "🔴"
      : payload.event.includes("cooldown") || payload.event.includes("exceeded")
        ? "🟡"
        : "🟢";

    return {
      text: `${emoji} *${payload.event}*`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${emoji} *${payload.event.replace(/\./g, " ").replace(/_/g, " ")}*\n${
              Object.entries(payload.data)
                .map(([k, v]) => `• *${k}*: ${String(v)}`)
                .join("\n")
            }`
          }
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `_${payload.timestamp}_` }]
        }
      ]
    };
  }
}
