# Polite Scraper for Books to Scrape

## Target Classification
1. Site:
   Books to Scrape — https://books.toscrape.com/

2. Why:
   This is a public practice sandbox designed specifically for learning and testing scraping techniques ethically and safely.

3. Scope:
   The first 3 catalogue pages only, covering the first 60 books in the dataset.

4. Data collected:
   60 book records including title, product URL, price, availability, rating, description, source page, and fetch timestamp.

5. Why appropriate:
   It is an intentionally designed sandbox that allows experimentation without affecting a production site.

6. robots.txt result:
   No robots file was found at the site root.

7. Ethical rule:
   I will not reuse this code on another site without checking its rules and terms first.

---

## Quick Start

### Install dependencies
npm install

### Run the scraper
node src/index.js

### Requirements
- Node.js 18+
- npm

### Enrichment endpoint

Start the application with the model stub enabled:

```bash
$env:LLM_STUB="1"; node src/index.js
```

Valid request:

```bash
curl -i -X POST http://localhost:3000/enrich \
   -H "Content-Type: application/json" \
   -d '{"title":"The Hobbit","description":"A quiet hobbit named Bilbo Baggins goes on an unexpected quest to a distant mountain."}'
```

This returns `200 OK` with mock metadata matching the enrichment schema, for example:

```json
{
   "genre": "fiction",
   "audience": "general",
   "summary": "A gripping story of survival and redemption.",
   "confidence": 0.92,
   "needs_review": false
}
```

Invalid request:

```bash
curl -i -X POST http://localhost:3000/enrich \
   -H "Content-Type: application/json" \
   -d '{"title":123,"description":"A quiet hobbit named Bilbo Baggins goes on an unexpected quest to a distant mountain."}'
```

This returns `400 Bad Request` and identifies `title` as invalid. Validation happens before enrichment, so the invalid request does not make a model network call.

---

## Project Structure

- src/index.js — scraper pipeline, extraction, validation, output writing, and reporting
- cache/ — local HTML cache for catalogue and detail pages
- output/books.json — validated normalized records
- output/errors.json — invalid records with validation errors
- output/run-report.json — execution summary for each run

---

## Data Schema

Each record in output/books.json follows this structure:

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

This scraper follows a responsible and polite pattern:

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
  "start_time": "2026-08-18T11:04:39.063Z",
  "duration_seconds": 1.989,
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