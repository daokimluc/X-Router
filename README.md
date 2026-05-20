<p align="center">
  <img src="docs/images/banner.png" alt="AI Gateway" width="600" />
</p>

# AI Gateway — Internal AI Router & Token Saver

> Never stop coding. Route requests across FREE & paid AI providers with auto-fallback, multi-account pooling, and 60-90% token savings.

Connect **Claude Code, Cursor, Cline, Kiro, Windsurf, Codex, OpenClaw, Antigravity** and any OpenAI-compatible tool to multiple AI providers through a single endpoint.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[🚀 Quick Start](#-quick-start) • [💡 Features](#-key-features) • [📖 Setup](#-setup-guide) • [🎨 Media Providers](#-media-providers) • [🏗️ Architecture](#️-architecture)

[🇻🇳 Tiếng Việt](docs/README.vi.md)

---

## 🤔 Why AI Gateway?

Stop wasting money, tokens and hitting limits:

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls...) burn tokens fast
- ❌ Manual switching between providers when one goes down
- ❌ No visibility into which accounts are healthy

**AI Gateway solves this:**

- ✅ **Token Saver** — Compress tool_result content (RTK), save 60-90% input tokens per request
- ✅ **Caveman Mode** — Terse-style output prompt, save up to 65% output tokens
- ✅ **Multi-account pooling** — Round-robin between accounts per provider
- ✅ **Auto fallback** — Route chains with priority order, zero downtime
- ✅ **Full dashboard** — Real-time monitoring, account health, usage analytics
- ✅ **Media Providers** — Image generation, TTS, STT, Embedding, Web Search via unified API
- ✅ **Proxy Pools** — Route through SOCKS5/HTTP proxies or Vercel relay
- ✅ **Universal** — Works with any OpenAI/Anthropic-compatible CLI tool
- ✅ **Single process** — One command, one port, one container

---

## 🔄 How It Works

```
┌─────────────────┐
│  Your CLI Tool  │  (Claude Code, Cursor, Cline, Kiro, Windsurf, Codex...)
└────────┬────────┘
         │ http://localhost:3100/v1
         ▼
┌──────────────────────────────────────────────────┐
│              AI Gateway (localhost:3100)          │
│                                                  │
│  • Dashboard UI at /                             │
│  • LLM:    /v1/chat/completions                  │
│  • Image:  /v1/images/generations                │
│  • TTS:    /v1/audio/speech                      │
│  • STT:    /v1/audio/transcriptions              │
│  • Embed:  /v1/embeddings                        │
│  • Search: /v1/search                            │
│  • Fetch:  /v1/web/fetch                         │
│  • Token Saver (RTK: -60-90% input tokens)       │
│  • Multi-account round-robin & load balancing    │
│  • Circuit breaker & auto-cooldown               │
│  • Proxy pool routing (SOCKS5/HTTP/Vercel)       │
└────────┬─────────────────────────────────────────┘
         │
         ├─→ Kiro AI (FREE Claude Sonnet 4.5)
         ├─→ Windsurf (FREE via Cascade)
         ├─→ Codex / Antigravity (OAuth)
         ├─→ OpenAI / Anthropic / Gemini (API Key)
         ├─→ Google TTS / Edge TTS (FREE, no key)
         └─→ Any OpenAI-compatible endpoint
```

---

## ⚡ Quick Start

### Prerequisites

- Node.js 22+
- npm

### 1. Clone & Install

```bash
git clone https://github.com/daokimluc/AI-Gateway.git
cd AI-Gateway
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Start Gateway

```bash
# Linux/macOS
export INTERNAL_API_KEYS="your-internal-key"
export ADMIN_API_KEYS="your-admin-password"
node bin/ai-gateway.js
```

```powershell
# Windows PowerShell
$env:INTERNAL_API_KEYS="your-internal-key"
$env:ADMIN_API_KEYS="your-admin-password"
node bin/ai-gateway.js
```

- 🌐 Dashboard: `http://localhost:3100`
- 🔌 API Endpoint: `http://localhost:3100/v1`
- 🔑 Admin password: value of `ADMIN_API_KEYS`

### 4. Add a Provider Account

Dashboard → Providers → Kiro/Windsurf → Add Account → Import from IDE (1 click)

### 5. Connect Your CLI Tool

```
Claude Code / Cursor / Cline Settings:
  API Provider: OpenAI Compatible
  Base URL:     http://localhost:3100/v1
  API Key:      [copy from Dashboard → Endpoint → API Keys]
  Model:        strong (or: kiro-sonnet, coding, fast, balanced)
```

---

## 🐳 Docker

```bash
docker build -t ai-gateway .
docker run -p 3100:3100 \
  -e INTERNAL_API_KEYS="your-key" \
  -e ADMIN_API_KEYS="your-admin-password" \
  -v ./data:/app/data \
  ai-gateway
```

---

## 🎨 Media Providers

AI Gateway routes media requests through the same multi-account pooling infrastructure as LLM chat.

### Endpoints

