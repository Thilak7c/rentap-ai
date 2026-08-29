// backend-pipeline/test.js

const {
  extractFromImages,
  parseModelResponse,
  callGroqWithRetry,
  GroqRateLimitError,
} = require("./groqVisionExtractor");

let failures = 0;
function assert(condition, description) {
  if (condition) {
    console.log(`  ✓ ${description}`);
  } else {
    console.error(`  ❌ FAILED: ${description}`);
    failures += 1;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeGroqResponse(rows, notes = "") {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ rows, notes }) } }],
    }),
  };
}

// ---------------------------------------------------------------------
// parseModelResponse
// ---------------------------------------------------------------------
function testParseModelResponse() {
  console.log("\n--- parseModelResponse ---");

  const normal = parseModelResponse(
    JSON.stringify({ rows: [{ category: "Marketing", amount: 1000 }], notes: "Prepared by Ahmad" })
  );
  assert(normal.rows.length === 1 && normal.rows[0].id === "row_1", "normal shape parses, row gets an id");
  assert(normal.notes === "Prepared by Ahmad", "notes field carried through");

  const bareArray = parseModelResponse(JSON.stringify([{ category: "Ops", amount: 500 }]));
  assert(bareArray.rows.length === 1, "legacy bare-array shape still parses");
  assert(bareArray.notes === "", "bare-array shape defaults notes to empty string");

  const fenced = parseModelResponse(
    "```json\n" + JSON.stringify({ rows: [{ category: "IT", amount: 200 }], notes: "" }) + "\n```"
  );
  assert(fenced.rows.length === 1, "markdown-fenced JSON is stripped and parsed");

  const withThink = parseModelResponse(
    "<think>let me look at this image carefully</think>" +
      JSON.stringify({ rows: [{ category: "IT", amount: 300 }], notes: "" })
  );
  assert(withThink.rows.length === 1, "leaked <think> trace is stripped defensively even with reasoning_format hidden");

  const messy = parseModelResponse(
    'Sure, here is the data: ' + JSON.stringify({ rows: [{ category: "Ops", amount: 900 }], notes: "" }) + " Hope that helps!"
  );
  assert(messy.rows.length === 1, "stray prose around the JSON object is recovered via fallback extraction");

  const unusableAmount = parseModelResponse(
    JSON.stringify({ rows: [{ category: "Marketing", amount: "not a number" }], notes: "" })
  );
  assert(unusableAmount.rows.length === 0, "row with unparseable amount is skipped, not crashed on");
}

// ---------------------------------------------------------------------
// callGroqWithRetry
// ---------------------------------------------------------------------
async function testRetryOnRateLimit() {
  console.log("\n--- callGroqWithRetry ---");

  let callCount = 0;
  const mockFetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: (h) => (h === "retry-after" ? "0" : null) }, // 0s so the test doesn't actually wait
        text: async () => "",
      };
    }
    return fakeGroqResponse([{ category: "Marketing", amount: 1000 }]);
  };

  const content = await callGroqWithRetry("fake-base64", "fake-key", mockFetch);
  assert(callCount === 2, "retried exactly once after a single 429");
  assert(JSON.parse(content).rows[0].amount === 1000, "eventually returns the successful response content");

  let alwaysFails = 0;
  const alwaysRateLimited = async () => {
    alwaysFails += 1;
    return { ok: false, status: 429, headers: { get: () => "0" }, text: async () => "" };
  };
  try {
    await callGroqWithRetry("fake-base64", "fake-key", alwaysRateLimited);
    assert(false, "should have thrown GroqRateLimitError after exhausting retries");
  } catch (err) {
    assert(err instanceof GroqRateLimitError, "throws GroqRateLimitError after MAX_RETRIES exhausted");
    assert(alwaysFails === 3, "attempted exactly MAX_RETRIES (3) times before giving up");
  }
}

