const fs = require("node:fs/promises");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

process.env.LLM_STUB = "0";
process.env.LLM_ENABLED = "true";
process.env.DISABLE_DETERMINISTIC = "1";

const { app } = require("../src/index");

const PROMPT_VERSION = "enrich-v2";
const KEY_FIELD = "genre";

async function runCases(baseUrl, cases) {
  const results = [];
  let matched = 0;

  for (const [index, testCase] of cases.entries()) {
    const { id, title, description, expected_genre, note } = testCase;
    const payload = { title };
    if (description !== undefined) {
      payload.description = description;
    }

    let actualGenre = null;
    let status = null;
    let error = null;
    let body = null;

    try {
      const response = await fetch(`${baseUrl}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      status = response.status;
      body = await response.json();

      if (status === 200) {
        actualGenre = body[KEY_FIELD] ?? null;
      } else {
        error = body.message || body.error || `HTTP ${status}`;
      }
    } catch (err) {
      error = err.message;
    }

    const passed = actualGenre === expected_genre;
    if (passed) {
      matched += 1;
    }

    results.push({
      index: index + 1,
      id,
      title,
      note,
      expected_genre,
      actual_genre: actualGenre,
      status,
      passed,
      error
    });
  }

  return { results, matched };
}

function printReport(results, matched, total) {
  console.log("Evaluation Report");
  console.log("-----------------");

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(
      `${status} | Case ${result.index} (${result.id}) | expected: ${result.expected_genre} | actual: ${result.actual_genre}`
    );
    if (result.error) {
      console.log(`       error: ${result.error}`);
    }
  }

  const failed = results.filter((result) => !result.passed);
  const accuracy = (matched / total) * 100;

  console.log("-----------------");
  console.log(`Matched: ${matched}/${total}`);
  console.log(`Accuracy (${KEY_FIELD}): ${accuracy.toFixed(2)}%`);

  if (failed.length > 0) {
    console.log("Failed cases:");
    for (const result of failed) {
      console.log(
        `  - ${result.id}: expected ${result.expected_genre}, got ${result.actual_genre}${result.error ? ` (${result.error})` : ""}`
      );
    }
  } else {
    console.log("Failed cases: none");
  }
}

async function main() {
  const casesPath = path.join(__dirname, "cases.json");
  const cases = JSON.parse(await fs.readFile(casesPath, "utf8"));

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let summary;
  try {
    summary = await runCases(baseUrl, cases);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const { results, matched } = summary;
  printReport(results, matched, cases.length);

  const report = {
    run_at: new Date().toISOString(),
    prompt_version: PROMPT_VERSION,
    key_field: KEY_FIELD,
    matched,
    total: cases.length,
    accuracy_percent: Number(((matched / cases.length) * 100).toFixed(2)),
    results
  };

  await fs.writeFile(
    path.join(__dirname, "results.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log("-----------------");
  console.log("Wrote evals/results.json");
}

main().catch((error) => {
  console.error("Evaluation failed:", error);
  process.exitCode = 1;
});
