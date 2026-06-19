// ─── PrepMind AI – Semantic Analysis via OpenRouter (Gemini) ─────────────────

import { v4 as uuid } from "uuid";
import { OPENROUTER_API_KEY, OPENROUTER_BASE_URL, AI_MODEL, SEMANTIC_BATCH_SIZE } from "../config";
import type { Question, RepeatedGroup, SimilarityPair } from "../types";

interface GeminiGroup {
  concept: string;
  questionIndices: number[];
  confidence: number; // 0–1
}

interface GeminiResponse {
  groups: GeminiGroup[];
}

/**
 * Calls OpenRouter / Gemini to semantically cluster candidate question pairs.
 *
 * Strategy:
 * 1. Collect unique questions from candidate pairs
 * 2. Send them in batches to Gemini with a structured JSON prompt
 * 3. Parse Gemini's groupings → RepeatedGroup[]
 */
export async function findSemanticRepeatsWithGemini(
  candidatePairs: SimilarityPair[],
  subject: string
): Promise<RepeatedGroup[]> {
  if (candidatePairs.length === 0) return [];

  // Deduplicate questions from pairs
  const questionMap = new Map<string, Question>();
  for (const pair of candidatePairs) {
    questionMap.set(pair.questionA.questionId, pair.questionA);
    questionMap.set(pair.questionB.questionId, pair.questionB);
  }
  const uniqueQuestions = [...questionMap.values()];

  if (uniqueQuestions.length < 2) return [];

  const allGroups: RepeatedGroup[] = [];

  // Process in batches to stay within token limits
  for (let start = 0; start < uniqueQuestions.length; start += SEMANTIC_BATCH_SIZE) {
    const batch = uniqueQuestions.slice(start, start + SEMANTIC_BATCH_SIZE);
    try {
      const groups = await callGeminiForBatch(batch, subject);
      allGroups.push(...groups);
    } catch (err: any) {
      console.warn(`[PrepMind] Gemini batch ${start} failed: ${err?.message}`);
      // Continue with remaining batches
    }
  }

  return mergeOverlappingGroups(allGroups);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function callGeminiForBatch(
  questions: Question[],
  subject: string
): Promise<RepeatedGroup[]> {
  const numbered = questions.map((q, i) => `[${i}] ${q.cleanedText}`).join("\n");

  const prompt = `You are an expert ${subject} educator analyzing exam question papers.

Below are ${questions.length} exam questions (each prefixed with its index number):

${numbered}

Task:
1. Find groups of questions that test the SAME concept or topic, even if worded differently.
2. Only group questions if they are genuinely about the same concept.
3. A question can belong to at most ONE group.
4. Do NOT group questions that are merely from the same topic area — they must test the SAME specific concept.

Respond ONLY with valid JSON in this exact structure (no markdown, no explanation):
{
  "groups": [
    {
      "concept": "Short concept name (e.g. 'Laws of Motion - Newton's Third Law')",
      "questionIndices": [0, 3, 7],
      "confidence": 0.92
    }
  ]
}

If no meaningful groups are found, return: {"groups": []}`;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://prepmind.ai",
      "X-Title": "PrepMind AI",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 1500,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`OpenRouter API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const rawText: string =
    data?.choices?.[0]?.message?.content || "";

  let parsed: GeminiResponse;
  try {
    const clean = rawText.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${rawText.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed?.groups)) return [];

  const groups: RepeatedGroup[] = [];

  for (const g of parsed.groups) {
    if (!g.questionIndices || g.questionIndices.length < 2) continue;

    const qs = g.questionIndices
      .filter((i: number) => i >= 0 && i < questions.length)
      .map((i: number) => questions[i]);

    if (qs.length < 2) continue;

    const papers = [...new Set(qs.map((q) => q.sourcePaper))];
    const totalMarks = qs.reduce((s, q) => s + (q.marks ?? 0), 0);

    groups.push({
      groupId: uuid(),
      matchType: "semantic",
      concept: g.concept || "Unknown Concept",
      frequency: qs.length,
      questions: qs,
      similarityScore: g.confidence ?? 0.8,
      totalMarks,
      appearedInPapers: papers,
    });
  }

  return groups;
}

/** Merge groups that share any question (avoid duplicates across batches) */
function mergeOverlappingGroups(groups: RepeatedGroup[]): RepeatedGroup[] {
  const merged: RepeatedGroup[] = [];
  const assignedIds = new Set<string>();

  for (const g of groups) {
    const overlap = g.questions.some((q) => assignedIds.has(q.questionId));
    if (overlap) continue; // skip – question already in another group

    for (const q of g.questions) assignedIds.add(q.questionId);
    merged.push(g);
  }

  return merged;
}
