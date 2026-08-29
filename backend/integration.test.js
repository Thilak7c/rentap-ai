// backend/integration.test.js

const request = require("supertest");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const app = require("./server");

async function buildSamplePDF() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 320]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = [
    "QUARTERLY EXPENSE REPORT",
    "Prepared by: Ahmad Faizal bin Hassan",
    "Marketing, Q1 2026, RM45,000.00",
    "Marketing, Q2 2026, RM198,000.00",
    "Operations, Q1 2026, RM30,000.00",
    "Operations, Q2 2026, RM31,500.00",
  ];
  lines.forEach((line, i) => page.drawText(line, { x: 20, y: 280 - i * 20, size: 11, font }));
  return Buffer.from(await doc.save());
}

async function buildBlankPDF() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  return Buffer.from(await doc.save());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollJob(jobId, { timeoutMs = 20000, intervalMs = 50 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await request(app).get(`/api/status/${jobId}`);
    if (res.body.status === "done" || res.body.status === "error") {
      return res;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Job ${jobId} did not reach a terminal state within ${timeoutMs}ms (last stage: ${res.body.stage})`);
    }
    await sleep(intervalMs);
  }
}

let failures = 0;
function assert(condition, description) {
  if (condition) {
    console.log(`  ✓ ${description}`);
  } else {
    console.error(`  ❌ FAILED: ${description}`);
    failures += 1;
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("INTEGRATION TEST — real HTTP requests against /api/process + /api/status (batch contract)");
  console.log("=".repeat(70));

  // --- Test 1: health check ---
  console.log("\n--- Test 1: health check ---");
  const health = await request(app).get("/health");
  assert(health.status === 200, "GET /health returns 200");

  // --- Test 2: single-file batch (batch of one), CSV happy path ---
  console.log("\n--- Test 2: single-file batch, valid CSV ---");
  const csvContent = `Category,Period,Amount,Vendor
Marketing,Q1 2026,45000,AdCo
Marketing,Q2 2026,198000,AdCo
Operations,Q1 2026,30000,OpsSupplier
Operations,Q2 2026,31500,OpsSupplier
IT,Q2 2026,12450,CloudHost Services
IT,Q2 2026,12450,CloudHost Services`;

  const csvStart = await request(app)
    .post("/api/process")
    .attach("files", Buffer.from(csvContent, "utf-8"), { filename: "report.csv", contentType: "text/csv" });
  assert(csvStart.status === 202, "CSV upload returns 202 with a jobId");
  assert(!!csvStart.body.jobId, "response includes a jobId");

  const csvJob = await pollJob(csvStart.body.jobId);
  const csvRes = csvJob.body.result;
  console.log(JSON.stringify(csvRes, null, 2));
  assert(csvJob.body.status === "done", "CSV job finishes with status 'done'");
  assert(csvRes.files.length === 1, "response has one entry in files[]");
  assert(csvRes.files[0].filename === "report.csv", "files[0].filename matches upload");
  assert(csvRes.files[0].extractionMethod === "spreadsheet", "files[0].extractionMethod is 'spreadsheet'");
  assert(csvRes.files[0].error === null, "files[0].error is null on success");
  assert(csvRes.extracted.rowCount === 6, "extracted 6 rows");
  assert(csvRes.insights.some((i) => i.type === "variance"), "found a variance insight");
  assert(csvRes.insights.some((i) => i.type === "duplicate"), "found a duplicate insight (CloudHost x2)");
  assert(
    csvRes.insights.every((i) => i.sourceRowIds && i.sourceRowIds.length > 0),
    "every insight has at least one sourceRowId"
  );
  assert(csvRes.extracted.rows.every((r) => r.id.startsWith("f0_")), "row ids are namespaced with f0_ prefix");
  assert(csvRes.summary.totalInsights === csvRes.insights.length, "summary.totalInsights matches insights array length");

  // --- Test 3: CSV with PII, single-file batch ---
  console.log("\n--- Test 3: CSV with PII in vendor/note field ---");
  const csvWithPII = `Category,Period,Amount,Vendor
Marketing,Q1 2026,45000,Contact: procurement@globalsupplies.com
Marketing,Q2 2026,198000,AdCo`;
  const piiStart = await request(app)
    .post("/api/process")
    .attach("files", Buffer.from(csvWithPII, "utf-8"), { filename: "report2.csv", contentType: "text/csv" });
  assert(piiStart.status === 202, "PII CSV upload returns 202");

  const piiJob = await pollJob(piiStart.body.jobId);
  const piiRes = piiJob.body.result;
  console.log(JSON.stringify(piiRes.privacy, null, 2));
  assert(piiRes.privacy.maskedCount >= 1, "at least 1 field masked");
  assert(piiRes.privacy.matches[0].rowId !== undefined, "privacy.matches includes rowId");
  assert(piiRes.privacy.matches[0].rowId.startsWith("f0_"), "rowId is namespaced (f0_ prefix)");
  assert(
    !JSON.stringify(piiRes).includes("procurement@globalsupplies.com"),
    "original email does NOT appear anywhere in the response"
  );
  assert(
    piiRes.extracted.rows[0].vendor.includes("[REDACTED:EMAIL]"),
    "vendor field shows the redaction placeholder"
  );

  // --- Test 4: real PDF, single-file batch ---
  console.log("\n--- Test 4: real PDF upload (text layer) ---");
  const pdfBuffer = await buildSamplePDF();
  const pdfStart = await request(app)
    .post("/api/process")
    .attach("files", pdfBuffer, { filename: "report.pdf", contentType: "application/pdf" });
  assert(pdfStart.status === 202, "PDF upload returns 202");

  const pdfJob = await pollJob(pdfStart.body.jobId);
  const pdfRes = pdfJob.body.result;
  console.log(JSON.stringify(pdfRes, null, 2));
  assert(pdfJob.body.status === "done", "PDF job finishes with status 'done'");
  assert(pdfRes.files[0].extractionMethod === "text", "files[0].extractionMethod is 'text'");
  assert(pdfRes.extracted.rowCount === 4, "extracted 4 rows from PDF");
  assert(
    pdfRes.insights.some((i) => i.type === "variance" && i.metric.category === "Marketing"),
    "found Marketing variance insight from PDF data"
  );

  // --- Test 5: blank scanned PDF, single-file batch — real error code must survive ---
  // Requires the pipeline.js fix (surface the single file's real error
  // code instead of a generic NO_DATA_FOUND) to pass.
  console.log("\n--- Test 5: blank/scanned PDF (single-file batch) ---");
  const blankPdfBuffer = await buildBlankPDF();
  const blankStart = await request(app)
    .post("/api/process")
    .attach("files", blankPdfBuffer, { filename: "scanned.pdf", contentType: "application/pdf" });
  assert(blankStart.status === 202, "blank PDF upload returns 202");

  const blankJob = await pollJob(blankStart.body.jobId);
  console.log(JSON.stringify(blankJob.body, null, 2));
  assert(blankJob.body.status === "error", "blank PDF job finishes with status 'error'");
  assert(blankJob.body.error.code === "NO_DATA_FOUND", "error code is NO_DATA_FOUND (correct extraction, zero content)");

  // --- Test 6: unsupported file type, single-file batch — real error code must survive ---
  console.log("\n--- Test 6: unsupported file type (single-file batch) ---");
  const badStart = await request(app)
    .post("/api/process")
    .attach("files", Buffer.from("not a real file"), { filename: "malware.exe", contentType: "application/octet-stream" });
  assert(badStart.status === 202, "unsupported file type still returns 202");

  const badJob = await pollJob(badStart.body.jobId);
  assert(badJob.body.status === "error", "unsupported-type job finishes with status 'error'");
  assert(badJob.body.error.code === "UNSUPPORTED_FILE_TYPE", "error code is UNSUPPORTED_FILE_TYPE, not swallowed into NO_DATA_FOUND");

  // --- Test 7: no files attached ---
  console.log("\n--- Test 7: no files attached ---");
  const noFileRes = await request(app).post("/api/process");
  assert(noFileRes.status === 400, "no files returns 400 directly, no jobId involved");

  // --- Test 8: CSV with no valid data rows, single-file batch ---
  console.log("\n--- Test 8: CSV with no usable data ---");
  const emptyCsv = `Category,Period,Amount,Vendor\nMarketing,Q1 2026,N/A,AdCo`;
  const emptyStart = await request(app)
    .post("/api/process")
    .attach("files", Buffer.from(emptyCsv, "utf-8"), { filename: "empty.csv", contentType: "text/csv" });
  assert(emptyStart.status === 202, "no-usable-data CSV returns 202");

  const emptyJob = await pollJob(emptyStart.body.jobId);
  assert(emptyJob.body.status === "error", "no-usable-data job finishes with status 'error'");
  assert(emptyJob.body.error.code === "NO_DATA_FOUND", "error code is NO_DATA_FOUND");

  // --- Test 9: unknown jobId ---
  console.log("\n--- Test 9: unknown jobId ---");
  const unknownRes = await request(app).get("/api/status/not-a-real-job-id");
  assert(unknownRes.status === 404, "unknown jobId returns 404");
  assert(unknownRes.body.error.code === "JOB_NOT_FOUND", "error code is JOB_NOT_FOUND");

  // --- Test 10: real multi-file batch — cross-file insights + partial failure tolerance ---
  console.log("\n--- Test 10: multi-file batch (2 good files + 1 bad file) ---");
  const csvFileA = `Category,Period,Amount,Vendor
Marketing,Q1 2026,45000,AdCo`;
  const csvFileB = `Category,Period,Amount,Vendor
Marketing,Q2 2026,198000,AdCo`;

  const batchStart = await request(app)
    .post("/api/process")
    .attach("files", Buffer.from(csvFileA, "utf-8"), { filename: "q1.csv", contentType: "text/csv" })
    .attach("files", Buffer.from(csvFileB, "utf-8"), { filename: "q2.csv", contentType: "text/csv" })
    .attach("files", Buffer.from("not a real file"), { filename: "bad.exe", contentType: "application/octet-stream" });
  assert(batchStart.status === 202, "multi-file batch upload returns 202");

  const batchJob = await pollJob(batchStart.body.jobId);
  const batchRes = batchJob.body.result;
  console.log(JSON.stringify(batchRes, null, 2));
  assert(batchJob.body.status === "done", "multi-file batch job finishes with status 'done' despite one bad file");
  assert(batchRes.files.length === 3, "files[] has an entry for every uploaded file, including the failed one");
  assert(batchRes.files.filter((f) => f.error === null).length === 2, "2 files succeeded");
  assert(batchRes.files.find((f) => f.filename === "bad.exe").error.code === "UNSUPPORTED_FILE_TYPE", "bad.exe recorded with its real error code");
  assert(batchRes.extracted.rowCount === 2, "merged pool has rows from both good files only");
  assert(
    batchRes.extracted.rows.some((r) => r.id.startsWith("f0_")) && batchRes.extracted.rows.some((r) => r.id.startsWith("f1_")),
    "rows are namespaced per source file (f0_, f1_)"
  );
  assert(
    batchRes.insights.some((i) => i.type === "variance" && i.metric.category === "Marketing"),
    "cross-file variance insight found (Q1 in file 0 vs Q2 in file 1)"
  );

  console.log("\n" + "=".repeat(70));
  if (failures === 0) {
    console.log("ALL INTEGRATION TESTS PASSED");
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