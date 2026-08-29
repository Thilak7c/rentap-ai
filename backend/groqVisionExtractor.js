// backend-pipeline/groqVisionExtractor.js

/**
 * Groq Vision Extraction
 * ---------------------------------
 * Sends rasterized PDF page images to Groq's vision model and asks it to
 * return structured financial-report data as JSON.
 *
 * IMPORTANT — TESTING STATUS: the HTTP call to Groq itself has NOT been
 * tested against the live API in this environment. This sandbox has no
 * network access to api.groq.com (not in the allowed domain list) and no
 * Groq API key. Everything up to and including request construction has
 * been written carefully and follows Groq's documented chat-completions
 * vision format, and the retry/resilience logic is unit-tested against a
 * mocked HTTP layer (see test.js) — but the actual live call needs to be
 * verified against the real API with a real key before Challenge Day,
 * ideally as one of the first things tested when the build window opens
 * (per the hackathon tips doc: "prototype the riskiest technology
 * first").
 *
 * Resilience patterns below reuse what the practice build already proved
 * out: resize-first (send a reasonably sized image rather than raw
 * high-DPI), and reactive retry with backoff on rate-limit responses —
 * see Dev League Hackathon Super Docs.md Section 5 for the source of
 * this pattern.
 *
 * PERFORMANCE (changed): extractFromImages() previously processed pages
 * SEQUENTIALLY (await in a for-loop) — for a multi-page scanned PDF this
 * meant N full Groq round-trips stacked one after another, which is the
 * primary cause of the ~2 minute end-to-end time reported for 2-5 page
 * documents. Pages are now fetched CONCURRENTLY via Promise.all. Existing
 * per-call retry/backoff (callGroqWithRetry) is untouched and still
 * handles individual 429s — concurrent calls that hit a rate limit just
 * retry independently, same as before. Row ordering across pages is
 * preserved by page index, not by call-completion order.
 *
 * SIGNATURE CHANGE: extractFromImages(pageImages, apiKey, fetchImpl) is
 * now extractFromImages(pageImages, apiKey, options). options may contain
 * { fetchImpl, onProgress, totalPages }. This was necessary because
 * visionFallback.js now calls this with an options object for progress
 * reporting — the old positional fetchImpl arg would have silently broken
 * (options object passed where fetchImpl was expected). ANY EXISTING TEST
 * CALLING extractFromImages(pageImages, apiKey, mockFetch) DIRECTLY NEEDS
 * TO UPDATE TO extractFromImages(pageImages, apiKey, { fetchImpl: mockFetch })
 * — flagging this so test.js gets fixed alongside this file, not after a
 * confusing test failure.
 */

const MODEL = "qwen/qwen3.6-27b"; // per Super Docs — same model as the practice build
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

const EXTRACTION_PROMPT = `You are reading a scanned financial report image. Extract every line item you can find, AND capture any free-text content that is not a line item (such as prepared-by/approved-by lines, signatures, names, ID numbers, emails, or notes sections).

Respond with ONLY a single JSON object, no explanation, no markdown code fences, in this exact shape:
{
  "rows": [ { "category": string, "period": string (if visible), "amount": number (no currency symbols/commas), "vendor": string (if visible) } ],
  "notes": string
}

"rows" should contain every tabular line item you can find. "notes" should contain the verbatim text of anything else on the page that is not part of the table — such as a Notes section, prepared-by/approved-by lines, or any names/IDs/contact info — as plain text, one item per line. If there are no line items, "rows" should be []. If there is no non-tabular text, "notes" should be "".`;

class GroqRateLimitError extends Error {
  constructor(retryAfterMs) {
    super("Groq API rate limit exceeded");
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Calls the Groq API once. Isolated into its own function so it can be
 * swapped for a mock in tests without touching the retry logic around it.
 */
async function callGroqOnce(imageBase64, apiKey, fetchImpl = fetch) {
  const response = await fetchImpl(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_PROMPT },
            { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0, // deterministic extraction, not creative generation
      reasoning_format: "hidden", // suppress the model's <think>...</think> preamble — we only want the final JSON answer, not its reasoning trace
    }),
  });

  if (response.status === 429) {
    // Groq returns rate-limit info in headers; fall back to a default
    // backoff if the header isn't present rather than crashing on a
    // missing/malformed header.
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : BASE_BACKOFF_MS;
    throw new GroqRateLimitError(retryAfterMs);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Groq API error (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Groq API returned an empty response");
  }
  return content;
}

/**
 * Calls Groq with retry + exponential backoff on rate limits. This is the
 * "reactive retry" pattern documented from the practice build — react to
 * an actual 429, back off, try again, rather than pre-emptively
 * throttling every request.
 */
async function callGroqWithRetry(imageBase64, apiKey, fetchImpl = fetch) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await callGroqOnce(imageBase64, apiKey, fetchImpl);
    } catch (err) {
      lastError = err;
      if (err instanceof GroqRateLimitError) {
        const backoff = err.retryAfterMs || BASE_BACKOFF_MS * 2 ** attempt;
        await sleep(backoff);
        continue;
      }
      throw err; // non-rate-limit errors fail immediately, no point retrying a bad request
    }
  }
  throw lastError;
}

