export type Model = {
  name: string;
  provider: string;
  avatar?: string;
  input: string;
  output: string;
  tag: string;
};

export const MODELS: Model[] = [
  { name: "GPT-5.5", provider: "OpenAI", input: "$0.25", output: "$1.50", tag: "Flagship" },
  { name: "GPT-5.4", provider: "OpenAI", input: "$0.125", output: "$0.75", tag: "Latest" },
  { name: "GPT-5.4 mini", provider: "OpenAI", input: "$0.0375", output: "$0.225", tag: "Value" },
  { name: "GPT-5.3 Codex", provider: "OpenAI Codex", input: "$0.0875", output: "$0.70", tag: "Coding" },
  { name: "Claude Opus 4.7", provider: "Anthropic", input: "$0.25", output: "$1.25", tag: "Frontier" },
  { name: "Claude Sonnet 4.6", provider: "Anthropic", input: "$0.15", output: "$0.75", tag: "Agentic" },
  { name: "Claude Haiku 4.5", provider: "Anthropic", input: "$0.05", output: "$0.25", tag: "Fast" },
  { name: "Gemini 3.1 Pro Preview", provider: "Google", input: "$0.10", output: "$0.60", tag: "Multimodal" },
  { name: "Gemini 3 Flash Preview", provider: "Google", input: "$0.025", output: "$0.15", tag: "Fast" },
  { name: "Gemini 3.1 Flash-Lite", provider: "Google", input: "$0.0125", output: "$0.075", tag: "Cheap" },
  { name: "DeepSeek V4 Flash", provider: "DeepSeek", avatar: "DE", input: "$0.007", output: "$0.014", tag: "Best value" },
  { name: "Mistral Large 3", provider: "Mistral", avatar: "MI", input: "$0.025", output: "$0.075", tag: "Open" },
];

export type Integration = {
  name: string;
  avatar: string;
  badge: string;
  descKey: string;
};

export const TOOLS = [
  { name: "OpenCode", avatar: "OC", type: "cli" },
  { name: "Cursor", avatar: "CU", type: "AI editor" },
  { name: "Claude Code", avatar: "CC", type: "CLI" },
  { name: "Codex CLI", avatar: "CX", type: "terminal" },
  { name: "OpenClaw", avatar: "OC", type: "agent" },
  { name: "Harness Agent", avatar: "HA", type: "workflow" },
];

// Marketplace listings (seller supply). Model names come live from X-Router;
// per-listing metrics are placeholder until X-Router exposes a listings endpoint.
export type Listing = {
  model: string;
  seller: string;
  verified: boolean;
  namespaced: string;
  category: string; // text / vision / etc.
  family: string; // Qwen / GPT / Claude / Gemini
  inputPerM: string;
  outputPerM: string;
  minCost: string;
  requests: string;
  successPct: number;
  tokens: string;
  context: string;
  latency: string;
  rps: string;
};

export const LISTINGS: Listing[] = [
  { model: "qwen3-coder-next", seller: "Hoang", verified: true, namespaced: "hoang/qwen3-coder-next", category: "text", family: "Qwen", inputPerM: "$0.06", outputPerM: "$0.18", minCost: "$0.0008", requests: "4.4K", successPct: 59, tokens: "11.98M", context: "—", latency: "4.6s", rps: "2" },
  { model: "gpt-5.5", seller: "Hoang", verified: true, namespaced: "hoang/gpt-5.5", category: "text", family: "GPT", inputPerM: "$0.30", outputPerM: "$0.90", minCost: "$0.00038", requests: "3.9K", successPct: 98, tokens: "8.42M", context: "400K", latency: "2.1s", rps: "3" },
  { model: "claude-sonnet-4.6", seller: "Cinb", verified: true, namespaced: "cinb/claude-sonnet-4.6", category: "text", family: "Claude", inputPerM: "$0.15", outputPerM: "$0.75", minCost: "$0.00045", requests: "2.7K", successPct: 96, tokens: "6.1M", context: "200K", latency: "1.8s", rps: "2" },
  { model: "gemini-3.1-pro", seller: "House", verified: true, namespaced: "house/gemini-3.1-pro", category: "vision", family: "Gemini", inputPerM: "$0.10", outputPerM: "$0.60", minCost: "$0.0003", requests: "5.2K", successPct: 99, tokens: "14.3M", context: "1M", latency: "1.4s", rps: "5" },
  { model: "deepseek-3.2", seller: "Hoang", verified: true, namespaced: "hoang/deepseek-3.2", category: "text", family: "DeepSeek", inputPerM: "$0.007", outputPerM: "$0.014", minCost: "$0.00002", requests: "1.1K", successPct: 94, tokens: "3.4M", context: "128K", latency: "3.2s", rps: "1" },
  { model: "mistral-large-3", seller: "Cinb", verified: false, namespaced: "cinb/mistral-large-3", category: "text", family: "Mistral", inputPerM: "$0.025", outputPerM: "$0.075", minCost: "$0.0001", requests: "820", successPct: 91, tokens: "2.1M", context: "128K", latency: "2.6s", rps: "1" },
];

// Subscription plans (seeded presets, mirror X-Router marketplace-plans).
export type Plan = {
  id: string;
  name: string;
  desc: string;
  priceUsd: string;
  hourUsd: string;
  dayUsd: string;
  monthUsd: string;
  models: string[];
  totalModels: number;
  featured?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "free", name: "Free", desc: "Bắt đầu miễn phí với các mô hình giá rẻ được tuyển chọn.",
    priceUsd: "$0.00", hourUsd: "0.05 USD", dayUsd: "0.24 USD", monthUsd: "5 USD",
    models: ["qwen3-coder-next", "gpt-5.5", "minimax-m2.5-free", "gpt-5.2", "glm-5"], totalModels: 7,
  },
  {
    id: "claude", name: "Claude", desc: "Trọn bộ mô hình Claude cho tác vụ agentic và coding.",
    priceUsd: "$10.00", hourUsd: "0.3 USD", dayUsd: "1.2 USD", monthUsd: "20 USD",
    models: ["claude-sonnet-4.6", "claude-haiku-4.5", "claude-opus-4.6", "claude-opus-4.7"], totalModels: 4,
    featured: true,
  },
  {
    id: "codex", name: "Codex", desc: "Các mô hình GPT/Codex tối ưu cho lập trình.",
    priceUsd: "$10.00", hourUsd: "0.3 USD", dayUsd: "1.2 USD", monthUsd: "20 USD",
    models: ["gpt-5.5", "gpt-5.4", "gpt-5.2", "gpt-5.3-codex"], totalModels: 4,
  },
  {
    id: "pro", name: "Pro", desc: "Mở khóa tất cả mô hình với hạn mức cao nhất.",
    priceUsd: "$20.00", hourUsd: "0.5 USD", dayUsd: "3 USD", monthUsd: "40 USD",
    models: ["qwen3-coder-next", "gpt-5.5", "claude-sonnet-4.6", "claude-haiku-4.5", "claude-opus-4.6", "gpt-5.4"], totalModels: 11,
  },
];


