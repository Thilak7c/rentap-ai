// backend/server.js

/**
 * Express server — /api/process + /api/status/:jobId
 * ---------------------------------
 * Thin HTTP layer over pipeline.js. Keeps all actual logic in pipeline.js
 * (framework-agnostic, unit-testable) — this file only handles: receiving
 * the upload, running the pipeline, tracking job progress, mapping errors,
 * and shaping the JSON response/error per the locked contract.
 *
 * BATCH UPLOAD (this change):
 * POST /api/process now accepts MULTIPLE files under the `files` field
 * (multer .array instead of .single) and always calls processBatch() —
 * a single-file upload is just a batch of one. This means the response
 * shape is now always the batch shape ({ files: [...], extracted, privacy,
 * insights, summary }) instead of the old single-file shape ({ meta,
 * extracted, privacy, insights, summary }). The frontend needs to be
 * updated to match (ResultsDashboard.js, api.js) — see pipeline.js
 * header comment for the full batch contract.
 *
 * ARCHITECTURE CHANGE (job-based polling for live progress):
 * POST /api/process returns 202 { jobId } immediately instead of
 * waiting for the full pipeline to finish. The actual processBatch()
 * call runs after the response is sent, with its onProgress callback
 * updating an in-memory job record. The frontend polls
 * GET /api/status/:jobId to get live stage updates and, eventually, the
 * final result or error.
 *
 * CORS: allowed origin(s) come from the ALLOWED_ORIGIN env var (comma-
 * separated for multiple), so the same image works against local dev
 * and the deployed Vercel frontend without a code change — just update
 * the env var on Cloud Run if the frontend URL changes.
 */
require("dotenv").config();
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const { processBatch, PipelineError, ErrorCodes } = require("./pipeline");

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGIN || "http://localhost:3002")
  .split(",")
  .map((origin) => origin.trim());

app.use((req, res, next) => {
  const requestOrigin = req.header("Origin");
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    res.header("Access-Control-Allow-Origin", requestOrigin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// In-memory storage only — file bytes never touch disk, matches the
// no-persistence PDPA story documented in the Super Docs.
// MAX_FILES caps batch size so one upload can't stall the demo for
// minutes — 10 files is generous for a report-analysis use case.
const MAX_FILES = 10;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_FILES }, // 10MB per file — keep in sync with pipeline's maxSizeBytes default
});

// In-memory job store for progress polling. Same lifetime as everything
// else in this no-persistence design — wiped on redeploy/cold start,
// which is fine since a job only needs to live for the ~1-2 minutes a
// single batch takes, not across sessions.
const jobs = new Map();

const JOB_TTL_MS = 5 * 60 * 1000;
function scheduleJobCleanup(jobId) {
  const timer = setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
  timer.unref?.(); // don't let this timer alone keep the process alive
}

app.post("/api/process", upload.array("files", MAX_FILES), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      error: {
        code: ErrorCodes.UNSUPPORTED_FILE_TYPE,
        message: "No files were uploaded. Expected one or more files under the 'files' field.",
      },
    });
  }

  const jobId = crypto.randomUUID();
  jobs.set(jobId, { status: "processing", stage: "starting", result: null, error: null });

  // Respond immediately with the job ID — do NOT await processBatch
  // here, or we're back to a single blocking request.
  res.status(202).json({ jobId });

  const files = req.files.map((f) => ({
    buffer: f.buffer,
    originalName: f.originalname,
    mimeType: f.mimetype,
  }));

  processBatch(files, {
    onProgress: (stage) => {
      const job = jobs.get(jobId);
      if (job) job.stage = stage;
    },
  })
    .then((result) => {
      jobs.set(jobId, { status: "done", stage: "done", result, error: null });
      scheduleJobCleanup(jobId);
    })
    .catch((err) => {
      if (err instanceof PipelineError) {
        jobs.set(jobId, {
          status: "error",
          stage: "error",
          result: null,
          error: { code: err.code, message: err.message },
        });
      } else {
        console.error("Unexpected error in /api/process job:", err);
        jobs.set(jobId, {
          status: "error",
          stage: "error",
          result: null,
          error: {
            code: "INTERNAL_ERROR",
            message: "Something went wrong while processing the documents.",
          },
        });
      }
      scheduleJobCleanup(jobId);
    });
});

app.get("/api/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({
      error: { code: "JOB_NOT_FOUND", message: "This job does not exist or has expired." },
    });
  }
  return res.status(200).json(job); // { status, stage, result, error }
});

// Multer-specific errors (e.g. file-size limit, too-many-files) arrive
// via its own error-handling middleware pattern, not a thrown PipelineError.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: { code: ErrorCodes.FILE_TOO_LARGE, message: "One of the files exceeds the 10MB limit." },
      });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(413).json({
        error: {
          code: ErrorCodes.FILE_TOO_LARGE,
          message: `Too many files in one batch — please upload ${MAX_FILES} or fewer at a time.`,
        },
      });
    }
  }
  console.error("Unhandled error:", err);
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
  });
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}

module.exports = app; // exported for supertest-based integration testing