| Kind | Endpoint | Example Model |
|------|----------|---------------|
| Image Generation | `POST /v1/images/generations` | `cx/gpt-5.5-image` |
| Text to Speech | `POST /v1/audio/speech` | `google-tts/en` |
| Speech to Text | `POST /v1/audio/transcriptions` | `oa/whisper-1` |
| Embedding | `POST /v1/embeddings` | `oa/text-embedding-3-small` |
| Web Search | `POST /v1/search` | *(auto-select)* |
| Web Fetch | `POST /v1/web/fetch` | *(auto-select)* |

### Free Media Providers (no API key needed)

| Provider | Kind | Notes |
|----------|------|-------|
| **Google TTS** | TTS | 58 languages, scrapes Google Translate |
| **Edge TTS** | TTS | 400+ neural voices, scrapes Bing Translator |
| **SearXNG** | Web Search | Self-hosted, no auth |

### Quick Examples

```bash
# Image generation (Codex — requires ChatGPT Plus)
curl -X POST http://localhost:3100/v1/images/generations \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"cx/gpt-5.5-image","prompt":"A cat wearing a hat","size":"1024x1024"}' \
  --output image.png

# TTS — Google (free, no API key needed)
curl -X POST http://localhost:3100/v1/audio/speech \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"google-tts/vi","input":"Xin chào thế giới"}' \
  --output speech.mp3

# Embedding
curl -X POST http://localhost:3100/v1/embeddings \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"oa/text-embedding-3-small","input":"Hello world"}'
```

📖 Full provider list: [docs/MEDIA_PROVIDERS.md](docs/MEDIA_PROVIDERS.md)

---

## 🔀 Proxy Pools

Route requests through SOCKS5/HTTP proxies or Vercel relay to bypass IP-based rate limits.

Dashboard → Proxy Pools → Add Pool → assign to provider accounts.

📖 Details: [docs/PROXY_POOLS.md](docs/PROXY_POOLS.md)

---

## 🛠️ Supported CLI Tools

| Tool | Status |
|------|--------|
| Claude Code | ✅ |
| Cursor IDE | ✅ |
| Cline | ✅ |
| Kiro IDE | ✅ |
| Windsurf | ✅ |
| OpenAI Codex | ✅ |
| Antigravity | ✅ |
| Continue | ✅ |
| Any OpenAI-compatible | ✅ |

---

## 🌐 Supported Providers

### 🆓 Free Providers (Built-in Adapters)

| Provider | Models | Auth |
|----------|--------|------|
| **Kiro AI** | Claude Sonnet 4.5, GLM-5, MiniMax | OAuth / Local Import |
| **Windsurf** | Claude Sonnet 4.6 Thinking | OAuth / Local Import |
| **Codex** | GPT-5.x (ChatGPT Plus) | OAuth PKCE |
| **Antigravity** | Gemini 3 Pro, Claude Sonnet 4.6 | OAuth PKCE |
| **Google TTS** | 58 languages | None |
| **Edge TTS** | 400+ neural voices | None |

### 🔑 API Key Providers

OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, DeepSeek, Together, Fireworks, Nebius, ElevenLabs, Deepgram, AssemblyAI, Tavily, Brave, Serper, Exa, Firecrawl, Jina, Voyage AI, and 30+ more.

---

## 💡 Key Features

| Feature | Description |
|---------|-------------|
| 🚀 **Token Saver (RTK)** | Compress tool outputs (git diff, grep, ls, tree...) — 60-90% fewer input tokens |
| 🪨 **Caveman Mode** | Inject terse-mode system prompt — up to 65% fewer output tokens |
| 🔄 **Multi-Account Pool** | Round-robin, weighted, least-busy account selection |
| 🎯 **Route Chains** | Priority-ordered model fallback, zero downtime |
| ⚡ **Circuit Breaker** | Per-provider failure detection, auto-cooldown |
| 🎨 **Media Providers** | Image, TTS, STT, Embedding, Web Search via unified API |
| 🔀 **Proxy Pools** | SOCKS5/HTTP/Vercel relay with health testing |
| 📊 **Real-Time Dashboard** | Provider health, request logs, usage analytics |
| 🔐 **API Key Management** | Per-key rate limits, team quotas |
| 👥 **Teams & Quotas** | Group API keys, shared RPM/daily limits |
| 🔄 **Auto Token Refresh** | Provider sessions refresh automatically |
| 📝 **Config Versioning** | Draft → Validate → Publish → Rollback |
| 🌐 **Dual Protocol** | OpenAI `/v1/chat/completions` + Anthropic `/v1/messages` |
| 🎨 **i18n Dashboard** | English + Vietnamese |
| 📦 **Single Package** | One process, one port, one container |

---

## 📖 Setup Guide

### Adding Accounts

**Method 1: Import from IDE (Fastest)**

Dashboard → Providers → Select Provider → Add Account → "Nhập từ máy" tab → Click import

**Method 2: Paste Token**

Dashboard → Providers → Select Provider → Add Account → "Token / Key" tab

**Method 3: OAuth (Windsurf, Codex, Antigravity)**

Dashboard → Providers → Select Provider → Add Account → "Ủy quyền OAuth" tab

### Creating Routes (Fallback Chains)

Dashboard → Routes → Create Route → Add models in priority order

