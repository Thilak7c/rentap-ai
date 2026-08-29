// backend-pipeline/pdfRasterize.js

/**
 * PDF → Image rasterization
 * ---------------------------------
 * Converts a scanned/image PDF (one with no extractable text layer) into
 * PNG images, one per page, so they can be sent to a vision model.
 *
 * Uses `pdftoppm` (poppler-utils) via child_process rather than a pure-JS
 * library — poppler is the same rendering engine behind most PDF viewers,
 * genuinely reliable, and already available in standard Linux
 * environments (including Cloud Run's default container base). No new
 * npm dependency needed.
 *
 * IMPORTANT — Cloud Run deployment note: poppler-utils must be present in
 * the deployed container. The default Node.js Cloud Run buildpack image
 * does NOT include it. Either switch to a Dockerfile-based deploy that
 * installs poppler-utils (`apt-get install -y poppler-utils`), or confirm
 * an alternative before relying on this in production — this was tested
 * in the sandbox environment (which has poppler-utils installed) but not
 * yet verified against the actual Cloud Run buildpack image.
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const execFileAsync = promisify(execFile);

const MAX_PAGES = 5; // cap to avoid an enormous scanned PDF blowing up API calls/cost

/**
 * Renders each page of a PDF buffer to a PNG image buffer.
 * Returns an array of { pageNumber, imageBuffer } — capped at MAX_PAGES.
 *
 * Throws if pdftoppm is not available or the PDF can't be rendered —
 * caller should catch this and treat it the same as an extraction
 * failure (no silent partial success).
 */
async function rasterizePDF(pdfBuffer) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-rasterize-"));
  const inputPath = path.join(tmpDir, "input.pdf");
  const outputPrefix = path.join(tmpDir, "page");

  try {
    await fs.writeFile(inputPath, pdfBuffer);

    // -png: output PNG format
    // -r 150: 150 DPI — enough detail for a vision model to read text
    //   without producing unnecessarily huge images
    // -f 1 -l MAX_PAGES: only render the first MAX_PAGES pages
    await execFileAsync("pdftoppm", [
      "-png",
      "-r",
      "150",
      "-f",
      "1",
      "-l",
      String(MAX_PAGES),
      inputPath,
      outputPrefix,
    ]);

    const files = (await fs.readdir(tmpDir))
      .filter((f) => f.startsWith("page") && f.endsWith(".png"))
      .sort(); // pdftoppm names output page-1.png, page-2.png, etc — lexical sort works up to page-9; fine given MAX_PAGES=5

    const pages = [];
    for (const file of files) {
      const imageBuffer = await fs.readFile(path.join(tmpDir, file));
      const match = file.match(/-(\d+)\.png$/);
      pages.push({
        pageNumber: match ? Number(match[1]) : pages.length + 1,
        imageBuffer,
      });
    }

    return pages;
  } finally {
    // Clean up temp files regardless of success/failure — don't leak
    // uploaded document content onto disk longer than necessary, which
    // also matters for the no-persistence PDPA story.
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { rasterizePDF, MAX_PAGES };
