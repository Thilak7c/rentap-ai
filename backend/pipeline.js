// backend/pipeline.js

/**
 * Pipeline orchestrator
 * ---------------------------------
 * This is the single function that turns "uploaded file bytes" into the
 * exact response shape defined in the locked Insight Object Data Contract
 * (see Insight_Object_Data_Contract.md / Dev League Hackathon Super Docs.md).
 *
 * Flow: parse → mask (PII) → analyze (anomalies) → assemble response
 *
 * Order matters: masking happens BEFORE analysis and BEFORE the response
 * is assembled, so:
 *   1. Anomaly detection never sees raw PII (defense in depth — even
 *      though current checks only look at numeric fields, this protects
 *      against a future check that reads vendor/text fields too)
 *   2. The response sent to the frontend never contains unmasked PII,
 *      full stop — matches the "never re-expose what was redacted"
 *      principle from the PII module itself.
 *
 * This module deliberately contains NO Express-specific code — it's a
 * pure function of (buffer, fileType) -> response object, so it can be
 * unit-tested without spinning up a server, and reused if the transport
 * layer changes.
 *
 * PROGRESS REPORTING (added for job-status polling):
 * processDocument now accepts an optional `onProgress(stage)` callback.
 * `stage` is a short machine-readable string the frontend maps to a
 * human-readable label (see server.js job-status endpoint). This is
 * purely additive — omitting onProgress changes no behavior, so existing
 * callers/tests are unaffected.
 *
 * Current stages emitted from THIS file: "parsing", "extracting_vision",
 * "masking", "analyzing", "done". Finer-grained vision sub-stages (e.g.
 * "rasterizing", "extracting_page_2_of_4") are emitted by
 * visionFallback.js once that file is updated to accept/forward the same
 * onProgress callback — not yet wired as of this change.
 *
 * BATCH SUPPORT (added — multi-file upload):
 * processBatch(files, onProgress) runs the extract+mask step for every
 * file in the batch, tags each row with which file it came from, merges
 * all rows into a single pool, then runs anomaly detection ONCE across
 * the merged pool — so insights can span files (e.g. a variance check
 * comparing Q1.pdf against Q2.pdf), not just within one document.
 *
 * Row ids are namespaced per file (`f0_row_1`, `f1_row_1`, ...) so ids
 * stay unique across the merged pool without changing single-file
 * processDocument() behavior at all — that function still returns bare
 * `row_1`-style ids exactly as before, since existing tests/contract
 * fixtures assert on that shape.
 *
 * A single bad file does NOT fail the whole batch. If a file fails
 * extraction (bad format, no data, vision failure), it's recorded in
 * the response's `files[].error` and skipped — the rest of the batch
 * still processes. The whole batch only throws NO_DATA_FOUND if every
 * file failed and the merged pool is empty.
 */

const { parseDocument } = require("./documentParser");
const { maskRows, maskText } = require("./piiMask");
const { analyzeRows } = require("./anomalyDetection");
const { extractViaVision } = require("./visionFallback");

// Error codes match the ones documented in the locked data contract.
const ErrorCodes = {
  UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  EXTRACTION_FAILED: "EXTRACTION_FAILED",
  NO_DATA_FOUND: "NO_DATA_FOUND",
};

class PipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const SUPPORTED_TYPES = {
  "text/csv": "csv",
  "application/vnd.ms-excel": "csv", // some browsers send CSV as this
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/pdf": "pdf",
};

function detectFileType(originalName, mimeType) {
  if (SUPPORTED_TYPES[mimeType]) return SUPPORTED_TYPES[mimeType];
  // Fallback to extension if mimetype is generic/missing (common with
  // some browsers/OSes for CSV specifically)
  const ext = (originalName.split(".").pop() || "").toLowerCase();
  if (["csv"].includes(ext)) return "csv";
  if (["xlsx", "xls"].includes(ext)) return "xlsx";
  if (["pdf"].includes(ext)) return "pdf";
  return null;
}

// Safe no-op default so every call site below can call onProgress()
// unconditionally without a null-check at every callsite.
function noopProgress() {}

/**
 * Shared extract-only step (parse → vision fallback if needed). No
 * masking, no analysis — used by both processDocument (single file) and
 * processBatch (multi-file) so the extraction logic lives in one place.
 *
 * Throws PipelineError(EXTRACTION_FAILED | NO_DATA_FOUND | UNSUPPORTED_FILE_TYPE | FILE_TOO_LARGE).
 */
