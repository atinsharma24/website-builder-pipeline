# Website Pipeline API

A 2-agent website generation pipeline that creates stunning, professional business websites and uploads them to Supabase Storage.

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

## API Endpoints

| Endpoint | Method | Description | Query Params |
|----------|--------|-------------|--------------|
| `/pipeline` | POST | Full automated generation | `?mock=true`, `?skipUpload=true` |
| `/architect`| POST | Generate task for Antigravity | `?mock=true` |
| `/upload` | POST | Manually upload generated HTML | `?runId=...&slug=...` |
| `/validate` | POST | Validate input JSON | - |
| `/health` | GET | Health check | - |

## Project Structure
```
src/
├── agents/
│   ├── architect.ts   # Architect Agent
│   └── builder.ts     # Builder Agent
├── schemas/
│   ├── business-input.ts
│   └── architect-output.ts
├── services/
├── pipeline/
├── bridge-server.ts   # API server
└── tasks/             # Generated tasks for Antigravity
```

## License
ISC
