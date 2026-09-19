# Scraper + Book Metadata Enrichment API

## What the endpoint does

`POST /enrich` takes a book's title and short description and returns a small, structured guess about what kind of book it is: a genre, who it is for, a one-sentence summary, a confidence score, and a flag saying whether a human should double-check it. It is built for a bookstore's messy catalogue, where a scraper can read a title and blurb but cannot reliably decide on its own whether a book is fiction, a memoir, poetry, and so on. The endpoint first validates the request, then answers instantly with a safe "unknown" for empty descriptions (no AI call, no cost), and only asks an AI model when there is real text to classify. If the model returns something malformed, the service tries once to repair it, and if that still fails it saves the bad output for review instead of guessing.

---

## Try it (copy-paste)

With the server running (see Quick Start below), this exact request:

```bash
curl -i -X POST http://localhost:3000/enrich \
   -H "Content-Type: application/json" \
   -d '{"title":"The Hobbit","description":"A quiet hobbit named Bilbo Baggins goes on an unexpected quest to a distant mountain."}'
```

produces this exact response (`LLM_STUB=1` in `.env.example`, so it is reproducible without spending model calls):

```http
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 136
ETag: W/"88-I544Y8WOexyGNYJb8EDrD8zp4r0"
Date: Sat, 19 Sep 2026 10:46:40 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"genre":"fiction","audience":"general","summary":"A gripping story of survival and redemption.","confidence":0.92,"needs_review":false}
```

Set `LLM_STUB=0` to route the same request through a real model instead.

---

## Job card

**What it does (one sentence):**
Reads a scraped book's title and description and enriches it with a genre, audience, and one-sentence summary — for records the scraper cannot categorize on its own.

**Input:**
```json
{
  "title": "string, 1-300 characters, required",
  "description": "string, 0-2000 characters, optional — may be null or empty"
}
```

**Output:**
```json
{
  "genre": "one of [fiction, non_fiction, poetry, mystery_thriller, romance, childrens, history_biography, other]",
  "audience": "one of [children, young_adult, general, academic]",
  "summary": "string, one short sentence, max ~150 characters",
  "confidence": 0.0,
  "needs_review": true
}
```

**It must never:**
- invent a genre or audience outside the two lists above
- fabricate plot details or facts not present in the description
- return free text outside the JSON object
- attempt a classification when description is null/empty — see fallback below

**When unsure it should:**
- If description is present but ambiguous or contradicts the title's apparent genre, return genre `"other"`, confidence below 0.5, needs_review true.
- If description is null or under ~10 characters, skip the model call entirely (deterministic, no LLM spend) and return:
  `{ "genre": "other", "audience": "general", "summary": "No description available.", "confidence": 0.0, "needs_review": true }`

---

## Provider, model, and swapping

- **Provider:** OpenRouter (`https://openrouter.ai/api/v1`)
- **Model:** `openrouter/free` (the "Free Models Router", which routes each request to a free upstream model — for example `inclusionai/ling-3.0-flash-fin:free` — at $0 token cost)

To point the service at any OpenAI-compatible provider, change these three environment variables in `.env`:

```bash
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=your_key_here
LLM_MODEL=openrouter/free
```

---

## Eval result

- **Date:** 2026-09-19
- **Prompt version:** `enrich-v2` (`src/prompts/enrich-v2.md`)
- **Key field:** `genre`
- **Result:** **8 out of 8 (100%)**, reproduced on two consecutive runs
- **Method:** `node evals/run-eval.js` runs all 8 cases through the real `POST /enrich` endpoint over HTTP, with `DISABLE_DETERMINISTIC=1` so the model (not the code shortcuts) does the classifying.

The eval set (`evals/cases.json`) deliberately includes a clear case for each supported genre, one **ambiguous** case ("Observations" — too vague to classify), and one **when-unsure** case (an empty description that must hit the deterministic fallback with no model call). Machine-readable output is written to `evals/results.json`.

```
Matched: 8/8
Accuracy (genre): 100.00%
Failed cases: none
```

---

## Cost log (one real call)

The app logs one JSON line per model call. From the first eval run, classifying "The Hidden Orchard":

```json
{"duration_ms":5463,"prompt_tokens":923,"completion_tokens":122}
```

At OpenRouter free-tier pricing (`openrouter/free` reports $0 for both prompt and completion), this call cost **$0.00**.

**Estimate for 10,000 requests/day:** token cost is **$0.00 on the free router**, but the free tier is rate-limited (roughly 50 requests/day), so 10,000/day would require paid routing or a funded account — at a typical paid rate of ~$0.10/1M input and ~$0.40/1M output tokens, ~1,045 tokens per call works out to roughly **$0.15/day** ($4.50/month) for 10,000 calls.

---

## What I'd fix with another day

The deterministic classifier in `src/llm/client.js` overlaps with the prompt and can silently mask model regressions, so I would remove it (or gate it to obvious cases only) and grow the eval set past 8 cases before trusting the score.

---

## Quick Start

### Requirements
- Node.js 18+ (uses the built-in `fetch`)
- npm

### Install
```bash
npm install
```

### Configure
Copy `.env.example` to `.env` and fill in your provider details. `.env` is gitignored and must never be committed.

### Run (scraper + API server)
```bash
npm start
```

The server listens on port 3000 (override with `PORT`) and exposes:

- `GET /` — welcome message
- `GET /books` — scraped catalogue records with optional `maxPrice`, `minPrice`, `availability`, and `page` query filters
- `POST /enrich` — book metadata enrichment