/**
 * Parses the model's JSON response into normalized row objects, matching
 * the same shape documentParser.js produces — so downstream code
 * (PII masking, anomaly detection) doesn't need to know which extraction
 * path was used.
 */
function parseModelResponse(rawContent) {
  // Models sometimes wrap JSON in markdown fences despite instructions —
  // strip defensively rather than trusting the prompt alone.
  let cleaned = rawContent.replace(/```json|```/g, "").trim();

  // Reasoning-capable models (like qwen3.6) can emit an internal
  // <think>...</think> trace before the actual answer, even when told
  // not to explain — reasoning_format: "hidden" in the API request
  // should suppress this, but strip it defensively here too in case
  // that isn't honored for a given model/response.
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    // Last resort: the model may have still included stray prose around
    // the object/array. Try extracting the first {...} or [...] block
    // directly rather than failing the whole page's extraction outright.
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    const candidate = objectMatch ? objectMatch[0] : arrayMatch ? arrayMatch[0] : null;
    if (candidate) {
      try {
        parsed = JSON.parse(candidate);
      } catch {
        throw new Error(`Could not parse Groq response as JSON: ${err.message}`);
      }
    } else {
      throw new Error(`Could not parse Groq response as JSON: ${err.message}`);
    }
  }

  // Backward-compatible: older prompt shape returned a bare array of
  // rows with no notes field. Normalize both shapes to { rawRows, notes }.
  let rawRows;
  let notes = "";
  if (Array.isArray(parsed)) {
    rawRows = parsed;
  } else if (parsed && typeof parsed === "object") {
    rawRows = Array.isArray(parsed.rows) ? parsed.rows : [];
    notes = typeof parsed.notes === "string" ? parsed.notes : "";
  } else {
    throw new Error("Groq response was valid JSON but not in the expected shape");
  }

  let rowIdCounter = 0;
  const rows = [];
  for (const item of rawRows) {
    const amount = typeof item.amount === "number" ? item.amount : Number(item.amount);
    if (Number.isNaN(amount)) continue; // skip unusable rows rather than crashing the whole batch

    rowIdCounter += 1;
    rows.push({
      id: `row_${rowIdCounter}`,
      category: item.category || "Uncategorized",
      period: item.period || undefined,
      amount,
      vendor: item.vendor || undefined,
    });
  }

  return { rows, notes };
}

function noopProgress() {}

/**
 * Full pipeline: takes an array of page image buffers (from
 * pdfRasterize.js), extracts rows from each, combines them.
 *
 * Pages are now fetched CONCURRENTLY (Promise.all) instead of
 * sequentially — see file header for why. Each page still goes through
 * the same callGroqWithRetry resilience path individually.
 *
 * @param {Array} pageImages
 * @param {string} apiKey
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl] - injectable fetch for tests, was
 *   previously the bare third positional argument.
 * @param {Function} [options.onProgress] - optional stage reporter.
 *   Called once with "extracting_pages_started" before any page kicks
 *   off, then once per page as it completes with
 *   "extracted_page_<completedCount>_of_<totalPages>".
 * @param {number} [options.totalPages] - only used to make progress
 *   labels human-friendly; falls back to pageImages.length if omitted.
 */
async function extractFromImages(pageImages, apiKey, options = {}) {
  const { fetchImpl = fetch, onProgress = noopProgress, totalPages = pageImages.length } = options;

  onProgress("extracting_pages_started");

  let completedCount = 0;

  // Kick off every page's Groq call at once rather than awaiting them
  // one-by-one. Each promise carries its own page index so results can
  // be reassembled in original page order regardless of which call
  // finishes first.
  const pagePromises = pageImages.map((page, index) =>
    (async () => {
      const base64 = page.imageBuffer.toString("base64");
      const rawContent = await callGroqWithRetry(base64, apiKey, fetchImpl);
      const parsed = parseModelResponse(rawContent);
      completedCount += 1;
      onProgress(`extracted_page_${completedCount}_of_${totalPages}`);
      return { index, ...parsed };
    })()
  );

  const pageResults = await Promise.all(pagePromises);

  // Reassemble in original page order (index), not completion order, so
  // row numbering and notes ordering stay deterministic and match the
  // document's actual page sequence.
  pageResults.sort((a, b) => a.index - b.index);

  const allRows = [];
  const notesParts = [];
  let rowIdOffset = 0;

  for (const { rows: pageRows, notes: pageNotes } of pageResults) {
    for (const row of pageRows) {
      rowIdOffset += 1;
      row.id = `row_${rowIdOffset}`;
      allRows.push(row);
    }
    if (pageNotes && pageNotes.trim()) {
      notesParts.push(pageNotes.trim());
    }
  }

  return { rows: allRows, notesText: notesParts.join("\n") };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  extractFromImages,
  parseModelResponse,
  callGroqWithRetry,
  GroqRateLimitError,
  MODEL,
};