```
Route: "coding"
  1. kiro-sonnet        (free, primary)
  2. windsurf-sonnet    (free, backup)
```

### Available Model IDs

| Model ID | Description |
|----------|-------------|
| `strong` | Best quality |
| `coding` | Optimized for code |
| `fast` | Fastest response |
| `balanced` | Balance of speed and quality |
| `kiro-sonnet` | Direct to Kiro |
| `windsurf-sonnet` | Direct to Windsurf |

---

## 🏗️ Architecture

```
ai-gateway/
├── bin/ai-gateway.js          # CLI entry point
├── apps/
│   ├── gateway/src/
│   │   ├── routes/            # LLM + Admin + OAuth routes
│   │   ├── media/             # Media routing (image/tts/stt/embed/search)
│   │   │   ├── MediaRouter.ts
│   │   │   ├── handlers/      # Per-kind handlers (30+ provider formats)
│   │   │   └── autoSyncMediaConfig.ts
│   │   ├── proxy/             # Proxy pool service + ProxyAwareFetch
│   │   ├── providers/         # Provider adapter system
│   │   │   └── adapters/      # kiro, windsurf, codex, antigravity, github
│   │   └── services/          # Secret, Audit, Persistence, RateLimit
│   └── dashboard/src/
│       ├── components/        # Provider catalog UI components
│       ├── media/             # Per-kind provider pages
│       └── providerCatalog.ts # 50+ provider definitions
├── docs/                      # Documentation
└── Dockerfile                 # Multi-stage, non-root user
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ / TypeScript 5.6 |
| Gateway | Fastify 5 |
| Dashboard | React 19 + Vite 7 |
| Storage | JSON file persistence |
| Auth | Bearer token + AES-256-GCM encryption |
| Streaming | Server-Sent Events (SSE) |
| Container | node:22-alpine, non-root user |

---

## 📝 API Reference

### Chat Completions

```http
POST /v1/chat/completions
Authorization: Bearer <key>

{"model": "strong", "messages": [{"role": "user", "content": "Hello"}], "stream": true}
```

### Image Generation

```http
POST /v1/images/generations
Authorization: Bearer <key>

{"model": "cx/gpt-5.5-image", "prompt": "A cat", "size": "1024x1024"}
```

### Text to Speech

```http
POST /v1/audio/speech
Authorization: Bearer <key>

{"model": "google-tts/en", "input": "Hello world"}
```

### Embedding

```http
POST /v1/embeddings
Authorization: Bearer <key>

{"model": "oa/text-embedding-3-small", "input": "Hello world"}
```

Full API reference: [docs/API_REFERENCE.md](docs/API_REFERENCE.md)

---

## ⚙️ CLI Options

```
Usage: ai-gateway [options]

Options:
  --port <number>  Port to listen on (default: 3100)
  --host <string>  Host to bind to (default: 0.0.0.0)
  --help           Show help

Environment Variables:
  INTERNAL_API_KEYS   API keys for /v1 routes (required)
  ADMIN_API_KEYS      API keys for /admin routes (required)
  DATA_FILE           State file path (default: data/gateway-state.json)
  DASHBOARD_DIST      Override dashboard static files path
  LOG_LEVEL           info | debug | warn | error (default: info)
```

---

## 🗺️ Roadmap

- [x] Kiro / Windsurf / Codex / Antigravity provider adapters
- [x] Multi-account pool with round-robin
- [x] Route chains with fallback
- [x] Token Saver (RTK) + Caveman Mode
- [x] Dashboard with full admin control
- [x] API key management with team quotas
- [x] Circuit breaker per provider
- [x] **Media Providers** — Image, TTS, STT, Embedding, Web Search, Web Fetch
- [x] **Proxy Pools** — SOCKS5/HTTP/Vercel relay with health testing
- [x] **50+ provider catalog** with auto-sync on startup
- [x] Google TTS + Edge TTS (free, no API key)
- [ ] Text to Video (Gemini Veo, Runway ML)
- [ ] Docker Hub image
- [ ] npm publish (npx ai-gateway)

---

## 📚 Documentation

| Doc | Description |
|-----|-------------|
| [API Reference](docs/API_REFERENCE.md) | Full REST API docs |
| [Media Providers](docs/MEDIA_PROVIDERS.md) | Image, TTS, STT, Embedding, Search |
| [Proxy Pools](docs/PROXY_POOLS.md) | SOCKS5/HTTP/Vercel relay setup |
| [Architecture](docs/ARCHITECTURE.md) | System design |
| [Dashboard](docs/DASHBOARD.md) | Dashboard guide |
| [Operations](docs/OPERATIONS.md) | Deployment & ops |

---

## 🙏 Acknowledgments

- [RTK](https://github.com/rtk-ai/rtk) — Token compression pipeline (60-90% fewer input tokens)
- [Caveman](https://github.com/JuliusBrussee/caveman) — Terse output prompt (up to 65% fewer output tokens)
- [WindsurfAPI](https://github.com/dwgx/WindsurfAPI) — Windsurf Cascade protocol reference

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

<p align="center">Built with ❤️ for developers who code 24/7</p>
