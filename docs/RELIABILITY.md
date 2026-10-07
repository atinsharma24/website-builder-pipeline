# Reliability and Safety Design

This document explains the layer that sits around the two agents: what it
guarantees, how, and what was traded away. Each section is a decision record.

```
request
  -> validate input (Zod)
  -> idempotency check ---- identical request already served? -> replay it
  -> Architect agent  -> LLM gateway (timeout, retry with backoff, failover)
        -> Zod validation of the spec, bounded repair
  -> Builder agent    -> LLM gateway
        -> deterministic HTML quality gate, bounded repair
  -> upload
  -> run record updated at every stage
```

## 1. LLM gateway: timeout, retry, failover

**Problem.** One provider call failing used to fail the whole request. Model
APIs rate limit, time out and have outages.

**Decision.** Every model call goes through `LlmGateway` (`src/llm/gateway.ts`).
For each provider in a configured chain it:

1. calls with a hard timeout (`AbortController` plus a race, so we stop waiting
   even if an SDK ignores the signal)
2. on a transient failure (429, 408, 409, 5xx, dropped connection, timeout,
   empty completion) waits and retries, up to `LLM_MAX_ATTEMPTS`
3. on a permanent failure (400, 401, 403, 404) skips straight to the next provider
4. when a provider is exhausted, fails over to the next one in the chain

Waits use exponential backoff with full jitter: a random time between 0 and
`base * 2^(attempt-1)`, capped. If the server sends `Retry-After`, that value
is used instead, also capped.

**Why jitter.** Clients that were rate limited together would otherwise retry
at the same instant and cause the next spike.

**Why the SDKs' own retries are disabled.** Two retry layers multiply. Three
gateway attempts over an SDK that retries twice is nine calls.

**Trade off.** Failover can change the output style mid pipeline, because a
different model writes the HTML. Accepted: a site from the second choice model
is better than no site.

## 2. Model output is untrusted

**Problem.** The Architect's JSON was cast to a type without checking. The
Builder's HTML was uploaded after a single warning about a missing doctype.

**Decision.**

- Architect output is parsed and validated against `ArchitectOutputSchema`.
  On failure the exact validation errors are sent back to the model, for at
  most `MAX_REPAIR_ATTEMPTS` rounds.
- Builder output must pass `validateHtml` (`src/quality/html-validator.ts`)
  before upload. Blocking checks: doctype, html, head, body and title present,
  the document ends with `</body></html>` (catches output cut off by a token
  limit), size within bounds, no leftover markdown fence, and external scripts
  only from an allow list of hosts. Non blocking warnings: viewport, meta
  description, placeholder text, images without alt text, missing sections.
- On a blocking failure the Builder is called again with the list of
  problems. If it still fails, the run ends with phase `quality` and nothing
  is published.

**Why plain code and not a second model as judge.** The checks are objective.
Code gives the same verdict every time, costs nothing, runs in a millisecond
and can be unit tested.

**Why string scanning and not an HTML parser.** These are coarse structural
gates on one generated file. A parser would repair broken markup silently,
which is the opposite of what a gate should do. The limit is that it cannot
reason about nesting.

**Why repair is bounded.** Each round is a full model call. An unbounded loop
can spend without limit on a prompt the model cannot satisfy.

## 3. Grounded content

**Problem.** The prompts told the models to invent a backstory and to add
three testimonials with made up names. Those pages are published for real
businesses, so that is fabricated social proof.

**Decision.** `BusinessInput` has an optional `testimonials` array. Prompts
quote those exactly and forbid inventing reviews, ratings, awards,
certifications or years in business. With no testimonials supplied, there is
no testimonials section.

## 4. Idempotent runs

**Problem.** A double click, a client retry or a proxy retry ran both agents
again and published a second copy of the same site.

**Decision.** After validation the input is serialised in canonical form
(object keys sorted at every depth) together with the run mode, and hashed
with SHA-256. That is the idempotency key. An optional `Idempotency-Key`
header is mixed in for callers that want to control it.

- A successful run younger than `IDEMPOTENCY_TTL_SECONDS` with the same key
  is returned as is, marked `idempotent_replay: true`.
- An identical request that arrives while the first is still running joins
  the first one's promise (single flight) instead of starting a second run.
- Failed runs are never replayed. `?force=true` and `/pipeline/retry` bypass
  the check.

**Why hash the validated input.** Defaults are applied first, so a missing
`photos` field and `photos: []` produce the same key.

**Trade off.** The single flight map lives in one process. With several server
instances two of them can still run the same request at the same time. Fixing
that needs a shared lock, for example a unique index on the key in Postgres.

## 5. Run records

Every run writes a record (`src/runs/run-store.ts`) with its stage, the time
spent in each stage, every LLM attempt with provider, outcome and duration,
the number of repairs and the final result. `GET /runs/:runId` returns it.

`RunStore` is an interface. `FileRunStore` writes one JSON file per run using
write to a temp file then rename, which is atomic, so a crash never leaves a
half written record. A Postgres implementation is the next step for more than
one instance.

## 6. Path safety and authentication

**Problem.** `/upload` and `/pipeline/retry` joined `slug` and `runId` from
the query string into file paths with no checks. A value such as `../..`
reached files outside the output directory, and `/upload` would then publish
what it read.

**Decision.** Both values must match strict patterns, and the joined path is
checked to still be inside the output directory. Hand built HTML uploaded
through `/upload` or the watcher also goes through the quality gate.

When `PIPELINE_API_KEY` is set, every route except `/health` requires it in
`x-api-key`. The comparison hashes both sides and uses `timingSafeEqual`.

## 7. Errors as values, dependencies as arguments

Stages return `Result<T, PipelineError>` instead of throwing. An error carries
a stable `code`, the `phase` it happened in and whether it is `retryable`. The
HTTP layer maps phases to statuses: 400 for bad input, 422 when we refuse to
publish our own output, 502 when a provider or storage failed.

The orchestrator receives its LLM clients, store, uploader, clock and id
generator as arguments. That is why the test suite runs with no network, no
API key and no Supabase project.

## What is not done

- Real provider calls are type checked but were not exercised against live
  APIs in this change. Mock mode and unit tests cover the orchestration.
- No queue. `/pipeline` still holds the HTTP request open while the models run.
- No per provider circuit breaker. A provider that is down is still tried
  first on every request.
- No rate limiting per caller.
- Run records live on one machine's disk.
