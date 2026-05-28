/**
 * FaqPanel — Phase 27 — collapsible FAQ for common admin questions.
 */

import { HelpCircle } from "lucide-react";

const FAQ = [
  {
    q: "How do I create an API key?",
    a: "Go to API Keys section in the sidebar, click '+ Create key'. Set owner, optional team, rate limits, expiry, model whitelist, IP allowlist, and group. Click Create — the raw key is shown ONCE; copy it before closing.",
  },
  {
    q: "How does Topup work?",
    a: "Each API key has a balance (USD credits). When balance reaches 0 and the key is balance-tracked (not unlimited), requests return 402 balance_exhausted. Click '+' next to the key's balance badge to top up. Cost is deducted using ModelPricing service.",
  },
  {
    q: "What's the difference between groupName on a key and on a channel?",
    a: "Both. Channel groupName is a tag like 'premium' or 'free'. Key groupName routes to channels with matching groupName first. With crossGroupRetry=true, the key falls back to all channels if no in-group match.",
  },
  {
    q: "How do I limit which models a key can use?",
    a: "Edit the key → Restrictions tab → allowedModels multi-select. Empty = all models allowed. Team-level allowedModels also apply (intersection enforced).",
  },
  {
    q: "What does 'Auto-ban' do for a channel?",
    a: "Circuit breaker: after N consecutive failures (default 5), the channel is temporarily disabled for cooldown ms (default 60000). Half-open mode allows 1 retry per cycle to detect recovery.",
  },
  {
    q: "How do I copy/duplicate a channel?",
    a: "Open the provider detail page → click 'Copy' button in header. The copy starts disabled — configure credentials and enable when ready.",
  },
  {
    q: "What's the public /pricing.html for?",
    a: "A public page (no admin auth) showing the gateway's model pricing. Share with team or end-users so they can lookup costs before requesting an API key.",
  },
  {
    q: "How do I batch operations?",
    a: "Providers page: toggle 'Batch' button → select providers → bulk Enable/Disable/Delete. API Keys section: 'Batch mode' checkbox → select rows → bulk delete/disable.",
  },
  {
    q: "What's paramOverride / headerOverride for?",
    a: "Per-channel injection. paramOverride shallow-merges into request body (e.g. force max_tokens=4096). headerOverride injects custom headers (e.g. azure-api-version). Reserved headers (Authorization, Content-Type, Host) cannot be overridden.",
  },
  {
    q: "Where do I see usage trends over time?",
    a: "Usage page → scroll past the model leaderboard. The 'Usage trends' panel shows time-bucketed charts (Trend / Proportion / Top) with a metric switcher (cost / tokens / requests). Backed by GET /admin/v1/usage/aggregate.",
  },
];

export function FaqPanel() {
  return (
    <article className="ovCard">
      <header className="ovCardHeader">
        <HelpCircle size={16} />
        <h3>FAQ</h3>
      </header>
      <div style={{ padding: "8px 12px" }}>
        {FAQ.map((item, i) => (
          <details
            key={i}
            style={{
              padding: "8px 4px",
              borderBottom: i < FAQ.length - 1 ? "1px solid var(--color-border)" : undefined,
            }}
          >
            <summary
              style={{
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                listStyle: "none",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ color: "var(--color-text-muted)" }}>›</span>
              {item.q}
            </summary>
            <p style={{ marginTop: 8, marginLeft: 20, fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </article>
  );
}
