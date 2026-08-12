export type DocLink = { slug: string; label: string };
export type DocGroup = { title: string; items: DocLink[] };

// Mirrors the foza.ai /docs sidebar structure
export const DOC_GROUPS: DocGroup[] = [
  {
    title: "Introduction",
    items: [
      { slug: "overview", label: "Overview" },
      { slug: "key-concepts", label: "Key Concepts" },
    ],
  },
  {
    title: "Getting Started",
    items: [
      { slug: "quick-start", label: "Quick Start" },
      { slug: "authentication", label: "Authentication" },
      { slug: "choose-a-model", label: "Choose a Model" },
    ],
  },
  {
    title: "API Reference",
    items: [
      { slug: "chat-completions", label: "Chat Completions" },
      { slug: "models", label: "Models" },
      { slug: "streaming", label: "Streaming" },
      { slug: "error-handling", label: "Error Handling" },
    ],
  },
  {
    title: "Integrations",
    items: [
      { slug: "claude-code", label: "Claude Code" },
      { slug: "codex-cli", label: "Codex CLI" },
      { slug: "opencode", label: "OpenCode" },
      { slug: "cursor", label: "Cursor" },
      { slug: "cline", label: "Cline" },
      { slug: "continue", label: "Continue" },
      { slug: "windsurf", label: "Windsurf" },
      { slug: "zed", label: "Zed" },
      { slug: "aider", label: "Aider" },
      { slug: "openclaw", label: "OpenClaw" },
      { slug: "mcp-servers", label: "MCP Servers" },
    ],
  },
  {
    title: "SDKs",
    items: [
      { slug: "python-sdk", label: "Python SDK" },
      { slug: "nodejs-sdk", label: "Node.js SDK" },
    ],
  },
  {
    title: "Help",
    items: [{ slug: "common-issues", label: "Common Issues" }],
  },
];

export const ALL_DOCS = DOC_GROUPS.flatMap((g) => g.items);
