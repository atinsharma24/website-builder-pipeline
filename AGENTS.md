# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Build and Run Commands

```bash
# Install dependencies
npm install

# Start production server (compiles TypeScript first)
npm start

# Development mode with auto-reload
npm run dev

# Build TypeScript only
npm run build

# Run file watcher for auto-upload to Supabase
npm run worker

# Test with mock LLM (no API calls)
npm run test:mock
```

The server runs on port 4000 by default (configurable via `PORT` env var).

## Architecture Overview

This is a **2-agent website generation pipeline** that creates business websites from structured JSON input and uploads them to Supabase Storage.

### Pipeline Flow
```
BusinessInput JSON → Architect Agent (Gemini) → Builder Agent (Gemini/OpenAI) → Supabase Storage
```

### Two Workflows

1. **Full Automated Pipeline** (`POST /pipeline`): Both agents run automatically, HTML uploaded to Supabase
2. **Antigravity Workflow** (`POST /architect`): Architect generates a task file in `tasks/`, human/AI builds HTML, watcher auto-uploads

### Key Components

- **`src/bridge-server.ts`**: Fastify HTTP server with all API endpoints
- **`src/agents/architect.ts`**: Takes BusinessInput, outputs detailed website generation prompt (always uses Gemini)
- **`src/agents/builder.ts`**: Takes ArchitectOutput, generates complete HTML (provider configurable via `BUILDER_LLM_PROVIDER`)
- **`src/pipeline/orchestrator.ts`**: Coordinates validation → architect → builder → upload phases
- **`src/services/llm.ts`**: Unified LLM abstraction supporting Gemini and OpenAI
- **`src/services/supabase.ts`**: Storage upload utilities for the `websites` bucket
- **`src/watcher.ts`**: Chokidar-based file watcher that auto-uploads HTML from `output/` directory
- **`src/schemas/`**: Zod schemas for BusinessInput, ArchitectOutput, and PipelineResult

### Data Flow

1. Input validated against `BusinessInputSchema` (Zod)
2. Architect produces `ArchitectOutput` with `website_generation_prompt`, `site_style_guidelines`, and `page_sections`
3. Builder generates single-file HTML with Tailwind CSS (via CDN), inline styles, and animations
4. HTML uploaded to Supabase at path `{slug}/{timestamp}/index.html`

## Code Conventions

- **ESM modules**: All imports use `.js` extensions (TypeScript compiles to ESM)
- **Type annotations**: Strict TypeScript with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- **Schema validation**: All external input validated with Zod before processing
- **Error handling**: Pipeline returns typed `PipelineResult` with `status: "success" | "error"`

## Environment Variables

Required in `.env` (see `.env.example`):
- `GEMINI_API_KEY` - Required for Architect Agent (and Builder if using Gemini)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` - Required for upload
- `BUILDER_LLM_PROVIDER` - Optional: `gemini` (default) or `openai`
- `OPENAI_API_KEY` - Required only if `BUILDER_LLM_PROVIDER=openai`

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/pipeline` | POST | Full automated generation (`?mock=true`, `?skipUpload=true`) |
| `/architect` | POST | Generate task file for manual build (`?mock=true`) |
| `/upload` | POST | Manual upload (`?runId=...&slug=...`) |
| `/validate` | POST | Validate input JSON only |
| `/health` | GET | Health check with config status |

## Testing

Use `?mock=true` query parameter to bypass LLM calls during development. This uses `mockArchitect()` and `mockBuilder()` functions that return deterministic output.

Example:
```bash
curl -X POST "http://localhost:4000/pipeline?mock=true&skipUpload=true" \
  -H "Content-Type: application/json" \
  -d @test-input.json
```
