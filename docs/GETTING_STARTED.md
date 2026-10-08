# Getting Started

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | v18+ | Required for ESM support and native `fetch` |
| **npm** | v9+ | Comes with Node.js |
| **Supabase Project** | — | You need a Supabase project with Storage and Database enabled |
| **LLM API Key** | — | At least one: Google Gemini, OpenAI, or Anthropic |

---

## Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd website-pipeline-api

# Install dependencies
npm install
```

---

## Environment Setup

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

### Environment Variables Reference

#### LLM API Keys

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes (if using Gemini) | — | Google AI Studio API key |
| `GEMINI_MODEL` | No | `gemini-3.8-flash` | Gemini model name |
| `OPENAI_API_KEY` | Yes (if using OpenAI) | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-6-astra` | OpenAI model name |
| `ANTHROPIC_API_KEY` | Yes (if using Claude) | — | Anthropic API key |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-5-5` | Claude model name |

#### Provider Toggles

| Variable | Required | Default | Options | Description |
|---|---|---|---|---|
| `ARCHITECT_LLM_CHAIN` | No | `gemini` | comma separated `gemini`, `openai`, `claude` | Failover order for the Architect Agent |
| `BUILDER_LLM_CHAIN` | No | `gemini` | comma separated `gemini`, `openai`, `claude` | Failover order for the Builder Agent |
| `ARCHITECT_LLM_PROVIDER` | No | — | `gemini`, `openai`, `claude` | Older single provider setting, used only when `ARCHITECT_LLM_CHAIN` is unset |
| `BUILDER_LLM_PROVIDER` | No | — | `gemini`, `openai`, `claude` | Older single provider setting, used only when `BUILDER_LLM_CHAIN` is unset |

> **Tip**: You can mix providers and give each agent a fallback. For example, Gemini first for the Architect and Claude first for the Builder:
> ```
> ARCHITECT_LLM_CHAIN=gemini,openai
> BUILDER_LLM_CHAIN=claude,gemini
> ```
>
> Leave the key of any provider you do not use empty. See `docs/RELIABILITY.md` for retries, timeouts and the quality gate.

#### Supabase Configuration

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | For uploads | Your Supabase project URL (e.g. `https://abc123.supabase.co`). Leave empty and use `?skipUpload=true` to run without uploads |
| `SUPABASE_ANON_KEY` | No | Public anon key (used by client-side apps) |
| `SUPABASE_SERVICE_ROLE_KEY` | For uploads | Service role key (full access, used by the server) |
| `SUPABASE_DATABASE_URL` | No | Direct PostgreSQL connection string |

#### Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `4000` | HTTP server port |

### Minimal .env Example

```env
# Minimum viable setup (Gemini + Supabase)
GEMINI_API_KEY=your_gemini_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

---

## Running the System

### Build

```bash
# Compile TypeScript to JavaScript
npm run build
```

### API Server (Production)

```bash
# Compile + start the Fastify server on port 4000
npm start
```

The server will print all available endpoints on startup:

```
============================================================
🚀 Website Pipeline API Server
============================================================
   Port: 4000
   Gemini API: ✅ Configured
   Supabase: ✅ Configured
============================================================

Endpoints:
  POST /pipeline   - Full automated pipeline (Gemini builds)
  POST /architect  - Architect only → saves task for Antigravity
  POST /upload     - Upload HTML to Supabase (?runId=X&slug=Y)
  POST /validate   - Validate business input
  GET  /health     - Health check
============================================================
```

### Development Mode

```bash
# Run with ts-node and --watch for auto-reload on file changes
npm run dev
```

### File Watcher

```bash
# Start the Chokidar watcher for auto-uploading generated HTML
npm run worker
```

> The watcher monitors `output/` for new `index.html` files and automatically uploads them to Supabase Storage.

### Test with Mock Data

```bash
# Send a test request using the included test-input.json (uses mock agents)
npm run test:mock
```

This sends a `POST /pipeline?mock=true` request with a sample business (Sharma Optics) to verify the system works end-to-end without consuming LLM credits.

---

## Health Check

Verify the server is running and configured correctly:

```bash
curl http://localhost:4000/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-12T08:45:00.000Z",
  "env": {
    "gemini_configured": true,
    "supabase_configured": true
  }
}
```
