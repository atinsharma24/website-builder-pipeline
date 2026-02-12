# API cURL Commands

Ready-to-use command-line snippets for testing every endpoint on the Website Pipeline API.

---

## Prerequisites

1. **Server must be running** on `http://localhost:4000`:
   ```bash
   # Production (compile + start)
   npm start

   # Or development (auto-reload)
   npm run dev
   ```

2. **`test-input.json`** should exist in the project root. If it doesn't, create a minimal one:
   ```bash
   cat > test-input.json << 'EOF'
   {
     "business_name": "Sharma Optics",
     "address": "123 MG Road, Near City Center",
     "city": "Indore",
     "state": "Madhya Pradesh",
     "owner_name": "Atin Sharma",
     "business_category": "optical",
     "description": "Premium optical store offering designer frames, contact lenses, and comprehensive eye examinations. With over 25 years of trusted service in Central India, Sharma Optics combines cutting-edge technology with personalized care.",
     "photos": [
       { "url": "https://picsum.photos/seed/store1/800/600", "alt": "Store exterior" },
       { "url": "https://picsum.photos/seed/frames1/800/600", "alt": "Designer frame collection" }
     ],
     "phone": "+91 731 4001234",
     "email": "info@sharmaoptics.com",
     "hours": {
       "Monday": "10:00 AM - 8:00 PM",
       "Tuesday": "10:00 AM - 8:00 PM",
       "Wednesday": "10:00 AM - 8:00 PM",
       "Thursday": "10:00 AM - 8:00 PM",
       "Friday": "10:00 AM - 8:00 PM",
       "Saturday": "10:00 AM - 9:00 PM",
       "Sunday": "11:00 AM - 6:00 PM"
     }
   }
   EOF
   ```

---

## Pipeline Endpoints — `POST /pipeline`

The main endpoint that runs the full 4-phase pipeline: **Validate → Architect → Builder → Upload**.

### Production Run

Calls real LLM APIs (Gemini/OpenAI/Claude as configured) and uploads the generated HTML to Supabase Storage.

```bash
curl -X POST http://localhost:4000/pipeline \
  -H "Content-Type: application/json" \
  -d @test-input.json
```

> **Cost**: This consumes LLM API credits. The Architect and Builder each make one LLM call.

### Mock Run

Uses hardcoded mock agents instead of real LLMs. The `mock=true` query param bypasses all API calls, returning a template HTML file. Useful for testing the pipeline logic, validation, and upload flow without incurring costs.

```bash
# mock=true → Uses mockArchitect() and mockBuilder() instead of real LLM calls
curl -X POST "http://localhost:4000/pipeline?mock=true" \
  -H "Content-Type: application/json" \
  -d @test-input.json
```

### Skip Upload (Local Only)

Generates the website but does **not** upload to Supabase. The HTML is saved locally to `output/{slug}/{runId}/index.html`. The `skipUpload=true` param skips the entire Phase 4 (Supabase Storage upload).

```bash
# skipUpload=true → HTML saved locally only, no Supabase interaction
curl -X POST "http://localhost:4000/pipeline?skipUpload=true" \
  -H "Content-Type: application/json" \
  -d @test-input.json
```

### Mock + Skip Upload (Fully Offline)

Combines both flags for a completely offline, zero-cost test of the pipeline logic.

```bash
# Both flags → No LLM calls, no Supabase upload
curl -X POST "http://localhost:4000/pipeline?mock=true&skipUpload=true" \
  -H "Content-Type: application/json" \
  -d @test-input.json
```

### Expected Success Response

```json
{
  "status": "success",
  "run_id": "run-1707753600000",
  "business_slug": "sharma-optics",
  "storage_path": "sharma-optics/1707753600000/index.html",
  "public_url": "https://abc123.supabase.co/storage/v1/object/public/websites/...",
  "html_size_bytes": 42560,
  "generated_at": "2026-02-12T08:00:00.000Z"
}
```

---

## Architect Workflow — `POST /architect`

Runs **only** the Architect Agent (Phase 2). Generates a task file in `tasks/` and saves the spec JSON in `output/`. This is the first step of the manual/Antigravity workflow — a human or AI developer then reads the task and builds the HTML.

### Generate Task (Production)

Calls the real Architect LLM to generate a website specification.

```bash
curl -X POST http://localhost:4000/architect \
  -H "Content-Type: application/json" \
  -d @test-input.json
```

### Mock Architect

Uses `mockArchitect()` to return a hardcoded specification. No LLM API call is made. Useful for testing the task-file creation and Antigravity handoff flow.

