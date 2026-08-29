// frontend/lib/api.js

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080";
const POLL_INTERVAL_MS = 1000;

export const ErrorCodes = {
  UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  EXTRACTION_FAILED: "EXTRACTION_FAILED",
  NO_DATA_FOUND: "NO_DATA_FOUND",
  NETWORK_ERROR: "NETWORK_ERROR",
};

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const FRIENDLY_MESSAGES = {
  [ErrorCodes.UNSUPPORTED_FILE_TYPE]: "Only PDF, CSV, and XLSX files are supported.",
  [ErrorCodes.FILE_TOO_LARGE]: "One of these files is too large. Please try files under 10MB.",
  [ErrorCodes.EXTRACTION_FAILED]:
    "We couldn't read one of these documents. If it's a scanned PDF, try a text-based version instead.",
  [ErrorCodes.NO_DATA_FOUND]: "No usable financial data was found in these documents.",
  [ErrorCodes.NETWORK_ERROR]: "Couldn't reach the server. Check your connection and try again.",
};

export function friendlyErrorMessage(code, fallback) {
  return FRIENDLY_MESSAGES[code] || fallback || "Something went wrong. Please try again.";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Uploads a batch of files (1 or more), then polls until the job
 * finishes. Returns the batch-shaped response: { files, extracted,
 * privacy, insights, summary }. A single file is just a batch of one —
 * always call this, never a separate single-file path.
 *
 * @param {File[]|FileList} files
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {(stage: string) => void} [opts.onProgress]
 */
export async function processFiles(files, { signal, onProgress } = {}) {
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append("files", file));

  let startResponse;
  try {
    startResponse = await fetch(`${API_BASE}/api/process`, {
      method: "POST",
      body: formData,
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError(ErrorCodes.NETWORK_ERROR, "Could not reach the server.");
  }

  let startBody;
  try {
    startBody = await startResponse.json();
  } catch {
    throw new ApiError(ErrorCodes.NETWORK_ERROR, "Received an invalid response from the server.");
  }

  if (!startResponse.ok) {
    const code = startBody?.error?.code || ErrorCodes.NETWORK_ERROR;
    throw new ApiError(code, startBody?.error?.message);
  }

  const { jobId } = startBody;
  if (!jobId) {
    throw new ApiError(ErrorCodes.NETWORK_ERROR, "Server did not return a job ID.");
  }

  return pollUntilDone(jobId, { signal, onProgress });
}

async function pollUntilDone(jobId, { signal, onProgress }) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }

    let response;
    try {
      response = await fetch(`${API_BASE}/api/status/${jobId}`, { signal });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw new ApiError(ErrorCodes.NETWORK_ERROR, "Lost connection while checking progress.");
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(ErrorCodes.NETWORK_ERROR, "Received an invalid status response from the server.");
    }

    if (!response.ok) {
      const code = body?.error?.code || ErrorCodes.NETWORK_ERROR;
      throw new ApiError(code, body?.error?.message);
    }

    if (body.stage && onProgress) onProgress(body.stage);

    if (body.status === "done") {
      return body.result; // batch-shaped: { files, extracted, privacy, insights, summary }
    }
    if (body.status === "error") {
      throw new ApiError(body.error?.code || ErrorCodes.EXTRACTION_FAILED, body.error?.message);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}