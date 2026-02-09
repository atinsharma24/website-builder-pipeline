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

## API Endpoints

### POST /pipeline
Runs the complete website generation pipeline.

**Request:**
```json
{
  "business_name": "Sharma Optics",
  "address": "123 MG Road",
  "city": "Indore",
  "state": "Madhya Pradesh",
  "owner_name": "Atin Sharma",
  "business_category": "optical",
  "description": "Premium optical store with 25 years of trusted service...",
  "photos": [
    { "url": "https://example.com/photo.jpg", "alt": "Store front" }
  ],
  "phone": "+91 731 4001234",
  "email": "info@sharmaoptics.com"
}
```

**Query Parameters:**
- `?mock=true` - Use mock agents (no LLM calls)
- `?skipUpload=true` - Skip Supabase upload

**Response (success):**
```json
{
  "status": "success",
  "run_id": "run-1739094866123",
  "business_slug": "sharma-optics",
  "storage_path": "sharma-optics/1739094866123/index.html",
  "public_url": "https://xxx.supabase.co/storage/v1/object/public/websites/sharma-optics/1739094866123/index.html",
  "html_size_bytes": 45678,
  "generated_at": "2026-02-09T08:14:26.123Z"
}
```

### POST /validate
Validates business input without running the pipeline.

### GET /health
Health check endpoint.

## Test with Mock Data
```bash
# Start server in one terminal
npm start

# In another terminal, run mock test
npm run test:mock
```

## Project Structure
```
src/
├── agents/
│   ├── architect.ts   # Architect Agent (generates website spec)
│   └── builder.ts     # Builder Agent (generates HTML)
├── schemas/
│   ├── business-input.ts    # Input validation
│   ├── architect-output.ts  # Agent contract
│   └── pipeline-result.ts   # Output schema
├── services/
│   ├── supabase.ts    # Storage upload
│   └── slugify.ts     # URL-safe slugs
├── pipeline/
│   └── orchestrator.ts # Main pipeline
├── bridge-server.ts   # Fastify API server
└── watcher.ts         # File watcher (legacy)
```

## License
ISC
