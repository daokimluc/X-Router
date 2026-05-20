# Media Providers

AI Gateway supports routing media requests (image generation, TTS, STT, embedding, web search, web fetch) through the same multi-account pooling and proxy infrastructure as LLM chat.

## Endpoints

| Kind | Endpoint | Method |
|------|----------|--------|
| Embedding | `/v1/embeddings` | POST |
| Image Generation | `/v1/images/generations` | POST |
| Text to Speech | `/v1/audio/speech` | POST |
| Speech to Text | `/v1/audio/transcriptions` | POST |
| Web Search | `/v1/search` | POST |
| Web Fetch | `/v1/web/fetch` | POST |

## Model Naming

Models use a `provider-alias/model-id` format:

```
cx/gpt-5.5-image          → Codex image generation
oa/text-embedding-3-small → OpenAI embedding
gm/gemini-2.5-flash-image → Gemini image generation
google-tts/en             → Google TTS (English)
edge-tts/vi-VN-HoaiMyNeural → Edge TTS (Vietnamese)
```

When no prefix is provided, the gateway picks the first available provider for that kind.

## Supported Providers by Kind

### Embedding

| Provider | Alias | Models |
|----------|-------|--------|
| OpenAI | `oa` | text-embedding-3-small, text-embedding-3-large, text-embedding-ada-002 |
| Gemini | `gm` | gemini-embedding-2-preview, text-embedding-005, text-embedding-004 |
| OpenRouter | `or` | openai/text-embedding-3-large, qwen/qwen3-embedding-8b |
| Mistral | `ms` | mistral-embed |
| Voyage AI | `voyage` | voyage-3-large, voyage-3.5, voyage-code-3 |
| Jina AI | `jina` | jina-embeddings-v3, jina-embeddings-v2-base-en |
| Together | `tg` | BAAI/bge-large-en-v1.5 |
| Fireworks | `fw` | nomic-ai/nomic-embed-text-v1.5 |
| Nebius | `nb` | Qwen/Qwen3-Embedding-8B |
| GitHub | `gh` | text-embedding-3-small, text-embedding-3-large |

### Image Generation

| Provider | Alias | Models |
|----------|-------|--------|
| OpenAI | `oa` | gpt-image-1, dall-e-3, dall-e-2 |
| Codex (ChatGPT Plus) | `cx` | gpt-5.5-image, gpt-5.4-image, gpt-5.3-image, gpt-5.2-image |
| Gemini | `gm` | gemini-3.1-flash-image-preview, gemini-2.5-flash-image, imagen-3.0-generate-002 |
| OpenRouter | `or` | openai/gpt-image-1, openai/dall-e-3 |
| MiniMax | `mm` | image-01 |
| Cloudflare | `cf` | @cf/black-forest-labs/FLUX.1-schnell |
| HuggingFace | `hf` | black-forest-labs/FLUX.1-schnell, stabilityai/stable-diffusion-xl-base-1.0 |
| NanoBanana | `nn` | nanobanana-flash, nanobanana-pro |
| Fal.ai | `fal` | Various FLUX models |
| Stability AI | `stability` | sd3.5-large, core, ultra |
| Recraft | `rc` | recraft-v3 |

### Text to Speech (TTS)

| Provider | Alias | Auth | Models |
|----------|-------|------|--------|
| OpenAI | `oa` | API Key | tts-1, tts-1-hd, gpt-4o-mini-tts |
| Google TTS | `google-tts` | None (free) | 58 languages (en, vi, ja, ko, zh-CN...) |
| Edge TTS | `edge-tts` | None (free) | 400+ neural voices |
| Gemini | `gm` | API Key | gemini-2.5-flash-preview-tts |
| ElevenLabs | `el` | API Key | eleven_multilingual_v2, eleven_turbo_v2_5 |
| Deepgram | `dg` | API Key | aura-asteria-en, aura-luna-en |
| OpenRouter | `or` | API Key | openai/gpt-4o-mini-tts, openai/tts-1 |
| MiniMax | `mm` | API Key | speech-02-hd, speech-02 |
| Hyperbolic | `hyp` | API Key | melo-tts |

### Speech to Text (STT)

| Provider | Alias | Models |
|----------|-------|--------|
| OpenAI | `oa` | whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe |
| Gemini | `gm` | gemini-2.5-flash, gemini-2.0-flash |
| Groq | `gq` | whisper-large-v3-turbo, whisper-large-v3 |
| Deepgram | `dg` | nova-3, nova-2 |
| AssemblyAI | `aai` | universal-3-pro, universal-2 |
| HuggingFace | `hf` | openai/whisper-large-v3 |

### Web Search

| Provider | Alias | Format |
|----------|-------|--------|
| Perplexity | `px` | perplexity |
| Tavily | `tv` | tavily |
| Brave Search | `bv` | brave |
| Serper | `sp` | serper |
| Exa | `ex` | exa |
| SearXNG | `sx` | searxng (self-hosted, no auth) |
| Google PSE | `gpse` | google-pse |
| Linkup | `lu` | linkup |
| SearchAPI | `sa` | searchapi |
| You.com | `yc` | youcom |

### Web Fetch

| Provider | Alias | Format |
|----------|-------|--------|
| Tavily | `tv` | tavily |
| Exa | `ex` | exa |
| Firecrawl | `fc` | firecrawl |
| Jina Reader | `jina` | jina |

## Usage Examples

### Image Generation (Codex)

```bash
curl -X POST http://localhost:3100/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{
    "model": "cx/gpt-5.5-image",
    "prompt": "A cute cat wearing a hat",
    "size": "1024x1024",
    "output_format": "png"
  }'
```

### Text to Speech (Google TTS — free)

```bash
curl -X POST http://localhost:3100/v1/audio/speech \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{"model": "google-tts/vi", "input": "Xin chào thế giới"}' \
  --output speech.mp3
```

### Embedding

```bash
curl -X POST http://localhost:3100/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{
    "model": "oa/text-embedding-3-small",
    "input": "Hello world"
  }'
```

### Web Search

```bash
curl -X POST http://localhost:3100/v1/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{
    "query": "latest AI news",
    "max_results": 5
  }'
```

## Auto-Sync

When the gateway starts, it automatically applies media configurations to provider instances that were created via OAuth/CLI import flows. This means providers like Codex, OpenAI, and Gemini get their media capabilities (image, TTS, STT, embedding) configured without manual setup.

No-auth providers (Google TTS, Edge TTS) are auto-created as provider instances on startup — they work immediately without any configuration.

## Proxy Pool Integration

Media requests support the same proxy pool infrastructure as LLM requests. Assign a proxy pool to a provider account to route media requests through SOCKS5/HTTP proxies or Vercel relay endpoints.

## Dashboard

The dashboard at `http://localhost:3100` provides a full UI for managing media providers:

- **Catalog grid** — browse all available providers per kind
- **Connection management** — add/remove API keys and OAuth accounts
- **Models card** — view and add models per provider
- **Example playground** — test requests with live preview (image display, audio player)
- **Config card** — view endpoint and auth configuration
