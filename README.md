# PrepMind AI – Question Paper Analyzer

Backend utility for analyzing 2–5 exam question paper PDFs.
Finds repeated, similar, and important questions. Returns Firestore-ready JSON.

---

## File Structure

```
prepmind-ai/
├── src/
│   ├── index.ts                  ← import from here in Next.js
│   ├── types/index.ts            ← all TypeScript types
│   ├── config/index.ts           ← API keys, thresholds
│   └── core/
│       ├── analyzer.ts           ← main analyzeQuestionPapers() function
│       ├── pdfExtractor.ts       ← PDF → raw text
│       ├── questionSplitter.ts   ← raw text → Question[]
│       ├── normalizer.ts         ← text normalization
│       ├── similarity.ts         ← exact + fuzzy matching
│       ├── semanticAnalyzer.ts   ← Gemini via OpenRouter
│       └── importanceEngine.ts   ← scoring + topic/chapter analysis
├── examples/
│   └── api-route.ts              ← Next.js API route example
├── package.json
└── tsconfig.json
```

---

## Installation

### Step 1 – Copy files into your Next.js project

```bash
# Paste the folder into your project
cp -r prepmind-ai/ your-nextjs-app/lib/prepmind/
```

### Step 2 – Install dependencies

```bash
npm install pdf-parse uuid
npm install --save-dev @types/pdf-parse @types/uuid
```

### Step 3 – Environment variable (optional – key is already in config)

```env
# .env.local
OPENROUTER_API_KEY=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
```

### Step 4 – Create the API route

Copy `examples/api-route.ts` to:
```
your-nextjs-app/app/api/analyze/route.ts
```

Update the Firebase import to match your project's Firebase admin setup.

---

## Usage

```typescript
import { analyzeQuestionPapers } from "@/lib/prepmind/src/index";
import fs from "fs";

const result = await analyzeQuestionPapers({
  files: [
    { buffer: fs.readFileSync("paper_2022.pdf"), fileName: "paper_2022.pdf", year: "2022" },
    { buffer: fs.readFileSync("paper_2023.pdf"), fileName: "paper_2023.pdf", year: "2023" },
  ],
  userId: "firebase_uid_here",
  board: "ICSE",           // any board name
  className: "10",         // any class
  subject: "Mathematics",  // any subject
  years: ["2022", "2023"],
});

console.log(result);
// → save to Firestore: setDoc(doc(db, "analyses", result.analysisId), result)
```

---

## Output JSON Shape

```json
{
  "analysisId": "uuid",
  "userId": "uid",
  "board": "ICSE",
  "className": "10",
  "subject": "Mathematics",
  "years": ["2022", "2023"],
  "createdAt": "2025-01-01T00:00:00.000Z",
  "papersAnalyzed": 2,
  "totalQuestions": 84,

  "repeatedQuestionGroups": [
    {
      "groupId": "uuid",
      "matchType": "semantic",
      "concept": "Rational Numbers – Definition",
      "frequency": 3,
      "similarityScore": 0.91,
      "totalMarks": 9,
      "appearedInPapers": ["paper_2022", "paper_2023"],
      "questions": [...]
    }
  ],

  "importantQuestions": [
    {
      "questionId": "uuid",
      "importanceScore": 87,
      "reasons": [
        "Frequently appeared in 3 instances across uploaded papers",
        "Found in 2 out of 2 uploaded papers",
        "High priority for revision"
      ],
      "frequencyCount": 3,
      "appearedInPapers": ["paper_2022", "paper_2023"],
      "question": { ... }
    }
  ],

  "topicFrequency": [
    { "topic": "Rational Numbers – Definition", "count": 3, "totalMarks": 9, "papers": [...] }
  ],

  "chapterWeightage": [
    { "chapter": "Section A", "questionCount": 12, "totalMarks": 24, "percentage": 40 }
  ],

  "debugInfo": {
    "totalPapers": 2,
    "totalQuestionsExtracted": 84,
    "exactMatchesFound": 6,
    "fuzzyMatchesFound": 12,
    "semanticMatchesFound": 8,
    "groupsSaved": 14,
    "warnings": [],
    "processingTimeMs": 4200
  }
}
```

---

## Firestore Data Model (Recommended)

```
/analyses/{analysisId}     ← full result object
/users/{userId}/analyses   ← subcollection with analysisId refs
```

Security rules example:
```javascript
match /analyses/{analysisId} {
  allow read, write: if request.auth.uid == resource.data.userId;
}
```

---

## Error Handling

| Error Code     | Meaning                                   |
|----------------|-------------------------------------------|
| `EMPTY_PDF`    | Buffer is empty or 0 bytes                |
| `SCANNED_PDF`  | PDF has no text layer (image-only)        |
| `CORRUPT_PDF`  | PDF could not be parsed                   |

Scanned PDFs are skipped with a warning in `debugInfo.warnings`.
All other papers continue processing.

---

## Customization

| Setting                      | File              | Default |
|------------------------------|-------------------|---------|
| Fuzzy threshold              | `config/index.ts` | `0.72`  |
| Max questions per PDF        | `config/index.ts` | `500`   |
| Semantic batch size (Gemini) | `config/index.ts` | `15`    |
| AI model                     | `config/index.ts` | `google/gemini-2.0-flash-001` |

---

## Important Notes

- Minimum 2 PDFs, maximum 5 PDFs per call
- Scanned/image PDFs produce no text – they're skipped automatically
- Gemini failure is non-fatal – exact + fuzzy results are still returned
- No fake/demo data – everything comes from your actual uploaded PDFs
- No hardcoded subjects, boards, or class names
