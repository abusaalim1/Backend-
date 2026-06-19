// ─── PrepMind AI – Main Analyzer ─────────────────────────────────────────────
// analyzeQuestionPapers() is the ONLY function your app needs to call.

import { v4 as uuid } from "uuid";
import { extractTextFromPDF } from "./pdfExtractor";
import { splitIntoQuestions } from "./questionSplitter";
import { normalizeQuestion } from "./normalizer";
import {
  findExactRepeats,
  findFuzzyRepeats,
  getCandidatePairsForSemantic,
} from "./similarity";
import { findSemanticRepeatsWithGemini } from "./semanticAnalyzer";
import {
  generateImportantQuestions,
  buildTopicFrequency,
  buildChapterWeightage,
} from "./importanceEngine";
import { MAX_QUESTIONS_PER_PDF } from "../config";
import type {
  AnalysisInput,
  AnalysisOutput,
  Question,
  RepeatedGroup,
  DebugInfo,
} from "../types";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * analyzeQuestionPapers
 *
 * Accepts 2–5 question paper PDFs as Buffers + metadata.
 * Returns structured JSON ready to save to Firestore.
 *
 * @example
 * const result = await analyzeQuestionPapers({
 *   files: [
 *     { buffer: buf1, fileName: "2022_paper.pdf", year: "2022" },
 *     { buffer: buf2, fileName: "2023_paper.pdf", year: "2023" },
 *   ],
 *   userId: "uid_abc123",
 *   board: "ICSE",
 *   className: "10",
 *   subject: "Mathematics",
 *   years: ["2022", "2023"],
 * });
 */
export async function analyzeQuestionPapers(
  input: AnalysisInput
): Promise<AnalysisOutput> {
  const startTime = Date.now();
  const warnings: string[] = [];
  const analysisId = uuid();

  validateInput(input);

  // ── 1. Extract text from each PDF ─────────────────────────────────────────
  const allQuestions: Question[] = [];
  const paperNames: string[] = [];

  for (const file of input.files) {
    const paperName = file.fileName.replace(/\.pdf$/i, "");
    paperNames.push(paperName);

    let rawText: string;
    try {
      rawText = await extractTextFromPDF(file.buffer);
    } catch (err: any) {
      const code: string = err?.code || "UNKNOWN";
      warnings.push(`[${file.fileName}] Skipped – ${code}: ${err?.message}`);
      continue;
    }

    // ── 2. Split into questions ──────────────────────────────────────────────
    const questions = splitIntoQuestions(rawText, file.fileName, paperName);

    if (questions.length === 0) {
      warnings.push(`[${file.fileName}] No questions detected after splitting.`);
      continue;
    }

    if (questions.length > MAX_QUESTIONS_PER_PDF) {
      warnings.push(
        `[${file.fileName}] Truncated to ${MAX_QUESTIONS_PER_PDF} questions (found ${questions.length}).`
      );
      questions.splice(MAX_QUESTIONS_PER_PDF);
    }

    // ── 3. Normalize ─────────────────────────────────────────────────────────
    for (const q of questions) {
      q.normalizedText = normalizeQuestion(q.cleanedText);
    }

    allQuestions.push(...questions);
  }

  if (allQuestions.length === 0) {
    return buildEmptyOutput(analysisId, input, warnings, startTime);
  }

  // ── 4. Exact duplicates ───────────────────────────────────────────────────
  const exactGroups = findExactRepeats(allQuestions);

  // ── 5. Fuzzy duplicates ───────────────────────────────────────────────────
  const fuzzyGroups = findFuzzyRepeats(allQuestions, exactGroups);

  // ── 6. Semantic analysis (Gemini) ─────────────────────────────────────────
  const candidatePairs = getCandidatePairsForSemantic(
    allQuestions,
    exactGroups,
    fuzzyGroups
  );

  let semanticGroups: RepeatedGroup[] = [];
  try {
    semanticGroups = await findSemanticRepeatsWithGemini(
      candidatePairs,
      input.subject
    );
  } catch (err: any) {
    warnings.push(`Gemini semantic analysis failed: ${err?.message}. Proceeding without it.`);
  }

  // ── 7. Merge all groups ───────────────────────────────────────────────────
  const allGroups: RepeatedGroup[] = [
    ...exactGroups,
    ...fuzzyGroups,
    ...semanticGroups,
  ];

  // ── 8. Important questions ────────────────────────────────────────────────
  const importantQuestions = generateImportantQuestions(
    allGroups,
    input.files.length
  );

  // ── 9. Topic & chapter analysis ───────────────────────────────────────────
  const topicFrequency = buildTopicFrequency(allQuestions, allGroups);
  const chapterWeightage = buildChapterWeightage(allQuestions);

  // ── 10. Build debug info ──────────────────────────────────────────────────
  const debugInfo: DebugInfo = {
    totalPapers: input.files.length,
    totalQuestionsExtracted: allQuestions.length,
    exactMatchesFound: exactGroups.reduce((s, g) => s + g.questions.length, 0),
    fuzzyMatchesFound: fuzzyGroups.reduce((s, g) => s + g.questions.length, 0),
    semanticMatchesFound: semanticGroups.reduce((s, g) => s + g.questions.length, 0),
    groupsSaved: allGroups.length,
    warnings,
    processingTimeMs: Date.now() - startTime,
  };

  return {
    analysisId,
    userId: input.userId,
    board: input.board,
    className: input.className,
    subject: input.subject,
    years: input.years,
    createdAt: new Date().toISOString(),
    papersAnalyzed: paperNames.length,
    totalQuestions: allQuestions.length,
    repeatedQuestionGroups: allGroups,
    importantQuestions,
    topicFrequency,
    chapterWeightage,
    debugInfo,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateInput(input: AnalysisInput): void {
  if (!input.files || input.files.length < 2) {
    throw new Error("At least 2 PDF files are required for analysis.");
  }
  if (input.files.length > 5) {
    throw new Error("Maximum 5 PDF files are supported per analysis.");
  }
  if (!input.userId) throw new Error("userId is required.");
  if (!input.subject) throw new Error("subject is required.");
}

function buildEmptyOutput(
  analysisId: string,
  input: AnalysisInput,
  warnings: string[],
  startTime: number
): AnalysisOutput {
  return {
    analysisId,
    userId: input.userId,
    board: input.board,
    className: input.className,
    subject: input.subject,
    years: input.years,
    createdAt: new Date().toISOString(),
    papersAnalyzed: 0,
    totalQuestions: 0,
    repeatedQuestionGroups: [],
    importantQuestions: [],
    topicFrequency: [],
    chapterWeightage: [],
    debugInfo: {
      totalPapers: input.files.length,
      totalQuestionsExtracted: 0,
      exactMatchesFound: 0,
      fuzzyMatchesFound: 0,
      semanticMatchesFound: 0,
      groupsSaved: 0,
      warnings: [
        ...warnings,
        "No questions could be extracted from the uploaded PDFs.",
      ],
      processingTimeMs: Date.now() - startTime,
    },
  };
}
