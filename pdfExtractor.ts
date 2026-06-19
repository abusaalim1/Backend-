// ─── PrepMind AI – PDF Text Extraction ───────────────────────────────────────
// Uses pdf-parse (lightweight, no native deps) for Node.js / Next.js API routes

import pdfParse from "pdf-parse";

/**
 * Patterns to strip – page numbers, headers, footers, watermarks.
 * Keep flexible so it works for any board / subject.
 */
const NOISE_PATTERNS: RegExp[] = [
  /^\s*page\s*\d+\s*(of\s*\d+)?\s*$/gim,          // "Page 1 of 10"
  /^\s*\d+\s*$/gm,                                  // lone page numbers
  /^\s*-\s*\d+\s*-\s*$/gm,                          // "- 3 -"
  /confidential|draft|sample|watermark/gi,           // common watermarks
  /^\s*(www\.|http)\S+\s*$/gim,                     // URLs as headers
  /^\s*all rights reserved.*$/gim,
  /^\s*printed by.*$/gim,
  /^\s*downloaded from.*$/gim,
  /\f/g,                                             // form-feed chars
];

/**
 * Extracts readable text from a PDF buffer.
 * Preserves question-number lines; strips noise.
 *
 * @throws Error with .code === "EMPTY_PDF" | "SCANNED_PDF" | "CORRUPT_PDF"
 */
export async function extractTextFromPDF(fileBuffer: Buffer): Promise<string> {
  if (!fileBuffer || fileBuffer.length === 0) {
    const err = new Error("PDF buffer is empty.");
    (err as any).code = "EMPTY_PDF";
    throw err;
  }

  let data: pdfParse.Result;
  try {
    data = await pdfParse(fileBuffer, {
      // Don't render individual page functions – keep it fast
      pagerender: undefined,
    });
  } catch (e: any) {
    const err = new Error(`Failed to parse PDF: ${e?.message || "unknown"}`);
    (err as any).code = "CORRUPT_PDF";
    throw err;
  }

  let raw = data.text || "";

  if (raw.trim().length < 50) {
    const err = new Error(
      "No extractable text found. The PDF may be scanned or image-based."
    );
    (err as any).code = "SCANNED_PDF";
    throw err;
  }

  // Strip noise patterns
  for (const pattern of NOISE_PATTERNS) {
    raw = raw.replace(pattern, "");
  }

  // Collapse 3+ consecutive newlines → 2
  raw = raw.replace(/\n{3,}/g, "\n\n");

  // Remove non-printable characters except newline/tab
  raw = raw.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]/g, " ");

  return raw.trim();
}
