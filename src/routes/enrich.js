const router = require("express").Router();
const {enrichRequestSchema, enrichBookMetadataSchema } = require("../llm/schema");
const {FALLBACK_ENRICHMENT,
    STUB_ENRICHMENT,
    SHORT_CIRCUIT} = require("../llm/client");

router.post("/enrich", (req, res)=>{
    const result = enrichRequestSchema.safeParse(req.body);

    if(!result.success){
        return res.status(400).json({
            error: "invalid input",
            field: result.error.treeifyError().fieldErrors
            
        })
    }

    const {title, description } = result.data;
    

    if(process.env.LLM_STUB === "1"){
        return res.status(200).json(STUB_ENRICHMENT)
    }
    if(SHORT_CIRCUIT(title, description)){
        return res.status(200).json(FALLBACK_ENRICHMENT);
    };

    return res.status(200).json({
        message: "LLM execustion placeholder"
    })
    
});

module.exports = router