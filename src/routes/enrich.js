const router = require("express").Router();
const { z } = require("zod");
const { enrichRequestSchema } = require("../llm/schema");
const {
    FALLBACK_ENRICHMENT,
    STUB_ENRICHMENT,
    SHORT_CIRCUIT,
    enrichBook
} = require("../llm/client");

router.post("/enrich", async (req, res) => {
    const result = enrichRequestSchema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            error: "invalid input",
            field: z.treeifyError(result.error).properties
        });
    }

    const { title, description } = result.data;

    if (SHORT_CIRCUIT(title, description)) {
        return res.status(200).json(FALLBACK_ENRICHMENT);
    }

    if (process.env.LLM_STUB === "1") {
        return res.status(200).json(STUB_ENRICHMENT);
    }

    try {
        const enriched = await enrichBook(title, description);
        return res.status(200).json(enriched);
    } catch (error) {
        if (error?.status === 422) {
            return res.status(422).json({
                error: "unprocessable entity",
                message: error.message
            });
        }

        if (error?.status === 504) {
            return res.status(504).json({
                error: "gateway timeout",
                message: error.message
            });
        }

        return res.status(500).json({
            error: "internal server error",
            message: error?.message || "unknown error"
        });
    }
});

module.exports = router