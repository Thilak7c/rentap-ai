/**
 * PII Detection & Masking module
 * ---------------------------------
 * Scope: financial reports (PDF/spreadsheet extracted text or structured rows)
 *
 * Detects and masks:
 *  - Malaysian IC numbers (e.g. 990101-14-5566)
 *  - Bank / account-number-like digit sequences (8-16 digits, with optional
 *    spaces/dashes)
 *  - Basic "Name:"-labelled personal names (heuristic, not NLP-based —
 *    intentionally conservative to avoid false positives on business terms)
 *  - Email addresses (bonus — common in report headers/footers)
 *  - Malaysian phone numbers
 *
 * Design notes:
 *  - Pure regex, no external deps, no API calls — deterministic, fast,
 *    explainable (matches the "explainability-first" philosophy used
 *    elsewhere in this project).
 *  - Every match returned includes WHICH rule matched and the original
 *    span position, so the frontend can show "2 fields masked for privacy"
 *    with real evidence rather than a blind claim.
 *  - Masking replaces matched text with a fixed-length placeholder like
 *    [REDACTED:IC] rather than partial masking, to avoid leaking partial
 *    digits that could still be sensitive.
 */

const RULES = [
  {
    type: "IC",
    label: "Malaysian IC Number",
    // 6 digits - 2 digits - 4 digits (YYMMDD-PB-XXXX)
    regex: /\b\d{6}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  },
  {
    type: "PHONE",
    label: "Malaysian Phone Number",
    // 01X-XXXXXXX or 01X-XXXXXXXX, with optional +60 prefix
    regex: /\b(?:\+?60|0)1[0-9][-\s]?\d{3}[-\s]?\d{4,5}\b/g,
  },
  {
    type: "EMAIL",
    label: "Email Address",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    type: "ACCOUNT",
    label: "Bank Account Number",
    // 8-16 digit sequences, optionally grouped with spaces/dashes.
    // Negative lookbehind excludes digit runs glued to a preceding hyphen
    // (e.g. "INV-2026-0442") so invoice/reference codes aren't misflagged.
    // Applied AFTER IC/PHONE so those more-specific patterns get first claim
    // on a given span (see maskText for the conflict resolution logic).
    regex: /(?<!-)\b\d[\d\s-]{7,17}\d\b/g,
  },
  {
    type: "NAME",
    label: "Labelled Personal Name",
    // Conservative: only flags names that are explicitly labelled
    // (e.g. "Name: John Tan", "Employee: Siti Aminah binti Ahmad").
    // [ \t]+ (not \s+) deliberately excludes newlines so the match can't
    // bleed into the next line/label. Deliberately does NOT attempt
    // free-text name detection — that needs an NLP model and would produce
    // too many false positives/negatives for a rule-based pass to trust.
    regex: /\b(?:Name|Employee|Applicant|Account Holder|Prepared by|Reviewed by|Approved by)[ \t]*:[ \t]*([A-Z][a-zA-Z'.-]+(?:[ \t]+[A-Z][a-zA-Z'.-]+){0,4})/g,
    captureGroup: 1, // only mask the captured name, not the "Name:" label
  },
];

/**
 * Scans text and returns all PII matches found, without modifying the text.
 * Useful for reporting ("2 fields would be masked") before committing.
 */
function detectPII(text) {
  if (!text || typeof text !== "string") return [];

  const matches = [];

  for (const rule of RULES) {
    // Reset lastIndex since regex objects with /g are stateful across calls
    rule.regex.lastIndex = 0;
    let match;
    while ((match = rule.regex.exec(text)) !== null) {
      const matchedText = rule.captureGroup
        ? match[rule.captureGroup]
        : match[0];
      const start = rule.captureGroup
        ? match.index + match[0].indexOf(matchedText)
        : match.index;

      matches.push({
        type: rule.type,
        label: rule.label,
        value: matchedText,
        start,
        end: start + matchedText.length,
      });
    }
  }

  // Sort by position, then resolve overlaps: keep the earliest-starting,
  // longest match when two rules claim overlapping spans (e.g. a phone
  // number could otherwise also loosely match the ACCOUNT digit pattern).
  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  const resolved = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      resolved.push(m);
      lastEnd = m.end;
    }
    // else: overlaps a higher-priority match already kept, skip it
  }

  return resolved;
}

/**
 * Returns masked text plus a summary of what was masked (for UI display).
 */
function maskText(text) {
  const found = detectPII(text);
  if (found.length === 0) {
    return { maskedText: text, maskedCount: 0, matches: [] };
  }

  // Rebuild the string, replacing matched spans back-to-front so earlier
  // indices stay valid as we splice.
  let result = text;
  for (let i = found.length - 1; i >= 0; i--) {
    const m = found[i];
    const placeholder = `[REDACTED:${m.type}]`;
    result = result.slice(0, m.start) + placeholder + result.slice(m.end);
  }

  return {
    maskedText: result,
    maskedCount: found.length,
    matches: found.map(({ type, label, start, end }) => ({
      type,
      label,
      start,
      end,
      // NOTE: original value intentionally omitted from the returned
      // summary — the whole point is not to re-expose what was redacted.
    })),
  };
}

/**
 * Convenience for structured row data (e.g. extracted spreadsheet rows):
 * masks every string field in every row, returns masked rows + a combined
 * summary count. Non-string values pass through untouched.
 *
 * Each row SHOULD have an `id` field (matches the row IDs used elsewhere
 * in the pipeline) — if present, match entries include `rowId` so the
 * caller can trace which specific row a masked field came from, per the
 * locked data contract's `privacy.matches[].rowId` requirement. If a row
 * has no `id`, matches for it fall back to `rowId: null` rather than
 * throwing, so this function stays usable standalone/in tests without
 * needing fully-shaped rows.
 */
function maskRows(rows) {
  let totalMasked = 0;
  const allMatches = [];

  const maskedRows = rows.map((row) => {
    const maskedRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string") {
        const { maskedText, maskedCount, matches } = maskText(value);
        maskedRow[key] = maskedText;
        totalMasked += maskedCount;
        if (matches.length) {
          allMatches.push({
            field: key,
            rowId: row.id !== undefined ? row.id : null,
            matches,
          });
        }
      } else {
        maskedRow[key] = value;
      }
    }
    return maskedRow;
  });

  return { maskedRows, maskedCount: totalMasked, matches: allMatches };
}

module.exports = { detectPII, maskText, maskRows };
