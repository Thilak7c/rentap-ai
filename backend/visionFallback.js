// backend-pipeline/visionFallback.js

/**
 * Groq Vision Fallback — orchestration wrapper
 * ---------------------------------
 * Thin adapter wiring together pdfRasterize.js (PDF -> PNG page images via
 * poppler's pdftoppm) and groqVisionExtractor.js (page images -> Groq
 * vision model -> structured rows). Both of those modules were built and
 * reviewed separately — this file just adapts their combined output into
 * the { rows, skippedCount } shape pipeline.js expects from any
 * extraction path, matching what parseDocument() returns.
 *
 * Chosen over an earlier pdfjs-dist + canvas rendering attempt: that
 * approach hit repeated "API version does not match Worker version"
 * errors caused by a third-party wrapper package bundling its own frozen
 * worker file, independent of whatever pdfjs-dist version npm actually
 * resolved. Poppler's `pdftoppm` is a system binary, not an npm
 * dependency, so it sidesteps that whole class of problem entirely.
 *
 * Requirement: `pdftoppm` (part of poppler-utils) must be installed on
 * whatever machine runs this — `brew install poppler` locally on macOS.
 * NOT included in Cloud Run's default Node buildpack — a Dockerfile-based
 * deploy installing poppler-utils via apt-get is needed before this can
 * run in production. See pdfRasterize.js's own header for detail.
 */

const { rasterizePDF } = require("./pdfRasterize");
const { extractFromImages } = require("./groqVisionExtractor");

async function extractViaVision(fileBuffer) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set — vision fallback cannot run.");
  }

  const pageImages = await rasterizePDF(fileBuffer);
  if (pageImages.length === 0) {
    throw new Error("Could not render any pages from this PDF.");
  }

  const { rows, notesText } = await extractFromImages(pageImages, apiKey);

  // groqVisionExtractor.js doesn't currently track a skipped-row count —
  // it silently drops rows with an unparseable amount. skippedCount isn't
  // part of the locked response contract (it's an internal-only field
  // elsewhere in the pipeline), so this is approximated as 0 rather than
  // modifying that module's already-reviewed behavior to add tracking.
  return { rows, skippedCount: 0, notesText };
}

module.exports = { extractViaVision };