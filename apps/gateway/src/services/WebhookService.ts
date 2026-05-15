/**
 * WebhookService — sends notifications to configured webhook URLs (Discord/Slack)
 * when important events occur (circuit breaker trip, account cooldown, etc.)
 */

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
  | "provider.error";

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

  getConfig(): WebhookConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<WebhookConfig>): WebhookConfig {
    this.config = { ...this.config, ...partial };
    return this.getConfig();
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
