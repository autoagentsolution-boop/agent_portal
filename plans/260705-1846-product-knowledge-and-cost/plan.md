# Product Knowledge (doc upload + Gemini analysis) + cost accounting

Branch: pivot/video-content-farm. Decision: full build (doc upload → Gemini multimodal → rich
product knowledge → feeds copy/image/video). Cost accounting covers media + analysis.

Transport decision: documents sent as **base64 in JSON** (no multipart/multer dep; Gemini
`inlineData` wants base64 anyway; route gets a 20mb body limit). Supported now: PDF, images
(png/jpg/webp), TXT/MD. DOCX deferred (needs a text extractor).

## Phase 1 — Backend core  [THIS PASS]
- `src/product-knowledge/analyze.ts` — Gemini `generateContent` with file parts (inlineData for
  pdf/images, text part for txt) + an extraction prompt → JSON product profile. Cost from REAL
  `usageMetadata` (first real-token plumbing; doc tokens counted) → NodeCost.
- `src/api/product-knowledge-router.ts` — `POST /product-knowledge/analyze` (auth, 20mb JSON):
  `{ files:[{name,mimeType,dataB64}], product?, campaignId? }` → `{ productDetails, brandVoice,
  language?, cost }`. If campaignId given, persist to `campaign.brandContext`.
- Register router in server.ts (before the global 1mb json limit, with its own parser).

## Phase 2 — Wire into the flow
- Analyzed knowledge fills `goal.slots.productDetails` (Orchestrate) / `campaign.brandContext`,
  so `goalContext` + `buildImagePrompt` (image/video subject) use the rich profile.
- Raise the thin-product bar so weak knowledge is re-asked (part of #3).

## Phase 3 — UI
- Upload control in the Orchestrate chat (📎) AND/OR a Product Knowledge panel: read files →
  base64 → POST → show extracted profile → user edits/confirms → fills the brief.

## Phase 4 — Cost accounting gaps (C)
- TTS voiceover cost (currently $0) ; concept_writer estimate uses goalContext not the real
  copy-gen prompt (undercounts) ; surface doc-analysis + master-agent analysis cost.
- Roll doc-analysis cost into the run/flow cost summary the dashboard shows.

## Phase 5 — Deepen mandatory questions (A)
- Structured product-knowledge asks (what/who/differentiator/proof/tone) + Language/Length/
  Asset-type/Brand-voice, smart-defaulted, one confirm — NOT a long form.
