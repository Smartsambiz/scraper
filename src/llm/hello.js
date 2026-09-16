require("dotenv").config();
const {OpenAI} = require("openai");



const client  = new OpenAI({
    baseURL: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    
});

const responds = async()=> {
    const res = await client.chat.completions.create({
        model: process.env.LLM_MODEL, // "openrouter/free" or "gemma3:1b"
        messages: [{ role: "user", content: "Reply with exactly the word: ready" }],
    });

    console.log(res.choices[0].message.content);
}


responds();