async function extractRows({
  buffer,
  originalName,
  mimeType,
  maxSizeBytes = 10 * 1024 * 1024,
  onProgress = noopProgress,
}) {
  if (buffer.length > maxSizeBytes) {
    throw new PipelineError(
      ErrorCodes.FILE_TOO_LARGE,
      `File exceeds the ${(maxSizeBytes / 1024 / 1024).toFixed(0)}MB limit.`
    );
  }

  const fileType = detectFileType(originalName, mimeType);
  if (!fileType) {
    throw new PipelineError(
      ErrorCodes.UNSUPPORTED_FILE_TYPE,
      "Only PDF, CSV, and XLSX files are supported."
    );
  }

  onProgress("parsing");
  let extraction;
  try {
    extraction = await parseDocument(buffer, fileType);
  } catch (err) {
    throw new PipelineError(
      ErrorCodes.EXTRACTION_FAILED,
      `Could not extract data from this file: ${err.message}`
    );
  }

  if (extraction.needsVisionFallback) {
    onProgress("extracting_vision");
    try {
      const visionResult = await extractViaVision(buffer, { onProgress });
      extraction = {
        rows: visionResult.rows,
        skippedCount: visionResult.skippedCount,
        extractionMethod: "vision",
        needsVisionFallback: false,
        notesText: visionResult.notesText || "",
      };
    } catch (err) {
      throw new PipelineError(
        ErrorCodes.EXTRACTION_FAILED,
        `This PDF appears to be a scanned image, and the vision fallback could not extract it: ${err.message}`
      );
    }
  }

  if (!extraction.rows || extraction.rows.length === 0) {
    throw new PipelineError(
      ErrorCodes.NO_DATA_FOUND,
      "No usable financial data rows were found in this document."
    );
  }

  return { fileType, extraction };
}

/**
 * Main entry point for a SINGLE file. Unchanged behavior/output shape —
 * still returns bare `row_1`-style ids, still runs analysis on just this
 * file's rows. Existing tests/contract fixtures keep passing as-is.
 *
 * @param {Object} args
 * @param {Buffer} args.buffer
 * @param {string} args.originalName
 * @param {string} args.mimeType
 * @param {number} [args.maxSizeBytes]
 * @param {(stage: string) => void} [args.onProgress]
 */
async function processDocument({
  buffer,
  originalName,
  mimeType,
  maxSizeBytes = 10 * 1024 * 1024,
  onProgress = noopProgress,
}) {
  const { fileType, extraction } = await extractRows({
    buffer,
    originalName,
    mimeType,
    maxSizeBytes,
    onProgress,
  });

  // --- Mask PII (before analysis, before response assembly) ---
  onProgress("masking");
  const { maskedRows, maskedCount: rowMaskedCount, matches: rowMatches } = maskRows(extraction.rows);

  let maskedCount = rowMaskedCount;
  let matches = rowMatches;
  if (extraction.notesText) {
    const notesResult = maskText(extraction.notesText);
    maskedCount += notesResult.maskedCount;
    if (notesResult.matches.length) {
      matches = [
        ...matches,
        { field: "notes", rowId: null, matches: notesResult.matches },
      ];
    }
  }

  // --- Analyze (runs on masked rows) ---
  onProgress("analyzing");
  const analysis = analyzeRows(maskedRows);

  // --- Assemble response per the locked contract ---
  onProgress("done");
  return {
    meta: {
      filename: originalName,
      fileType,
      extractionMethod: extraction.extractionMethod,
      processedAt: new Date().toISOString(),
    },
    extracted: {
      rowCount: maskedRows.length,
      rows: maskedRows,
    },
    privacy: {
      maskedCount,
      matches: matches.flatMap((entry) =>
        entry.matches.map((m) => ({
          field: entry.field,
          rowId: entry.rowId,
          type: m.type,
        }))
      ),
    },
    insights: analysis.insights,
    summary: analysis.summary,
  };
}

