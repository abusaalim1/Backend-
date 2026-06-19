// ─── PrepMind AI – Important Questions Engine ────────────────────────────────

import type {
  Question,
  RepeatedGroup,
  ImportantQuestion,
  TopicFrequency,
  ChapterWeightage,
} from "../types";

interface ScoringWeights {
  frequency: number;      // how many times repeated
  marks: number;          // marks value
  multiPaper: number;     // appeared in multiple papers
  highMarks: number;      // bonus for high-mark questions (≥5)
}

const WEIGHTS: ScoringWeights = {
  frequency: 30,
  marks: 20,
  multiPaper: 35,
  highMarks: 15,
};

/**
 * Generates an importance score (0–100) for a question group.
 * Higher = more important for revision.
 */
function scoreGroup(group: RepeatedGroup, totalPapers: number): number {
  let score = 0;

  // Frequency score (normalized to max 5 occurrences)
  const freqScore = Math.min(group.frequency / 5, 1) * WEIGHTS.frequency;
  score += freqScore;

  // Marks score (normalized to max 10 marks)
  const avgMarks = group.questions.reduce((s, q) => s + (q.marks ?? 2), 0) / group.questions.length;
  const marksScore = Math.min(avgMarks / 10, 1) * WEIGHTS.marks;
  score += marksScore;

  // Multi-paper score
  const paperSpread = group.appearedInPapers.length / Math.max(totalPapers, 1);
  const multiPaperScore = Math.min(paperSpread, 1) * WEIGHTS.multiPaper;
  score += multiPaperScore;

  // High-marks bonus
  if (avgMarks >= 5) score += WEIGHTS.highMarks;

  return Math.round(Math.min(score, 100));
}

function buildReasons(group: RepeatedGroup, totalPapers: number): string[] {
  const reasons: string[] = [];
  const freq = group.frequency;
  const papers = group.appearedInPapers.length;
  const avgMarks = group.questions.reduce((s, q) => s + (q.marks ?? 0), 0) / group.questions.length;

  reasons.push(`Frequently appeared in ${freq} instance${freq > 1 ? "s" : ""} across uploaded papers`);

  if (papers > 1) {
    reasons.push(`Found in ${papers} out of ${totalPapers} uploaded paper${totalPapers > 1 ? "s" : ""}`);
  }

  if (avgMarks >= 5) {
    reasons.push(`High-weightage question (avg ${avgMarks.toFixed(0)} marks)`);
  }

  if (group.concept) {
    reasons.push(`Core concept: ${group.concept}`);
  }

  reasons.push("High priority for revision");

  return reasons;
}

/**
 * Builds the important questions list from all repeated groups.
 */
export function generateImportantQuestions(
  groups: RepeatedGroup[],
  totalPapers: number
): ImportantQuestion[] {
  const importantList: ImportantQuestion[] = [];

  for (const group of groups) {
    const score = scoreGroup(group, totalPapers);
    if (score < 20) continue; // skip very low importance

    // Pick the most representative question (longest cleanedText)
    const representative = [...group.questions].sort(
      (a, b) => b.cleanedText.length - a.cleanedText.length
    )[0];

    importantList.push({
      questionId: representative.questionId,
      question: representative,
      importanceScore: score,
      reasons: buildReasons(group, totalPapers),
      frequencyCount: group.frequency,
      appearedInPapers: group.appearedInPapers,
      relatedGroupId: group.groupId,
    });
  }

  // Sort by importance descending
  return importantList.sort((a, b) => b.importanceScore - a.importanceScore);
}

/**
 * Extracts topic frequency from all questions using keyword analysis.
 * No hardcoded topics – derived from most frequent meaningful words.
 */
export function buildTopicFrequency(
  questions: Question[],
  groups: RepeatedGroup[]
): TopicFrequency[] {
  // Use group concepts from Gemini where available
  const conceptMap = new Map<string, { count: number; totalMarks: number; papers: Set<string> }>();

  for (const g of groups) {
    if (!g.concept) continue;
    const key = g.concept;
    const existing = conceptMap.get(key) || { count: 0, totalMarks: 0, papers: new Set() };
    existing.count += g.frequency;
    existing.totalMarks += g.totalMarks;
    g.appearedInPapers.forEach((p) => existing.papers.add(p));
    conceptMap.set(key, existing);
  }

  // Also build topic frequency from normalized word frequency (top keywords)
  const wordFreq = new Map<string, { count: number; totalMarks: number; papers: Set<string> }>();
  for (const q of questions) {
    const words = q.normalizedText.split(" ").filter((w) => w.length > 4);
    for (const word of words) {
      const e = wordFreq.get(word) || { count: 0, totalMarks: 0, papers: new Set() };
      e.count++;
      e.totalMarks += q.marks ?? 0;
      e.papers.add(q.sourcePaper);
      wordFreq.set(word, e);
    }
  }

  // Merge concept-level (Gemini) and keyword-level
  const result: TopicFrequency[] = [];

  for (const [topic, data] of conceptMap) {
    result.push({
      topic,
      count: data.count,
      totalMarks: data.totalMarks,
      papers: [...data.papers],
    });
  }

  // Top 20 keywords not already covered by a concept
  const coveredWords = new Set(result.map((r) => r.topic.toLowerCase()));
  const sortedWords = [...wordFreq.entries()]
    .filter(([w]) => !coveredWords.has(w))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20);

  for (const [word, data] of sortedWords) {
    if (data.count < 2) continue; // only if repeated
    result.push({
      topic: word,
      count: data.count,
      totalMarks: data.totalMarks,
      papers: [...data.papers],
    });
  }

  return result.sort((a, b) => b.count - a.count);
}

/**
 * Builds chapter weightage from section + marks data.
 * Sections/chapters are derived from the PDF's own section headers.
 */
export function buildChapterWeightage(questions: Question[]): ChapterWeightage[] {
  const chapterMap = new Map<string, { count: number; totalMarks: number }>();

  for (const q of questions) {
    const chapter = q.section || "Unsectioned";
    const e = chapterMap.get(chapter) || { count: 0, totalMarks: 0 };
    e.count++;
    e.totalMarks += q.marks ?? 0;
    chapterMap.set(chapter, e);
  }

  const totalQuestions = questions.length || 1;
  const result: ChapterWeightage[] = [];

  for (const [chapter, data] of chapterMap) {
    result.push({
      chapter,
      questionCount: data.count,
      totalMarks: data.totalMarks,
      percentage: Math.round((data.count / totalQuestions) * 100),
    });
  }

  return result.sort((a, b) => b.questionCount - a.questionCount);
}
