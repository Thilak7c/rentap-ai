// backend-pipeline/documentParser.js

/**
 * Document Parsing module
 * ---------------------------------
 * Scope: turns an uploaded file (CSV, XLSX, or text-layer PDF) into the
 * normalized row shape expected by the anomaly detection module and the
 * locked Insight Object Data Contract:
 *
 *   { id, category, period, amount, vendor, ...anything else found }
 *
 * Design notes:
 *  - Spreadsheets are parsed directly — no LLM call, fast, free, no
 *    rate-limit risk. This should be the primary/most-reliable path.
 *  - Text-layer PDFs are parsed via pdf-parse (extracts the actual text
 *    layer, not OCR) then passed through a lightweight table-guessing
 *    heuristic. This is intentionally simple, not a full PDF-table-parser
 *    replacement — good enough for typical financial report layouts
 *    (label/value pairs, simple tables with consistent delimiters).
 *  - Scanned/image PDFs (no text layer) are NOT handled here — this
 *    module detects that case and returns a clear signal so the caller
 *    can decide whether to invoke a vision-model fallback. Keeping that
 *    decision out of this module keeps it free of any API-call risk.
 *  - Column name normalization is deliberately forgiving: real reports
 *    won't always say exactly "amount" or "category" — see
 *    normalizeColumnName() for the mapping logic.
 *
 * KNOWN LIMITATION (documented, not silently swallowed — see
 * extractRowsFromText() below): formal statement-style PDFs often wrap a
 * single row's label across two physical lines (e.g. a long line item
 * name that breaks before the amount). When that happens, the row is
 * still captured with the correct amount, but the category text may be
 * truncated to just the tail of the label (the part on the same line as
 * the number). This is a real PDF-table-reconstruction problem, not a
 * regex bug — full fix would need geometry-aware extraction
 * (x/y positions per text run), which is out of scope for this heuristic.
 */

const Papa = require("papaparse");
const XLSX = require("xlsx");
const { PDFParse } = require("pdf-parse"); // v2 API: class-based, NOT the v1 callable-function API — see parsePDF()

let rowIdCounter = 0;
function nextRowId() {
  rowIdCounter += 1;
  return `row_${rowIdCounter}`;
}
function resetRowIdCounter() {
  rowIdCounter = 0;
}

// ---------------------------------------------------------------------
// Column name normalization
// ---------------------------------------------------------------------
// Real spreadsheets/reports use inconsistent headers. Map common variants
// to the canonical field names the rest of the pipeline expects. This is
// intentionally a simple lookup table, not NLP — fast, deterministic,
// and easy to extend if a real report uses a header we haven't seen yet.
const COLUMN_ALIASES = {
  category: ["category", "cost category", "expense category", "type", "account category"],
  period: ["period", "quarter", "month", "date", "fiscal period", "reporting period"],
  amount: ["amount", "total", "value", "cost", "expense", "amount (rm)", "rm"],
  vendor: ["vendor", "supplier", "payee", "vendor name", "supplier name"],
};

function normalizeColumnName(rawName) {
  const cleaned = String(rawName).trim().toLowerCase();
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.includes(cleaned)) return canonical;
  }
  return cleaned; // unrecognized column: keep as-is, passed through untouched
}

