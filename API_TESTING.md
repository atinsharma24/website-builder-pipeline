# Website Pipeline API - Testing Guide

Use this document to create requests in **Bruno**, **Postman**, or **HTTPie**.

## Base URL
`http://localhost:4000`

---

## 1. Full Automated Pipeline

Runs the complete flow: Architect (Gemini) → Builder (Gemini) → Upload (Supabase).

**Endpoint:** `POST /pipeline`

### Scenario A: Production Run (Real AI)
- **URL**: `http://localhost:4000/pipeline`
- **Body** (JSON): Use `test-input.json` content
```json
{
  "business_name": "Sharma Optics",
  "address": "123 MG Road",
  "city": "Indore",
  "state": "Madhya Pradesh",
  "owner_name": "Atin Sharma",
  "business_category": "optical",
  "description": "Premium optical store with 25 years of trusted service...",
  "photos": [],
  "phone": "+91 731 4001234",
  "email": "info@sharmaoptics.com"
}
```

### Scenario B: Mock Run (Test Logic Only)
- **URL**: `http://localhost:4000/pipeline?mock=true`
- **Query Params**:
  - `mock`: `true`
  - `skipUpload`: `true` (optional, to skip Supabase)

**HTTPie Command:**
```bash
http POST :4000/pipeline?mock=true < test-input.json
```

---

## 2. Antigravity Workflow (Architect Only)

Generates a task file for the AI Agent (Antigravity) to build the site.

**Endpoint:** `POST /architect`

### Scenario A: Generate Task (Real AI)
- **URL**: `http://localhost:4000/architect`
- **Body**: Same `test-input.json` structure

### Scenario B: Generate Mock Task (Save Quota)
- **URL**: `http://localhost:4000/architect?mock=true`

**HTTPie Command:**
```bash
http POST :4000/architect?mock=true < test-input.json
```

**Expected Response:**
```json
{
  "status": "pending_builder",
  "run_id": "run-1739...",
  "task_file": "tasks/run-1739....md",
  "next_step": "Generate index.html using the architect prompt..."
}
```

---

## 3. Manual Upload

Manually filters a generated HTML file to Supabase if auto-upload fails.

**Endpoint:** `POST /upload`

- **URL**: `http://localhost:4000/upload`
- **Query Params**:
  - `runId`: (get from previous response, e.g. `run-1739...`)
  - `slug`: (e.g. `sharma-optics`)

**HTTPie Command:**
```bash
http POST ":4000/upload?runId=run-123&slug=sharma-optics"
```

---

## 3.5. Builder-Only Retry

If a `/pipeline` run succeeded at the architect stage but failed at builder or upload, retry without re-running the architect. The `retryRunId` and `retrySlug` values come from the error response of the failed run.

**Endpoint:** `POST /pipeline/retry`

### Prerequisites
- A previous `/pipeline` run that failed at the builder phase
- The `run_id` and `business_slug` from that failed run

### Example Request
- **URL**: `http://localhost:4000/pipeline/retry?retryRunId=run-1770626564911&retrySlug=sharma-optics`
- **Body** (JSON): Same `test-input.json` content (used only for validation / slug generation)

**HTTPie Command:**
```bash
http POST ":4000/pipeline/retry?retryRunId=run-1770626564911&retrySlug=sharma-optics" < test-input.json
```

**With skipUpload (local test):**
```bash
http POST ":4000/pipeline/retry?retryRunId=run-1770626564911&retrySlug=sharma-optics&skipUpload=true" < test-input.json
```

### Expected Responses

**Success:**
```json
{
  "status": "success",
  "run_id": "run-1770...",
  "business_slug": "sharma-optics",
  "public_url": "https://...",
  "html_size_bytes": 45328,
  "generated_at": "2026-02-20T..."
}
```

**Failure (spec not found):**
```json
{
  "status": "error",
  "run_id": "run-1770...",
  "error_message": "Recovery failed: architect-spec.json not found for run run-INVALID",
  "error_phase": "architect"
}
```

---

## 4. Input Validation

Checks if your JSON is valid without running any AI.

**Endpoint:** `POST /validate`

- **URL**: `http://localhost:4000/validate`
- **Body**: `test-input.json`

**HTTPie Command:**
```bash
http POST :4000/validate < test-input.json
```

---

## 5. Health Check

Verifies server status and API key configuration.

**Endpoint:** `GET /health`

- **URL**: `http://localhost:4000/health`

**HTTPie Command:**
```bash
http GET :4000/health
```
