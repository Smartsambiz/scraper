const {z} = require("zod");


const enrichRequestSchema =z.object({
    title: z.string().trim().min(1, "title is required").max(300, "title must be 300 characters"),

    description: z.string().max(2000, "description must be 2000 characters").nullable().optional(),

}) ;

const enrichBookMetadataSchema = z.object({
    genre: z.enum(["fiction", "non_fiction", "poetry", "mystery_thriller", "romance", "childrens", "history_biography", "other"]),

    audience: z.enum(["children", "young_adult", "general", "academic"]),
    summary: z.string().max(150, "summary requires 150 characters maximum"),

    confidence: z.float64().min(0.0).max(1.0),

    needs_review: z.boolean()
});

module.exports = {
    enrichRequestSchema,
    enrichBookMetadataSchema
}
