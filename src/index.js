const express = require('express');
const cheerio = require('cheerio');
const fs = require("node:fs/promises");
const path = require("node:path");
const { z } = require("zod");
const app = express();
const port = Number(process.env.PORT) || 3000;
const enrichRoute = require("./routes/enrich");


app.get("/", (req, res) => {
    res.send("Welcome to Scraper App");
});

const cacheDir = path.join(__dirname, "..", "cache");
const baseUrl = "https://books.toscrape.com/";
const userAgent = "FlyRankBot/1.0 (+https://flyrank.ai)";
const requestTimeoutMs = 8000;
const liveRequestDelayMs = 500;
const failedQueueUrl = "https://example.invalid/fake-detail-page";
let lastLiveRequestAt = 0;

const books = [];
const rawRecords = [];
const outputDir = path.join(__dirname, "..", "output");
const runStats = {
    start_time: new Date().toISOString(),
    duration_seconds: 0,
    pages_fetched: 0,
    cache_hits: 0,
    valid_records: 0,
    invalid_records: 0,
    failed_pages: 0
};

const rawRecordSchema = z.object({
    title: z.string().min(1, "title is required"),
    product_url: z.string().url("product_url must be a valid absolute URL"),
    price_text: z.string().min(1, "price_text is required"),
    availability_text: z.string().min(1, "availability_text is required"),
    rating_text: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    source_page: z.string().url("source_page must be a valid absolute URL"),
    fetched_at: z.string().datetime("fetched_at must be an ISO timestamp")
});

const normalizedBookSchema = z.object({
    id: z.string().url("id must be a valid absolute URL"),
    title: z.string().min(1, "title is required"),
    product_url: z.string().url("product_url must be a valid absolute URL"),
    price_text: z.string().min(1, "price_text is required"),
    price_gbp: z.number().finite("price_gbp must be a finite number"),
    availability_text: z.string().min(1, "availability_text is required"),
    rating_text: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    source_page: z.string().url("source_page must be a valid absolute URL"),
    fetched_at: z.string().datetime("fetched_at must be an ISO timestamp")
});

async function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeJsonFile(filePath, data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function checkRobotsTxt() {
    const robotUrl = `${baseUrl}robots.txt`;
    const response = await fetch(robotUrl, {
        headers: {
            "User-Agent": userAgent,
            Accept: "text/plain,*/*"
        }
    });

    if (response.status === 200) {
        const robotsTxt = await response.text();
        console.log(robotsTxt);
    } else if (response.status === 404) {
        console.log("no robots file found");
    } else {
        console.log(`Error: ${response.status}`);
    }
}

function buildDetailCacheFileName(url) {
    const pathname = new URL(url).pathname.replace(/^\/+/, "").replace(/\/$/, "");
    const fileStem = pathname.split("/").filter(Boolean).pop() || "index";
    return `${fileStem}.html`;
}

function isRetryableError(error) {
    if (!error) return false;
    if (error.name === "AbortError") return true;
    if (error.retryable === true) return true;
    if (error.status >= 500) return true;
    const message = String(error.message || "").toLowerCase();
    return message.includes("timeout") || message.includes("timed out") || message.includes("5") && message.includes("http");
}

async function fetchWithPoliteness(url, cacheFileName, { cacheEnabled = true, stats = runStats } = {}) {
    await fs.mkdir(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, cacheFileName);

    if (cacheEnabled) {
        try {
            const cachedHtml = await fs.readFile(cacheFile, "utf8");
            stats.cache_hits += 1;
            stats.pages_fetched += 1;
            return { html: cachedHtml, source: "cache", error: null };
        } catch {
            // Cache miss: fall through to live request.
        }
    }

    const now = Date.now();
    const elapsed = now - lastLiveRequestAt;
    if (elapsed < liveRequestDelayMs) {
        await delay(liveRequestDelayMs - elapsed);
    }

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            if (!/^https?:\/\//i.test(url)) {
                throw Object.assign(new Error(`Invalid URL: ${url}`), { status: 0, retryable: false });
            }

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

            try {
                const response = await fetch(url, {
                    headers: {
                        "User-Agent": userAgent,
                        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                    },
                    signal: controller.signal
                });

                if (response.status === 404 || response.status === 403) {
                    throw Object.assign(new Error(`HTTP ${response.status} for ${url}`), { status: response.status, retryable: false });
                }

                if (response.status >= 500 || response.status === 429) {
                    throw Object.assign(new Error(`HTTP ${response.status} for ${url}`), { status: response.status, retryable: true });
                }

                if (response.status !== 200) {
                    throw Object.assign(new Error(`HTTP ${response.status} for ${url}`), { status: response.status, retryable: false });
                }

                const html = await response.text();
                lastLiveRequestAt = Date.now();
                stats.pages_fetched += 1;

                if (cacheEnabled) {
                    await fs.writeFile(cacheFile, html, "utf8");
                }

                return { html, source: "live", error: null };
            } finally {
                clearTimeout(timer);
            }
        } catch (error) {
            const shouldRetry = isRetryableError(error) && attempt === 1;
            if (shouldRetry) {
                await delay(500);
                continue;
            }

            if (error && !(error.status === 404 || error.status === 403)) {
                stats.failed_pages += 1;
            }

            return { html: null, source: "error", error: error.message || String(error) };
        }
    }

    return { html: null, source: "error", error: "Unreachable" };
}