### Run the eval
```bash
node evals/run-eval.js
```

---

## Enrichment flow

`POST /enrich` processes input in this order (`src/routes/enrich.js`, `src/llm/client.js`):

1. **Validate input** against `enrichRequestSchema` (`src/llm/schema.js`): `title` 1–300 chars, `description` optional/nullable up to 2000 chars. Invalid input returns `400`.
2. **Short-circuit** when the description is missing or under ~10 characters — returns the deterministic fallback (`other` / `general` / `needs_review: true`) with no model spend.
3. **Stub mode** when `LLM_STUB=1` — returns fixed mock metadata with no network call.
4. **Deterministic classification** for obvious signals (non-fiction, biography, romance, poetry, fiction) and for prompt-injection or contradictory input. Skipped when `DISABLE_DETERMINISTIC=1`.
5. **Model call** using the versioned prompt `src/prompts/enrich-v2.md`, with timeout, exponential backoff, and jittered retries for transient errors (429/5xx/network). Hard failures fail fast.
6. **Parse + validate** the response against `enrichBookMetadataSchema`; strip stray markdown fences before parsing.
7. **Repair once** if validation fails, then **quarantine** the entry to `logs/quarantine.jsonl` and return `422` if it still fails.

Response codes: `400` invalid input, `200` success, `422` unprocessable model output, `504` model timeout after retries, `500` unexpected error. Token usage and latency are logged as JSON per model call.

Runtime flags:

| Variable | Effect |
| --- | --- |
| `LLM_STUB=1` | Return fixed mock metadata; no model call. |
| `LLM_ENABLED=false` | Kill switch: return the fallback without any model call. |
| `DISABLE_DETERMINISTIC=1` | Skip deterministic classification and always use the model. |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | Provider connection details. |

---

## Project Structure

- `src/index.js` — scraper pipeline, extraction, validation, output writing, API server
- `src/routes/enrich.js` — `POST /enrich` route, validation, and error mapping
- `src/llm/client.js` — enrichment orchestration, retries, parsing, repair, quarantine
- `src/llm/schema.js` — Zod schemas for the enrichment request and output
- `src/llm/hello.js` — provider connectivity smoke test
- `src/prompts/enrich-v2.md` — current versioned enrichment prompt
- `src/prompts/enrich-v1.md` — earlier prompt version (kept for comparison)
- `evals/run-eval.js` — evaluation runner (hits the HTTP endpoint)
- `evals/cases.json` — evaluation test cases
- `evals/results.json` — machine-readable eval output
- `cache/` — local HTML cache for catalogue and detail pages
- `output/books.json` — validated normalized records
- `output/errors.json` — invalid records with validation errors
- `output/run-report.json` — execution summary for each run
- `logs/quarantine.jsonl` — failed model outputs awaiting review (gitignored)

---

## Target Classification (scraper)

1. Site: Books to Scrape — https://books.toscrape.com/
2. Why: public practice sandbox designed for learning and testing scraping techniques ethically and safely.
3. Scope: the first 3 catalogue pages only, covering the first 60 books in the dataset.
4. Data collected: 60 book records including title, product URL, price, availability, rating, description, source page, and fetch timestamp.
5. Why appropriate: intentionally designed sandbox that allows experimentation without affecting a production site.
6. robots.txt result: no robots file was found at the site root.
7. Ethical rule: I will not reuse this code on another site without checking its rules and terms first.

---

## Data Schema

Each record in `output/books.json` follows this structure:

```json
{
  "id": "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
  "title": "A Light in the Attic",
  "product_url": "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
  "price_text": "£51.77",
  "price_gbp": 51.77,
  "availability_text": "In stock (22 available)",
  "rating_text": "Three",
  "description": "A classic collection of poetry and drawings...",
  "source_page": "https://books.toscrape.com/catalogue/page-1.html",
  "fetched_at": "2026-08-18T11:04:40.282Z"
}
```

Notes:
- `id` is set to the canonical absolute product URL.
- `price_text` preserves the original display string.
- `price_gbp` is the normalized numeric float in GBP.
- `description` is nullable and remains null if the page does not provide text.

---

## Politeness Rules

- User-Agent header is included in all live requests, using a clear bot identifier such as `FlyRankBot/1.0 (+https://flyrank.ai)`.
- A minimum 500ms delay is enforced between live requests to reduce server pressure.
- Request timeouts are limited to 8 seconds to avoid hanging connections.
- Local caching is used so repeated runs re-use previously fetched HTML when available.
- Retry logic is limited to timeout or server-error conditions (5xx) and does not retry 404 or 403 responses.
- The scraper avoids unnecessary repeated requests and keeps data collection minimal.

---

## Sample Proof

Example `output/run-report.json`:

```json
{
  "start_time": "2026-09-19T09:55:41.899Z",
  "duration_seconds": 1.608,
  "pages_fetched": 63,
  "cache_hits": 63,
  "valid_records": 60,
  "invalid_records": 0,
  "failed_pages": 1
}
```

No browser automation (Playwright/Puppeteer) was needed because the required product data was already present in the initial HTML response, so a direct HTML fetch and parse approach was sufficient.

---

## Ethics Note

Responsible scraping means preferring official APIs when available, checking site terms and robots policies before collecting data, limiting scope to the minimum required, and avoiding unnecessary traffic or misuse of the target site.

---

## License

This project is for educational and internship-learning purposes only.
