require("dotenv").config();
const { enrichBookMetadataSchema } = require("./schema");
const fs = require("node:fs/promises");
const path = require("node:path");
const promptPath = path.join(__dirname, "..", "..", "src", "prompts", "enrich-v1.md");

const { OpenAI } = require("openai");

const Client = new OpenAI({
    baseURL: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    timeout: 30000,
    maxRetries: 0
});

async function loadPrompt() {
    try {
        const prompt = await fs.readFile(promptPath, "utf-8");
        return prompt;
    } catch (err) {
        console.log(err);
        throw err;
    }
}

const FALLBACK_ENRICHMENT = {
    genre: "other",
    audience: "general",
    summary: "No description available",
    confidence: 0.0,
    needs_review: true
};

const STUB_ENRICHMENT = {
    genre: "fiction",
    audience: "general",
    summary: "A gripping story of survival and redemption.",
    confidence: 0.92,
    needs_review: false,
};

function SHORT_CIRCUIT(title, description) {
    if (description === null || description === undefined) {
        return true;
    }
    if (description.trim().length < 10) {
        return true;
    }
    return false;
}

async function callModelWithRetry(messages, modelName, maxRetries = 3) {
    let delayMs = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        const startTime = Date.now();

        try {
            const response = await Client.chat.completions.create({
                model: modelName,
                messages,
                temperature: 0,
            });

            const durationMs = Date.now() - startTime;
            const promptTokens = response.usage?.prompt_tokens ?? 0;
            const completionTokens = response.usage?.completion_tokens ?? 0;

            console.log(JSON.stringify({
                duration_ms: durationMs,
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens
            }));

            return response;
        } catch (err) {
            const status = err?.status ?? err?.response?.status;

            if (status === 400 || status === 401 || status === 403) {
                throw err;
            }

            if (status === 429 || status >= 500 || status === undefined) {
                if (attempt >= maxRetries) {
                    const timeoutError = new Error(`LLM request failed after ${maxRetries} attempts`);
                    timeoutError.status = 504;
                    throw timeoutError;
                }

                const jitterMs = Math.floor(Math.random() * 250);
                const waitMs = delayMs + jitterMs;
                console.warn(`Transient LLM error (${status ?? "network"}). Retrying in ${waitMs}ms...`);
                await new Promise((resolve) => setTimeout(resolve, waitMs));
                delayMs *= 2;
                continue;
            }

            throw err;
        }
    }

    const finalError = new Error("LLM request failed after retries");
    finalError.status = 504;
    throw finalError;
}

function parseAndValidateModelOutput(rawData) {
    if (typeof rawData !== "string") {
        throw new Error("Empty model response");
    }

    const cleanedData = rawData
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    let parsedJson;
    try {
        parsedJson = JSON.parse(cleanedData);
    } catch (parseError) {
        const parsedError = new Error(`JSON parse failed: ${parseError.message}`);
        parsedError.status = 422;
        throw parsedError;
    }

    const validated = enrichBookMetadataSchema.safeParse(parsedJson);

    if (!validated.success) {
        const validationError = new Error(validated.error.issues.map((issue) => issue.message).join("; "));
        validationError.status = 422;
        throw validationError;
    }

    return validated.data;
}

async function enrichBook(title, description) {
    if (process.env.LLM_ENABLED === "false") {
        return FALLBACK_ENRICHMENT;
    }

    if (SHORT_CIRCUIT(title, description)) {
        return FALLBACK_ENRICHMENT;
    }

    if (process.env.LLM_STUB === "1") {
        return STUB_ENRICHMENT;
    }

    const prompt = await loadPrompt();
    const baseMessages = [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify({ title, description }) }
    ];

    let rawData = "";

    try {
        const modelResponse = await callModelWithRetry(baseMessages, process.env.LLM_MODEL);
        rawData = modelResponse.choices[0]?.message?.content ?? "";
        return parseAndValidateModelOutput(rawData);
    } catch (firstError) {
        const errorMessage = firstError?.message || String(firstError);
        const repairMessages = [
            ...baseMessages,
            {
                role: "user",
                content: `Your response failed validation: ${errorMessage}. Return ONLY valid JSON adhering to the schema. Previous bad output: ${rawData}`
            }
        ];

        try {
            const repairResponse = await callModelWithRetry(repairMessages, process.env.LLM_MODEL);
            const repairText = repairResponse.choices[0]?.message?.content ?? "";
            const repairedData = parseAndValidateModelOutput(repairText);
            return repairedData;
        } catch (repairError) {
            const quarantineEntry = {
                timestamp: new Date().toISOString(),
                title,
                description,
                rawData,
                error: repairError?.message || String(repairError)
            };

            const quarantinePath = path.join(__dirname, "..", "..", "logs", "quarantine.jsonl");
            await fs.mkdir(path.dirname(quarantinePath), { recursive: true });
            await fs.appendFile(quarantinePath, `${JSON.stringify(quarantineEntry)}\n`, "utf8");

            const wrappedError = new Error("Model output failed validation after repair attempt");
            wrappedError.status = 422;
            throw wrappedError;
        }
    }
}

module.exports = {
    FALLBACK_ENRICHMENT,
    STUB_ENRICHMENT,
    SHORT_CIRCUIT,
    enrichBook,
    loadPrompt,
    callModelWithRetry,
    parseAndValidateModelOutput
};