// ---------------------------------------------------------------------
// extractFromImages — NEW options-object signature + concurrency
// ---------------------------------------------------------------------
async function testExtractFromImagesSignatureAndConcurrency() {
  console.log("\n--- extractFromImages (options-object signature, concurrency, ordering) ---");

  const pageImages = [
    { pageNumber: 1, imageBuffer: Buffer.from("page-1-content") },
    { pageNumber: 2, imageBuffer: Buffer.from("page-2-content") },
    { pageNumber: 3, imageBuffer: Buffer.from("page-3-content") },
  ];

  // Deliberately resolves OUT of page order (page 3 fastest, page 1
  // slowest) to prove results get reassembled by original index, not by
  // completion order.
  const DELAYS_MS = { "page-1-content": 60, "page-2-content": 30, "page-3-content": 5 };

  const progressEvents = [];
  const mockFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const dataUrl = body.messages[0].content[1].image_url.url;
    const base64 = dataUrl.split(",")[1];
    const pageContent = Buffer.from(base64, "base64").toString("utf-8");
    await sleep(DELAYS_MS[pageContent] ?? 10);
    const pageNum = pageContent.match(/page-(\d)-content/)[1];
    return fakeGroqResponse([{ category: `Category${pageNum}`, amount: Number(pageNum) * 100 }]);
  };

  // THE FIX BEING TESTED: this must be called with an options OBJECT as
  // the third argument, not a bare fetchImpl function positionally — the
  // old call site would have silently broken (options object mistaken
  // for fetchImpl).
  const result = await extractFromImages(pageImages, "fake-key", {
    fetchImpl: mockFetch,
    onProgress: (stage) => progressEvents.push(stage),
    totalPages: 3,
  });

  assert(result.rows.length === 3, "all 3 pages' rows are present in the combined result");
  assert(
    result.rows.map((r) => r.category).join(",") === "Category1,Category2,Category3",
    "rows are reassembled in ORIGINAL page order despite page 3 resolving fastest and page 1 slowest"
  );
  assert(
    result.rows.every((r, i) => r.id === `row_${i + 1}`),
    "row ids are re-numbered sequentially across pages after reordering"
  );

  assert(progressEvents.includes("extracting_pages_started"), "onProgress fires a starting event before any page completes");
  assert(
    progressEvents.some((e) => /^extracted_page_\d_of_3$/.test(e)),
    "onProgress fires per-page completion events in the expected format"
  );
  assert(
    progressEvents.filter((e) => /^extracted_page_/.test(e)).length === 3,
    "onProgress fires exactly one completion event per page"
  );

  // Concurrency check: total wall-clock time should be roughly the
  // SLOWEST single page (60ms), not the SUM of all three (95ms) — proves
  // pages ran in parallel rather than sequentially. Generous upper bound
  // to avoid CI/timer flakiness.
  const startedAt = Date.now();
  await extractFromImages(pageImages, "fake-key", { fetchImpl: mockFetch, totalPages: 3 });
  const elapsedMs = Date.now() - startedAt;
  assert(
    elapsedMs < 90,
    `pages run concurrently — elapsed ${elapsedMs}ms should be closer to the slowest page (60ms) than the sum of all pages (95ms)`
  );
}

// ---------------------------------------------------------------------
// extractFromImages — omitted options (default fetch/no onProgress) is
// still safe — proves the options object being fully optional doesn't
// crash anything (relevant since options object is destructured with
// defaults).
// ---------------------------------------------------------------------
async function testExtractFromImagesDefaultsAreSafe() {
  console.log("\n--- extractFromImages (all options omitted) ---");
  const pageImages = [{ pageNumber: 1, imageBuffer: Buffer.from("solo-page") }];

  // Can't actually omit fetchImpl entirely without hitting real network,
  // so this confirms onProgress/totalPages being omitted doesn't throw —
  // fetchImpl is still supplied via options for safety in this test env.
  const mockFetch = async () => fakeGroqResponse([{ category: "Solo", amount: 42 }]);
  const result = await extractFromImages(pageImages, "fake-key", { fetchImpl: mockFetch });
  assert(result.rows.length === 1, "works correctly when onProgress/totalPages are omitted from options");
}

async function main() {
  console.log("=".repeat(70));
  console.log("UNIT TESTS — groqVisionExtractor.js (mocked HTTP only)");
  console.log("=".repeat(70));

  testParseModelResponse();
  await testRetryOnRateLimit();
  await testExtractFromImagesSignatureAndConcurrency();
  await testExtractFromImagesDefaultsAreSafe();

  console.log("\n" + "=".repeat(70));
  if (failures === 0) {
    console.log("ALL UNIT TESTS PASSED");
  } else {
    console.log(`${failures} TEST(S) FAILED`);
    process.exitCode = 1;
  }
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});