async function getCache(pageNum) {
    const pageUrl = `${baseUrl}catalogue/page-${pageNum}.html`;
    const cacheFileName = `catalogue-page-${pageNum}.html`;
    const result = await fetchWithPoliteness(pageUrl, cacheFileName, { stats: runStats });
    if (result.error) {
        throw new Error(result.error);
    }
    return result.html;
}

function dedupeBooks() {
    const seen = new Map();

    for (const book of books) {
        if (!seen.has(book.link)) {
            seen.set(book.link, book);
        }
    }

    return [...seen.values()];
}

async function extractRawBookRecords(detailQueue = []) {
    const queue = [...detailQueue];
    if (queue.length === 0) {
        const uniqueBooks = dedupeBooks();
        queue.push(...uniqueBooks.map((book) => book.link));
    }

    for (const detailUrl of queue) {
        try {
            const cacheFileName = buildDetailCacheFileName(detailUrl);
            const result = await fetchWithPoliteness(detailUrl, cacheFileName, { stats: runStats });

            if (result.error) {
                console.error(`Failed detail page: ${detailUrl} -> ${result.error}`);
                continue;
            }

            const $ = cheerio.load(result.html);

            // We scope the extraction to article.product_page so we do not grab generic page text,
            // navigation items, or unrelated repeated tags from the site shell.
            const product = $("article.product_page").first();

            // Title sits inside the product-main block; this is the canonical product heading.
            const title = product.find("div.product_main h1").first().text().trim();

            // The price and availability are specific to the product card layout on the book page.
            const priceText = product.find("p.price_color").first().text().trim();
            const availabilityText = product.find("p.availability").first().text().trim();

            // The star-rating class contains the rating label (e.g., "Three"), which is the product-specific indication.
            const ratingClass = product.find("p.star-rating").first().attr("class") || "";
            const ratingText = ratingClass
                .split(/\s+/)
                .find((cls) => cls !== "star-rating") || null;

            // The description follows the #product_description heading directly in the DOM.
            const description = product.find("#product_description + p").first().text().trim() || null;

            rawRecords.push({
                title,
                product_url: detailUrl,
                price_text: priceText,
                availability_text: availabilityText,
                rating_text: ratingText,
                description,
                source_page: product.find("meta[property='og:url']").attr("content") || detailUrl,
                fetched_at: new Date().toISOString()
            });
        } catch (error) {
            console.error(`Parsing failed for ${detailUrl}: ${error.message}`);
            runStats.failed_pages += 1;
        }
    }
}

function normalizePriceToGbp(priceText) {
    if (typeof priceText !== "string") {
        return Number.NaN;
    }

    const cleaned = priceText.replace(/[^0-9.\-]/g, "");
    const numericValue = Number.parseFloat(cleaned);
    return Number.isFinite(numericValue) ? numericValue : Number.NaN;
}

function dedupeByProductUrl(records) {
    const seen = new Map();

    for (const record of records) {
        const key = record.product_url;
        if (!seen.has(key)) {
            seen.set(key, record);
        }
    }

    return [...seen.values()];
}

async function validateAndNormalizeRawRecords(records) {
    const validRecords = [];
    const invalidRecords = [];

    for (const record of dedupeByProductUrl(records)) {
        const parsed = rawRecordSchema.safeParse(record);

        if (!parsed.success) {
            invalidRecords.push({
                record,
                error: parsed.error.issues.map((issue) => ({
                    path: issue.path.join("."),
                    message: issue.message
                }))
            });
            continue;
        }

        const price_gbp = normalizePriceToGbp(parsed.data.price_text);

        const normalized = {
            id: parsed.data.product_url,
            title: parsed.data.title,
            product_url: parsed.data.product_url,
            price_text: parsed.data.price_text,
            price_gbp,
            availability_text: parsed.data.availability_text,
            rating_text: parsed.data.rating_text ?? null,
            description: parsed.data.description ?? null,
            source_page: parsed.data.source_page,
            fetched_at: parsed.data.fetched_at
        };

        const normalizedCheck = normalizedBookSchema.safeParse(normalized);
        if (!normalizedCheck.success) {
            invalidRecords.push({
                record,
                error: normalizedCheck.error.issues.map((issue) => ({
                    path: issue.path.join("."),
                    message: issue.message
                }))
            });
            continue;
        }

        validRecords.push(normalizedCheck.data);
    }

    await writeJsonFile(path.join(outputDir, "books.json"), validRecords);
    await writeJsonFile(path.join(outputDir, "errors.json"), invalidRecords);

    return { validRecords, invalidRecords };
}

