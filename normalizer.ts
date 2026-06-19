// ─── PrepMind AI – Text Normalization ────────────────────────────────────────

import { FILLER_WORDS } from "../config";

const MARKS_TEXT_PATTERN =
  /\[?\(?\d+\s*(?:marks?)?\)?\]?/gi;

const QUESTION_NUMBER_PATTERN =
  /^(?:Q\.?\s*\d+[\.\):]?\s*|Question\s*\d+[\.\):]?\s*|\d{1,3}[\.\)]\s*|[a-z][\.\)]\s*|\([a-z]\)\s*|\([ivxIVX]+\)\s*)/i;

/**
 * Normalizes a question string for exact / fuzzy comparison.
 *
 * Steps:
 * 1. Lowercase
 * 2. Remove question numbers
 * 3. Remove marks notation
 * 4. Remove punctuation (keep spaces)
 * 5. Remove filler words
 * 6. Collapse whitespace
 */
export function normalizeQuestion(text: string): string {
  let t = text.toLowerCase();

  // Remove leading question number
  t = t.replace(QUESTION_NUMBER_PATTERN, "");

  // Remove marks text like [5 marks], (3 marks), 2 marks
  t = t.replace(MARKS_TEXT_PATTERN, "");

  // Remove punctuation – keep letters, digits, spaces
  t = t.replace(/[^\w\s]/g, " ");

  // Remove digits that are standalone (leftover numbers)
  t = t.replace(/\b\d+\b/g, " ");

  // Tokenize, filter filler words
  const tokens = t
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !FILLER_WORDS.has(w));

  return tokens.join(" ").trim();
}
