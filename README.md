# Website Pipeline API

A 2-agent website generation pipeline that creates professional business websites and uploads them to Supabase Storage.

Around the two agents sits a reliability layer: an LLM gateway with timeouts, retries and provider failover, schema validation of the Architect's output, a deterministic quality gate on the Builder's HTML with a bounded repair loop, idempotent runs, and a record of every run. The reasoning behind each piece is in [docs/RELIABILITY.md](docs/RELIABILITY.md).

## Architecture

```
┌─────────────────┐      ┌─────────────────────┐      ┌─────────────────────┐
│   USER INPUT    │──────▶│   ARCHITECT AGENT  │──────▶│   BUILDER AGENT    │
│   (Business     │      │   (Gemini LLM)      │      │   (Gemini LLM)     │
│    Info JSON)   │      │   Generates spec    │      │   Generates HTML   │
└─────────────────┘      └─────────────────────┘      └──────────┬──────────┘
                                                                  │
                                                                  ▼
                                                    ┌─────────────────────┐
                                                    │  SUPABASE STORAGE   │
                                                    │  uploads/           │
                                                    │  {slug}/{ts}/index.html
                                                    └─────────────────────┘
```

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your API keys
```

Required environment variables:
- `GEMINI_API_KEY` - Google AI API key
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key

### 3. Create Supabase Bucket
In your Supabase dashboard:
1. Go to Storage → Create new bucket
2. Name it `websites`
3. Set to **Public** for direct URL access

### 4. Start the Server
```bash
npm start
# or for development with auto-reload:
npm run dev
```

## Workflows

### A. Full Automated Pipeline (Gemini as Builder)
Runs both agents automatically.

```bash
curl -X POST "http://localhost:4000/pipeline" \
  -H "Content-Type: application/json" \
  -d @test-input.json
```

### B. Antigravity Workflow (You are the Builder)
1. **Run Architect**: Generates a task file for you.
   ```bash
   curl -X POST "http://localhost:4000/architect" \
     -H "Content-Type: application/json" \
     -d @test-input.json
   ```
   *Tip: Use `?mock=true` if hitting API rate limits.*

2. **Generate Site**: Open the generated task file in `tasks/` and ask Antigravity (the AI agent) to "Generate the website based on this task".

3. **Upload**: The file watcher will auto-upload to Supabase. Or manually trigger:
   ```bash
   curl -X POST "http://localhost:4000/upload?runId={run-id}&slug={slug}"
   ```

### C. Builder-Only Retry (Recovery from Builder Failure)
If a `/pipeline` run completes the architect stage but fails at builder or upload, you can retry without re-running the architect:

1. **Note from the error response**: `run_id` and `business_slug` (returned automatically when builder fails).
2. **Retry**:
   ```bash
   curl -X POST "http://localhost:4000/pipeline/retry?retryRunId={run_id}&retrySlug={slug}" \
     -H "Content-Type: application/json" \
     -d @test-input.json
   ```
   This loads the persisted `architect-spec.json` from the previous run, skips the architect entirely, and re-runs builder + upload.

## Reliability at a Glance

| Concern | What the pipeline does |
|---------|------------------------|
| A provider is rate limited or down | Retries with exponential backoff and jitter, then fails over along `BUILDER_LLM_CHAIN` / `ARCHITECT_LLM_CHAIN` |
| The model returns malformed JSON | Validates with Zod and sends the errors back for a bounded repair |
| The model returns broken or cut off HTML | Blocks it at the quality gate, asks for one repair, and refuses to publish if it still fails |
| The same request arrives twice | Replays the earlier result instead of generating and uploading again |
| Something failed and you need to know where | `GET /runs/:runId` shows the stage, timings and every LLM attempt |

## Testing

```bash
npm test          # 126 unit tests, no network, no API keys
npm run typecheck # strict TypeScript, including tests
npm run check     # both
```

## API Endpoints

| Endpoint | Method | Description | Query Params |
|----------|--------|-------------|--------------|
| `/pipeline` | POST | Full automated generation | `?mock=true`, `?skipUpload=true`, `?force=true` |
| `/pipeline/retry` | POST | Builder-only retry (skips architect) | `?retryRunId=...&retrySlug=...`, `?skipUpload=true` |
| `/architect`| POST | Generate task for Antigravity | `?mock=true` |
| `/upload` | POST | Manually upload generated HTML | `?runId=...&slug=...` |
| `/validate` | POST | Validate input JSON | - |
| `/health` | GET | Health check | - |
| `/runs/:runId` | GET | Run record: stage, timings, LLM attempts, result | - |

## Project Structure
```
src/
├── agents/
│   ├── architect.ts   # Architect Agent
│   └── builder.ts     # Builder Agent
├── schemas/
│   ├── business-input.ts
│   ├── architect-output.ts
│   └── pipeline-result.ts
├── services/
├── pipeline/
│   └── orchestrator.ts  # Pipeline orchestrator (supports retry)
├── bridge-server.ts   # API server
output/                # Generated websites + architect-spec.json
tasks/                 # Generated tasks for Antigravity
```

## License
ISC