async function runStage4() {
    const { validRecords, invalidRecords } = await validateAndNormalizeRawRecords(rawRecords.slice());
    runStats.valid_records = validRecords.length;
    runStats.invalid_records = invalidRecords.length;

    if (validRecords.length !== 60) {
        console.log(`Stage 4 warning: expected 60 valid records, found ${validRecords.length}`);
    }

    const checkpoint = validRecords.length === 60 &&
        validRecords.every((record) => typeof record.price_gbp === "number") &&
        validRecords.every((record) => record.product_url.startsWith("https://"));

    console.log(`books.json valid count: ${validRecords.length}`);
    console.log(`errors.json invalid count: ${invalidRecords.length}`);
    console.log(`checkpoint_ok=${checkpoint}`);

    if (checkpoint) {
        console.log("Checkpoint verified: books.json has exactly 60 records, prices are numeric, and URLs start with https://");
    }
}

async function writeRunReport() {
    const durationMs = Date.now() - new Date(runStats.start_time).getTime();
    runStats.duration_seconds = Number((durationMs / 1000).toFixed(3));

    const report = {
        start_time: runStats.start_time,
        duration_seconds: runStats.duration_seconds,
        pages_fetched: runStats.pages_fetched,
        cache_hits: runStats.cache_hits,
        valid_records: runStats.valid_records,
        invalid_records: runStats.invalid_records,
        failed_pages: runStats.failed_pages
    };

    await writeJsonFile(path.join(outputDir, "run-report.json"), report);
    //console.log("Execution summary:");
    //console.log(JSON.stringify(report, null, 2));
    return report;
}

async function startApp() {
    const startTime = Date.now();
    runStats.start_time = new Date(startTime).toISOString();

    await checkRobotsTxt();

    for (let pageNum = 1; pageNum <= 3; pageNum++) {
        console.log(`scraping page ${pageNum}`);
        try {
            const html = await getCache(pageNum);
            //console.log(`HTML length for page ${pageNum}: `, html.length);
            const $ = cheerio.load(html);

            $("article.product_pod").each((index, book) => {
                const title = $("h3 a", book).text().trim();
                const price = Number($(".price_color", book).text().replace("£", "").trim());
                const availability = $(".availability", book).text().trim();
                const link = new URL($("h3 a", book).attr("href"), baseUrl).href;
                const sourcePage = `${baseUrl}catalogue/page-${pageNum}.html`;

                books.push({
                    title,
                    price,
                    availability,
                    link,
                    sourcePage
                });
            });
        } catch (error) {
            //console.error(`Catalogue page ${pageNum} failed: ${error.message}`);
            runStats.failed_pages += 1;
        }
    }

    const allDetailUrls = dedupeBooks().map((book) => book.link);
    const detailQueue = [...allDetailUrls, failedQueueUrl];

    await extractRawBookRecords(detailQueue);

    if (rawRecords.length > 0) {
        //console.log("Sample raw record:");
        //console.log(JSON.stringify(rawRecords[0], null, 2));
    }

    //console.log("detail_pages=60");
    await runStage4();
    await writeRunReport();

    const finalReport = await fs.readFile(path.join(outputDir, "run-report.json"), "utf8");
    const parsedReport = JSON.parse(finalReport);
    //console.log(`failed_pages=${parsedReport.failed_pages}`);
    //console.log(`valid_records=${parsedReport.valid_records}`);
    //console.log(`checkpoint=${parsedReport.valid_records === 60 && parsedReport.failed_pages === 1}`);
}



app.use(express.json());

app.get("/books", (req, res) => {
    const maxPrice = Number(req.query.maxPrice);
    const minPrice = Number(req.query.minPrice);
    let filteredBooks = books;

    if (req.query.maxPrice) {
        filteredBooks = filteredBooks.filter((book) => {
            return book.price <= maxPrice;
        });
    }

    if (req.query.minPrice) {
        filteredBooks = filteredBooks.filter((book) => {
            return book.price >= minPrice;
        });
    }

    if (req.query.availability) {
        filteredBooks = filteredBooks.filter((book) => {
            return book.availability === req.query.availability;
        });
    }

    const page = Number(req.query.page || 1);
    const start = (page - 1) * 10;
    const end = start + 10;
    const paginatedBooks = filteredBooks.slice(start, end);

    res.json(paginatedBooks);
});

app.use("/", enrichRoute)

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });

    startApp();
}

module.exports = { app, startApp };