// Coerces a raw cell value to a number for amount fields. Strips currency
// symbols, commas, and whitespace. Returns null (not NaN) if it can't be
// parsed, so the caller can decide how to handle it explicitly rather than
// silently propagating NaN through later arithmetic.
//
// UPDATED: formal financial statements commonly show negative amounts as
// parenthesized values, e.g. "(319,720)" instead of "-319,720" (standard
// accounting notation). Detect that BEFORE stripping non-numeric chars,
// since the stripping step would otherwise discard the parens and quietly
// turn a negative figure positive.
function coerceAmount(rawValue) {
  if (typeof rawValue === "number") return rawValue;
  if (typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  const isNegativeParens = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  let num = Number(cleaned);
  if (Number.isNaN(num)) return null;
  if (isNegativeParens) num = -Math.abs(num);
  return num;
}

// ---------------------------------------------------------------------
// Spreadsheet parsing (CSV via papaparse, XLSX via SheetJS)
// ---------------------------------------------------------------------
function parseCSV(fileBuffer) {
  const text = fileBuffer.toString("utf-8");
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false, // we coerce manually via coerceAmount, more control over malformed values
  });

  if (result.errors && result.errors.length > 0) {
    // Papa reports row-level errors (e.g. inconsistent column count) but
    // usually still returns usable data — don't hard-fail, just surface
    // the errors for logging/disclosure purposes.
    console.warn("CSV parse warnings:", result.errors);
  }

  return normalizeSpreadsheetRows(result.data);
}

function parseXLSX(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  return normalizeSpreadsheetRows(data);
}

function normalizeSpreadsheetRows(rawRows) {
  resetRowIdCounter();
  const rows = [];
  let skippedCount = 0;

  for (const rawRow of rawRows) {
    const normalized = {};
    for (const [rawKey, rawValue] of Object.entries(rawRow)) {
      const key = normalizeColumnName(rawKey);
      normalized[key] = key === "amount" ? rawValue : rawValue; // amount coerced below after we know the key landed
    }

    if (normalized.amount !== undefined) {
      normalized.amount = coerceAmount(normalized.amount);
    }

    // A row with no parseable amount isn't useful to the analysis layer —
    // skip it but count it, rather than passing through garbage.
    if (normalized.amount === null || normalized.amount === undefined) {
      skippedCount += 1;
      continue;
    }

    normalized.id = nextRowId();
    rows.push(normalized);
  }

  return { rows, skippedCount };
}

// ---------------------------------------------------------------------
// Text-layer PDF parsing
// ---------------------------------------------------------------------
async function parsePDF(fileBuffer) {
  // pdf-parse v2 uses a class-based API (new PDFParse({ data }).getText()),
  // NOT the v1 callable-function API (pdf(buffer)) that most examples
  // online still show — verified directly against the installed version
  // (2.4.5) since this broke silently on first real-file test.
  const parser = new PDFParse({ data: fileBuffer });
  let text;
  try {
    const result = await parser.getText();
    text = result.text || "";
  } finally {
    await parser.destroy();
  }

  // Heuristic: if there's barely any extractable text, this is very
  // likely a scanned/image PDF with no real text layer. Signal that
  // clearly rather than trying to force a parse of near-empty content.
  const meaningfulTextLength = text.replace(/\s/g, "").length;
  if (meaningfulTextLength < 50) {
    return {
      rows: [],
      skippedCount: 0,
      needsVisionFallback: true,
      reason: "No meaningful text layer detected — likely a scanned/image PDF.",
    };
  }

  const rows = extractRowsFromText(text);
  return { rows: rows.rows, skippedCount: rows.skippedCount, needsVisionFallback: false };
}

