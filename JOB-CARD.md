# Job card

**What it does (one sentence):**
Reads a scraped book's title and description and enriches it with a genre, audience, and one-sentence summary — for records the scraper cannot categorize on its own.

**Input:**
{
  "title": "string, 1-300 characters, required",
  "description": "string, 0-2000 characters, optional — may be null or empty"
}

**Output:**
{
  "genre": one of [fiction, non_fiction, poetry, mystery_thriller,
                    romance, childrens, history_biography, other],
  "audience": one of [children, young_adult, general, academic],
  "summary": "string, one short sentence, max ~150 characters",
  "confidence": 0.0-1.0,
  "needs_review": boolean
}

**It must never:**
- invent a genre or audience outside the two lists above
- fabricate plot details or facts not present in the description
- return free text outside the JSON object
- attempt a classification when description is null/empty — see fallback below

**When unsure it should:**
- If description is present but ambiguous or contradicts the title's apparent
  genre, return genre "other", confidence below 0.5, needs_review true.
- If description is null or under ~10 characters, skip the model call
  entirely (deterministic, no LLM spend) and return:
  { "genre": "other", "audience": "general",
    "summary": "No description available.",
    "confidence": 0.0, "needs_review": true }