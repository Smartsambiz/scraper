const fs = require("node:fs/promises");
const path = require("node:path");
const { enrichBook } = require("../src/llm/client");

async function main() {
  const casesPath = path.join(__dirname, "cases.json");
  const cases = JSON.parse(await fs.readFile(casesPath, "utf8"));

  let passed = 0;
  const results = [];

  for (const [index, testCase] of cases.entries()) {
    const { title, description, expected_genre } = testCase;

    try {
      const result = await enrichBook(title, description);
      const actualGenre = result.genre;
      const passedCase = actualGenre === expected_genre;

      if (passedCase) {
        passed += 1;
      }

      results.push({
        index: index + 1,
        title,
        expected_genre,
        actual_genre: actualGenre,
        passed: passedCase
      });
    } catch (error) {
      results.push({
        index: index + 1,
        title,
        expected_genre,
        actual_genre: "error",
        passed: false,
        error: error.message
      });
    }
  }

  console.log("Evaluation Report");
  console.log("-----------------");

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`${status} | Case ${result.index} | expected: ${result.expected_genre} | actual: ${result.actual_genre}`);
    if (result.error) {
      console.log(`       error: ${result.error}`);
    }
  }

  const accuracy = (passed / cases.length) * 100;
  console.log("-----------------");
  console.log(`Total passed: ${passed}/${cases.length}`);
  console.log(`Accuracy: ${accuracy.toFixed(2)}%`);
}

main().catch((error) => {
  console.error("Evaluation failed:", error);
  process.exitCode = 1;
});
