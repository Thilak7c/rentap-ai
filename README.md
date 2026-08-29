# Rentap AI

AI-powered financial report analysis. Upload PDFs, CSVs, or XLSX files and get automatic data extraction, PII masking, and anomaly/trend insights on a dashboard — built for DevLeague 2026, Lab 1: AI-Powered Financial Report Analysis.

## Problem

Financial reports arrive as a mix of structured and unstructured sources — PDFs, spreadsheets, scanned documents — and manually reading through them to catch trends, anomalies, and risks is slow and error-prone. Rentap AI extracts and interprets key financial data from these sources, flags noteworthy patterns, and presents findings in a clear dashboard so decisions can be made faster and with more confidence.

## Features

- **Multi-file batch upload** — upload up to 10 files (PDF/CSV/XLSX) at once; a single bad file doesn't fail the whole batch.
- **Extraction with vision fallback** — text-layer PDFs are parsed directly; scanned/image-only PDFs fall back to AI vision extraction (via Groq) so even non-searchable documents can be processed.
- **PII masking** — detected personal data (e.g. emails) is masked before it's returned or displayed, so sensitive information never reaches the frontend unmasked.
- **Explainable insights** — every insight (variance spikes, duplicate entries, etc.) links back to the exact source row(s) it was computed from, including insights that span multiple files in a batch.
- **Live progress polling** — uploads return immediately with a job ID; the frontend polls for stage updates instead of blocking on one long request.
- **No persistence** — file bytes are processed in memory only and never written to disk, minimizing the footprint of any personal data that passes through the pipeline.

## Architecture

- **Frontend** (`frontend/`) — Next.js. Upload UI, staged-file review, processing state, results dashboard.
- **Backend** (`backend/`) — Express on Cloud Run. Handles extraction (text/spreadsheet/vision fallback), PII masking, anomaly detection, and returns insights over a job-polling API.

## How it works

1. `POST /api/process` accepts one or more files under the `files` field (max 10, 10MB each), returns `202 { jobId }` immediately.
2. Backend processes the batch in the background: extract → mask PII → detect anomalies across the merged row pool.
3. Frontend polls `GET /api/status/:jobId` until `status: "done"` or `"error"`.
4. Response shape:
   ```
   {
     files: [{ filename, fileType, extractionMethod, rowCount, error }],
     extracted: { rowCount, rows: [...] },
     privacy: { maskedCount, matches: [...] },
     insights: [...],
     summary: { totalInsights, bySeverity }
   }
   ```
   A single bad file doesn't fail the whole batch — it's recorded in `files[].error`, and rows are namespaced per file (`f0_row_1`, `f1_row_1`, etc.) so insights can span files.

### Error codes

| Code | Meaning |
|---|---|
| `UNSUPPORTED_FILE_TYPE` | File isn't PDF, CSV, or XLSX |
| `FILE_TOO_LARGE` | File exceeds 10MB, or batch exceeds 10 files |
| `EXTRACTION_FAILED` | Extraction (including vision fallback) could not read the file |
| `NO_DATA_FOUND` | File(s) parsed successfully but contained no usable rows |
| `JOB_NOT_FOUND` | Polled job ID doesn't exist or has expired |
| `INTERNAL_ERROR` | Unexpected server-side failure |

## Data handling & privacy

- Uploaded files are held in memory only for the duration of processing and are never written to disk.
- Detected PII (e.g. email addresses) in extracted fields is masked before insights are generated or any data leaves the backend.
- Only the data necessary to produce insights is retained for the lifetime of a job (job records expire and are cleaned up automatically after a few minutes).
- AI is used specifically for: (1) vision-based extraction as a fallback when a document has no text layer, and (2) no free-form generation — insight detection itself is deterministic/rule-based, so every finding is traceable to specific source rows rather than model-generated text.

## Running locally

**Backend**
```
cd backend
npm install
cp .env.example .env   # add GROQ_API_KEY, set ALLOWED_ORIGIN to your frontend URL
npm start
```

**Frontend**
```
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

## Testing

```
node backend/integration.test.js
```

Sample test files are in `backend/sample-data/`, covering the demo path including a scanned-PDF vision-fallback case.

## Deploy

```
gcloud run deploy rentap-ai-backend --source ./backend --region asia-southeast1 --project rentap-ai-devleague --set-env-vars="^@^ALLOWED_ORIGIN=https://rentap-ai.vercel.app@GROQ_API_KEY=your_actual_groq_key_here"
```

Frontend deploys to Vercel.