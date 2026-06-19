// ─── PrepMind AI – Similarity Algorithms ─────────────────────────────────────

import { v4 as uuid } from "uuid";
import { FUZZY_SIMILARITY_THRESHOLD } from "../config";
import type { Question, RepeatedGroup, SimilarityPair } from "../types";

// ─── Exact Duplicate Detection ───────────────────────────────────────────────

/**
 * Groups questions whose normalizedText is identical.
 */
export function findExactRepeats(questions: Question[]): RepeatedGroup[] {
  const map = new Map<string, Question[]>();

  for (const q of questions) {
    const key = q.normalizedText;
    if (!key || key.length < 5) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(q);
  }

  const groups: RepeatedGroup[] = [];
  for (const [, qs] of map) {
    if (qs.length < 2) continue;
    groups.push(buildGroup(qs, "exact", 1.0));
  }

  return groups;
}

// ─── Fuzzy Similarity (Jaccard + Levenshtein blend) ─────────────────────────

/** Jaccard similarity on word-sets */
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/** Simple Levenshtein distance */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Normalized edit distance similarity (0–1) */
function editSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Blended score: 60% Jaccard + 40% edit similarity */
export function blendedSimilarity(a: string, b: string): number {
  return 0.6 * jaccardSimilarity(a, b) + 0.4 * editSimilarity(a, b);
}

/**
 * Finds fuzzy-similar question pairs, then clusters them into groups
 * using union-find so transitive similarities are captured.
 *
 * Skips pairs already in an exact-match group.
 */
export function findFuzzyRepeats(
  questions: Question[],
  exactGroups: RepeatedGroup[]
): RepeatedGroup[] {
  // Build set of question IDs already covered by exact groups
  const exactIds = new Set<string>();
  for (const g of exactGroups) {
    for (const q of g.questions) exactIds.add(q.questionId);
  }

  const eligible = questions.filter((q) => !exactIds.has(q.questionId));
  if (eligible.length < 2) return [];

  // Union-Find
  const parent = new Map<string, string>();
  const getRoot = (id: string): string => {
    if (parent.get(id) !== id) parent.set(id, getRoot(parent.get(id)!));
    return parent.get(id)!;
  };
  const union = (a: string, b: string) => {
    parent.set(getRoot(a), getRoot(b));
  };
  for (const q of eligible) parent.set(q.questionId, q.questionId);

  // Compare all pairs (O(n²) – acceptable for ≤500 questions per paper set)
  const pairScores = new Map<string, number>(); // "idA|idB" → score

  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i].normalizedText;
      const b = eligible[j].normalizedText;
      if (!a || !b || a.length < 5 || b.length < 5) continue;

      const score = blendedSimilarity(a, b);
      if (score >= FUZZY_SIMILARITY_THRESHOLD) {
        union(eligible[i].questionId, eligible[j].questionId);
        pairScores.set(`${eligible[i].questionId}|${eligible[j].questionId}`, score);
      }
    }
  }

  // Cluster by root
  const clusters = new Map<string, Question[]>();
  for (const q of eligible) {
    const root = getRoot(q.questionId);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(q);
  }

  const groups: RepeatedGroup[] = [];
  for (const [, qs] of clusters) {
    if (qs.length < 2) continue;
    // Avg similarity score across pairs in this cluster
    let totalScore = 0, count = 0;
    for (let i = 0; i < qs.length; i++) {
      for (let j = i + 1; j < qs.length; j++) {
        const key = `${qs[i].questionId}|${qs[j].questionId}`;
        const revKey = `${qs[j].questionId}|${qs[i].questionId}`;
        const s = pairScores.get(key) ?? pairScores.get(revKey) ?? 0;
        totalScore += s; count++;
      }
    }
    const avgScore = count > 0 ? totalScore / count : FUZZY_SIMILARITY_THRESHOLD;
    groups.push(buildGroup(qs, "fuzzy", avgScore));
  }

  return groups;
}

// ─── Candidate pairs for Gemini ──────────────────────────────────────────────

/**
 * Returns question pairs that are similar enough (just below exact threshold)
 * to be worth sending to Gemini for semantic judgment.
 */
export function getCandidatePairsForSemantic(
  questions: Question[],
  exactGroups: RepeatedGroup[],
  fuzzyGroups: RepeatedGroup[]
): SimilarityPair[] {
  const coveredIds = new Set<string>();
  [...exactGroups, ...fuzzyGroups].forEach((g) =>
    g.questions.forEach((q) => coveredIds.add(q.questionId))
  );

  const uncovered = questions.filter((q) => !coveredIds.has(q.questionId));
  const pairs: SimilarityPair[] = [];

  // Lower threshold for Gemini candidates (0.45–0.71)
  const LOW = 0.45;
  const HIGH = FUZZY_SIMILARITY_THRESHOLD - 0.01;

  for (let i = 0; i < uncovered.length; i++) {
    for (let j = i + 1; j < uncovered.length; j++) {
      const a = uncovered[i].normalizedText;
      const b = uncovered[j].normalizedText;
      if (!a || !b) continue;
      const score = jaccardSimilarity(a, b);
      if (score >= LOW && score <= HIGH) {
        pairs.push({ questionA: uncovered[i], questionB: uncovered[j], score });
      }
    }
  }

  return pairs;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildGroup(
  questions: Question[],
  matchType: RepeatedGroup["matchType"],
  similarityScore: number
): RepeatedGroup {
  const papers = [...new Set(questions.map((q) => q.sourcePaper))];
  const totalMarks = questions.reduce((s, q) => s + (q.marks ?? 0), 0);
  return {
    groupId: uuid(),
    matchType,
    frequency: questions.length,
    questions,
    similarityScore,
    totalMarks,
    appearedInPapers: papers,
  };
}
