// ─── PrepMind AI – Config ────────────────────────────────────────────────────

export const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY ||
  "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";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Using Google Gemini via OpenRouter
export const AI_MODEL = "google/gemini-2.0-flash-001";

export const FUZZY_SIMILARITY_THRESHOLD = 0.72;   // 0–1
export const SEMANTIC_BATCH_SIZE = 15;             // questions per Gemini call
export const MAX_QUESTIONS_PER_PDF = 500;

// Common filler words to strip during normalization
export const FILLER_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "on", "at", "by", "for", "with", "about",
  "against", "between", "into", "through", "during", "before", "after",
  "above", "below", "from", "up", "down", "out", "off", "over", "under",
  "again", "further", "then", "once", "and", "but", "or", "nor", "so",
  "yet", "both", "either", "neither", "not", "only", "own", "same",
  "than", "too", "very", "just", "because", "as", "until", "while",
  "although", "however", "therefore", "hence", "thus",
]);
