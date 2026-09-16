const {enrichRequestSchema, enrichBookMetadataSchema } = require("./schema");

const FALLBACK_ENRICHMENT = {
    genre: "other",
    audience: "general",
    summary: "No description available",
    confidence: 0.0,
    needs_review: true
}

const STUB_ENRICHMENT = {
  genre: "fiction",
  audience: "general",
  summary: "A gripping story of survival and redemption.",
  confidence: 0.92,
  needs_review: false,
};

function SHORT_CIRCUIT(title, description){
    if(description === null || description.trim().length < 10 || description=== undefined ){
        return true;
    }
    return false;
}

module.exports={
    FALLBACK_ENRICHMENT,
    STUB_ENRICHMENT,
    SHORT_CIRCUIT
}