/**
 * Batch entry point for MULTIPLE files. Extracts + masks each file
 * independently (so a PII match/error in one file never touches another),
 * tags every row with `sourceFile`, merges all rows into one pool, then
 * runs anomaly detection ONCE across the merged pool.
 *
 * @param {Object[]} files - each shaped like processDocument's args minus onProgress
 * @param {Buffer} files[].buffer
 * @param {string} files[].originalName
 * @param {string} files[].mimeType
 * @param {number} [maxSizeBytes]
 * @param {(stage: string) => void} [onProgress] - receives stages like
 *   "parsing_file_2_of_5", "masking_file_2_of_5", "analyzing", "done"
 */
async function processBatch(files, { maxSizeBytes = 10 * 1024 * 1024, onProgress = noopProgress } = {}) {
  if (!files || files.length === 0) {
    throw new PipelineError(ErrorCodes.NO_DATA_FOUND, "No files were uploaded.");
  }

  const fileResults = []; // { filename, fileType, extractionMethod, rowCount, error } per file
  const mergedRows = [];
  let maskedCount = 0;
  let matches = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const label = `file_${i + 1}_of_${files.length}`;

    let fileType, extraction;
    try {
      ({ fileType, extraction } = await extractRows({
        buffer: file.buffer,
        originalName: file.originalName,
        mimeType: file.mimeType,
        maxSizeBytes,
        onProgress: (stage) => onProgress(`${stage}_${label}`),
      }));
    } catch (err) {
      // Record the failure and move on to the next file — one bad file
      // shouldn't sink the whole batch.
      fileResults.push({
        filename: file.originalName,
        fileType: null,
        extractionMethod: null,
        rowCount: 0,
        error: err instanceof PipelineError
          ? { code: err.code, message: err.message }
          : { code: "INTERNAL_ERROR", message: "Unexpected error processing this file." },
      });
      continue;
    }

    onProgress(`masking_${label}`);
    const { maskedRows, maskedCount: fileMaskedCount, matches: fileMatches } = maskRows(extraction.rows);

    let fileTotalMasked = fileMaskedCount;
    let combinedFileMatches = fileMatches;
    if (extraction.notesText) {
      const notesResult = maskText(extraction.notesText);
      fileTotalMasked += notesResult.maskedCount;
      if (notesResult.matches.length) {
        combinedFileMatches = [
          ...combinedFileMatches,
          { field: "notes", rowId: null, matches: notesResult.matches },
        ];
      }
    }

    // Namespace ids per file so they stay unique once merged, and tag
    // every row with which file it came from so insights/exports can
    // still trace back to a specific source document.
    const taggedRows = maskedRows.map((row) => ({
      ...row,
      id: `f${i}_${row.id}`,
      sourceFile: file.originalName,
    }));

    // rowId references inside matches need the same namespacing so they
    // still point at the right (now-renamed) row.
    const taggedMatches = combinedFileMatches.map((entry) => ({
      ...entry,
      rowId: entry.rowId ? `f${i}_${entry.rowId}` : entry.rowId,
    }));

    mergedRows.push(...taggedRows);
    maskedCount += fileTotalMasked;
    matches = [...matches, ...taggedMatches];

    fileResults.push({
      filename: file.originalName,
      fileType,
      extractionMethod: extraction.extractionMethod,
      rowCount: taggedRows.length,
      error: null,
    });
  }

  if (mergedRows.length === 0) {
    // If there's exactly one file and it failed, surface its real error
    // code so the frontend shows the correct message (e.g.
    // UNSUPPORTED_FILE_TYPE), instead of a generic NO_DATA_FOUND.
    if (files.length === 1 && fileResults[0]?.error) {
      throw new PipelineError(fileResults[0].error.code, fileResults[0].error.message);
    }
    throw new PipelineError(
      ErrorCodes.NO_DATA_FOUND,
      "No usable financial data rows were found in any of the uploaded files."
    );
  }

  // --- Analyze ONCE across the merged pool ---
  onProgress("analyzing");
  const analysis = analyzeRows(mergedRows);

  onProgress("done");
  return {
    files: fileResults,
    extracted: {
      rowCount: mergedRows.length,
      rows: mergedRows,
    },
    privacy: {
      maskedCount,
      matches: matches.flatMap((entry) =>
        entry.matches.map((m) => ({
          field: entry.field,
          rowId: entry.rowId,
          type: m.type,
        }))
      ),
    },
    insights: analysis.insights,
    summary: analysis.summary,
  };
}

module.exports = {
  processDocument,
  processBatch,
  PipelineError,
  ErrorCodes,
  detectFileType,
};