```bash
# mock=true → Uses mockArchitect(), no LLM credits consumed
curl -X POST "http://localhost:4000/architect?mock=true" \
  -H "Content-Type: application/json" \
  -d @test-input.json
```

### Expected Response

```json
{
  "status": "pending_builder",
  "run_id": "run-1707753600000",
  "business_slug": "sharma-optics",
  "task_file": "tasks/run-1707753600000.md",
  "output_path": "output/sharma-optics/run-1707753600000/index.html",
  "spec_file": "output/sharma-optics/run-1707753600000/architect-spec.json",
  "next_step": "Generate index.html using the architect prompt, then call POST /upload or let watcher auto-upload"
}
```

> **Next step**: Read the task file at `tasks/{run_id}.md`, generate `index.html` at the `output_path`, then either let the watcher auto-upload or call `POST /upload` manually (see below).

---

## Upload Endpoint — `POST /upload`

Manually triggers an upload of an existing HTML file from the local `output/` directory to Supabase Storage. This is Step 2 of the Antigravity workflow (alternative to the auto-watcher).

### Manual Upload

```bash
# Replace RUN_ID and SLUG with actual values from the /architect response
curl -X POST "http://localhost:4000/upload?runId=RUN_ID&slug=SLUG"
```

**Example** (using values from a previous `/architect` call):

```bash
curl -X POST "http://localhost:4000/upload?runId=run-1707753600000&slug=sharma-optics"
```

> **Important**: The file at `output/{slug}/{runId}/index.html` must already exist. This endpoint reads the file from disk and uploads it — it does not generate anything.

### Expected Success Response

```json
{
  "status": "success",
  "run_id": "run-1707753600000",
  "business_slug": "sharma-optics",
  "public_url": "https://abc123.supabase.co/storage/v1/object/public/websites/...",
  "html_size_bytes": 42560
}
```

### Error — Missing File

```json
{
  "status": "error",
  "error_message": "HTML file not found: /path/to/output/sharma-optics/run-xxx/index.html",
  "expected_path": "output/sharma-optics/run-xxx/index.html"
}
```

---

## Validation — `POST /validate`

Validates the business input JSON against the `BusinessInputSchema` (Zod) without running any pipeline phase. Useful for checking input structure before committing to a full pipeline run.

### Check Input

```bash
curl -X POST http://localhost:4000/validate \
  -H "Content-Type: application/json" \
  -d @test-input.json
```

### Expected Valid Response

```json
{
  "valid": true,
  "data": {
    "business_name": "Sharma Optics",
    "address": "123 MG Road, Near City Center",
    "city": "Indore",
    "state": "Madhya Pradesh",
    "business_category": "optical",
    "description": "Premium optical store...",
    "photos": [...],
    "phone": "+91 731 4001234",
    "email": "info@sharmaoptics.com"
  }
}
```

### Check with Invalid Input

```bash
# Missing required fields → returns validation errors
curl -X POST http://localhost:4000/validate \
  -H "Content-Type: application/json" \
  -d '{"business_name": "AB"}'
```

### Expected Error Response

```json
{
  "valid": false,
  "errors": [
    { "field": "address", "message": "Required" },
    { "field": "city", "message": "Required" },
    { "field": "state", "message": "Required" },
    { "field": "business_category", "message": "Required" },
    { "field": "description", "message": "Required" }
  ]
}
```

---

## System — `GET /health`

Simple health check that reports server status and whether API keys are configured.

### Health Check

```bash
curl http://localhost:4000/health
```

### Expected Response

```json
{
  "status": "healthy",
  "timestamp": "2026-02-12T09:10:28.000Z",
  "env": {
    "gemini_configured": true,
    "supabase_configured": true
  }
}
```

> `gemini_configured` checks for `GEMINI_API_KEY`. `supabase_configured` checks for both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

---

## Quick Reference

| Endpoint | Method | Key Params | Purpose |
|---|---|---|---|
| `/pipeline` | POST | `mock`, `skipUpload` | Full automated pipeline |
| `/architect` | POST | `mock` | Architect-only (manual workflow) |
| `/upload` | POST | `runId`, `slug` | Upload existing HTML |
| `/validate` | POST | — | Validate input JSON |
| `/health` | GET | — | Server status |

### NPM Shortcut

The project also includes a built-in test command that runs a mock pipeline request:

```bash
# Equivalent to: curl -X POST http://localhost:4000/pipeline?mock=true -d @test-input.json
npm run test:mock
```