// Lightweight line-based table guesser: looks for lines that contain a
// label followed by a currency-like number.
//
// UPDATED: no longer requires the literal "RM" prefix on the number.
// Many real financial-statement PDFs (esp. formal/regulatory filings)
// state the currency once as a column header (e.g. "RM'000") and then
// print bare numbers on every line — "RM" never appears line-by-line.
// Requiring "RM" per-line meant those documents silently produced zero
// rows. Instead, a number now qualifies as "amount-like" if it has
// comma-grouped thousands (e.g. "22,494,498") — this is actually a
// *better* filter than requiring "RM," since it naturally excludes page
// numbers, note references ("A23"), and percentages ("13.238%") without
// needing to special-case them. "RM" is still matched and stripped if
// present, since some documents do include it inline.
//
// This is deliberately simple, not a general PDF-table extractor — good
// enough for text-based financial statements with one line per entry.
// A denser/multi-column PDF table, or a label that wraps across two
// lines before the amount, may not be fully captured — that's a known
// limitation (see file header), not a silent failure (skippedCount
// reflects lines that looked number-ish but didn't match cleanly).
function extractRowsFromText(text) {
  resetRowIdCounter();
  const rows = [];
  let skippedCount = 0;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // A number that "looks like" a financial amount: optionally wrapped in
  // parens (negative, accounting notation) or prefixed "RM", with at
  // least one comma-grouped thousands separator. The comma requirement
  // is the key qualifying signal now that "RM" is optional.
  const AMOUNT = String.raw`\(?(?:RM\s?)?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?`;

  // Pattern A: comma or tab-delimited row that looks like
  // "Category, Period, Amount, Vendor" (handles CSV-like text extracted
  // from a PDF table).
  const delimitedPattern = new RegExp(
    `^([^,\\t]+)[,\\t]+\\s*([^,\\t]+)[,\\t]+\\s*(${AMOUNT})[,\\t]*\\s*(.*)$`,
    "i"
  );

  // Pattern B: "Label .... amount" dot-leader style
  const labelAmountPattern = new RegExp(`^(.+?)\\.{2,}\\s*(${AMOUNT})\\s*$`, "i");

  // Pattern C: "Label   amount [amount2 ...]" whitespace-aligned style —
  // the common shape for formal statement PDFs (e.g. "TOTAL ASSETS
  // 348,222,508 341,737,002", current period then prior period). We
  // take the FIRST number as this row's amount and ignore any trailing
  // comparative column(s) — capturing prior-period as a separate
  // dimension would need a real column-alignment pass, out of scope here.
  const labelAmountPatternSimple = new RegExp(
    `^([A-Za-z][A-Za-z\\s&/,()'-]*?)\\s{2,}(${AMOUNT})(?:\\s+${AMOUNT})*\\s*$`,
    "i"
  );

  for (const line of lines) {
    let match = line.match(delimitedPattern);
    if (match) {
      const amount = coerceAmount(match[3]);
      if (amount !== null) {
        rows.push({
          id: nextRowId(),
          category: match[1].trim(),
          period: match[2].trim(),
          amount,
          vendor: match[4] ? match[4].trim() : undefined,
        });
        continue;
      }
    }

    match = line.match(labelAmountPattern) || line.match(labelAmountPatternSimple);
    if (match) {
      const amount = coerceAmount(match[2]);
      if (amount !== null) {
        rows.push({
          id: nextRowId(),
          category: match[1].trim(),
          amount,
        });
        continue;
      }
    }

    // Line didn't match either pattern — likely prose/header/footer text,
    // not a data row. Only flag lines that look number-ish (comma-grouped
    // figure present) but didn't parse cleanly as a real skip, so
    // skippedCount stays meaningful rather than counting ordinary prose.
    if (/\d{1,3}(?:,\d{3})+/.test(line)) {
      skippedCount += 1;
    }
  }

  return { rows, skippedCount };
}

// ---------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------
async function parseDocument(fileBuffer, fileType) {
  switch (fileType) {
    case "csv": {
      const { rows, skippedCount } = parseCSV(fileBuffer);
      return { rows, skippedCount, extractionMethod: "spreadsheet", needsVisionFallback: false };
    }
    case "xlsx": {
      const { rows, skippedCount } = parseXLSX(fileBuffer);
      return { rows, skippedCount, extractionMethod: "spreadsheet", needsVisionFallback: false };
    }
    case "pdf": {
      const result = await parsePDF(fileBuffer);
      return { ...result, extractionMethod: result.needsVisionFallback ? "vision_needed" : "text" };
    }
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

module.exports = {
  parseDocument,
  parseCSV,
  parseXLSX,
  parsePDF,
  extractRowsFromText, // exported for direct testing of the PDF text heuristic without needing a real PDF file
  normalizeColumnName,
  coerceAmount,
};