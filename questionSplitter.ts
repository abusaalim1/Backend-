// ─── PrepMind AI – Question Splitter ─────────────────────────────────────────

import { v4 as uuid } from "uuid";
import type { Question, QuestionType } from "../types";

/**
 * Regex patterns to detect the START of a new question.
 * Order matters – more specific first.
 */
const QUESTION_START_PATTERNS: RegExp[] = [
  /^(Q\.?\s*\d+[\.\):])/i,              // Q1. Q1) Q.1:
  /^(Question\s*\d+[\.\):]?)/i,         // Question 1.
  /^(\d{1,3}[\.\)]\s)/,                 // 1. 2) 23.
  /^([a-z]\)\s)/i,                      // a) b) c)
  /^(\([a-z]\)\s)/i,                    // (a) (b)
  /^(\([ivxIVX]+\)\s)/,                 // (i) (ii) (iii)
];

const MARKS_PATTERN =
  /\[(\d+)\s*(?:marks?)?\]|\((\d+)\s*(?:marks?)?\)|(\d+)\s*marks?/i;

const SECTION_PATTERN =
  /^(?:section|part|unit)\s*[a-zA-Z0-9]+/i;

/** Detect approximate question type from text */
function detectType(text: string): QuestionType {
  const t = text.toLowerCase();
  if (/\(a\)|\(b\)|\(c\)|\(d\)|options?:/.test(t)) return "multiple_choice";
  if (/true or false|state whether/.test(t)) return "true_false";
  if (/fill in|blank/.test(t)) return "fill_in_blank";
  if (/calculate|find the value|solve|evaluate|compute/.test(t))
    return "numerical";
  if (/draw|sketch|label|diagram/.test(t)) return "diagram";
  if (/define|what is|state|name|list|give|write/.test(t))
    return "short_answer";
  if (/explain|describe|discuss|differentiate|compare|elaborate/.test(t))
    return "long_answer";
  return "unknown";
}

/** Extract marks value from question text */
function extractMarks(text: string): number | null {
  const m = text.match(MARKS_PATTERN);
  if (!m) return null;
  const val = parseInt(m[1] || m[2] || m[3], 10);
  return isNaN(val) ? null : val;
}

/** Clean question text – strip marks notation, leading number, excess spaces */
function cleanText(text: string): string {
  return text
    .replace(MARKS_PATTERN, "")
    .replace(/^(Q\.?\s*\d+[\.\):]?\s*|Question\s*\d+[\.\):]?\s*|\d{1,3}[\.\)]\s*)/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Detect section header from a line */
function detectSection(line: string): string | null {
  return SECTION_PATTERN.test(line.trim()) ? line.trim() : null;
}

/** Return true if a line looks like a question start */
function isQuestionStart(line: string): boolean {
  return QUESTION_START_PATTERNS.some((p) => p.test(line.trim()));
}

/**
 * Splits raw PDF text into an array of Question objects.
 */
export function splitIntoQuestions(
  rawText: string,
  sourceFile: string,
  sourcePaper: string
): Question[] {
  const lines = rawText.split("\n");
  const questions: Question[] = [];
  let currentLines: string[] = [];
  let currentSection: string | null = null;
  let questionNumber = "";

  const flushCurrent = () => {
    if (currentLines.length === 0) return;
    const original = currentLines.join(" ").replace(/\s+/g, " ").trim();
    if (original.length < 10) return; // too short – likely noise

    const cleaned = cleanText(original);
    if (cleaned.length < 6) return;

    questions.push({
      questionId: uuid(),
      questionNumber,
      originalText: original,
      cleanedText: cleaned,
      normalizedText: "",          // filled later by normalizeQuestion
      marks: extractMarks(original),
      section: currentSection,
      detectedType: detectType(cleaned),
      sourceFile,
      sourcePaper,
    });

    currentLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const maybeSection = detectSection(trimmed);
    if (maybeSection) {
      flushCurrent();
      currentSection = maybeSection;
      continue;
    }

    if (isQuestionStart(trimmed)) {
      flushCurrent();
      // Extract question number from the start
      const numMatch = trimmed.match(
        /^(?:Q\.?\s*)?(\d+|[a-z]|\([a-z]\)|\([ivxIVX]+\))/i
      );
      questionNumber = numMatch ? numMatch[1] : "";
      currentLines = [trimmed];
    } else if (currentLines.length > 0) {
      // Continuation of current question
      currentLines.push(trimmed);
    }
    // Lines before first question start are discarded (instructions etc.)
  }

  flushCurrent(); // flush last question

  return questions;
}
