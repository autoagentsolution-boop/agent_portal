# Product Knowledge Library (next session)

Branch: pivot/video-content-farm. Builds on today's Product Knowledge feature (doc upload →
Gemini analysis → campaign.brandContext). Goal: make product knowledge a REUSABLE LIBRARY, not
a per-campaign one-off.

## User intent (verbatim, paraphrased)
- Product knowledge can be imported/updated at the POST level (add new info to an existing post).
- It can ALSO be imported from the MASTER AGENT — analyze ONCE up front → build a per-user
  **product library**.
- When creating a post, the user only does the initial analyze at the Master Agent; then in the
  post they can either **select from a dropdown** of existing product-knowledge entries OR
  **import more** (add another doc).

## Proposed model
- New entity `ProductKnowledge` (per user): { id, ownerId, name, productSummary, differentiators,
  targetAudience, proofPoints, brandVoice, language, sourceDocs?, createdAt, updatedAt }. Migration
  additive. (Today's analysis persists to campaign.brandContext — keep that as a fast path, but the
  library is the reusable store.)
- `campaign.productKnowledgeId` / `post.productKnowledgeId` FK (nullable) → link a post/campaign to
  a library entry. Resolution order for prompts: post.knowledge → campaign.knowledge →
  campaign.brandContext (legacy) → goal slot.

## Surfaces
- **Master Agent**: during setup, upload/analyze → create or update a library entry (name it after
  the product). The run's goal references it.
- **Product Library panel** (sidebar or settings): list/CRUD entries, re-analyze, merge new docs
  into an existing entry (append + re-summarize).
- **Post/Campaign**: a **dropdown** to pick an existing entry + an "import more" button that analyzes
  a new doc and either updates the selected entry or creates a new one.

## Reuse from today
- `analyze-documents.ts` (the Gemini multimodal analyzer) — unchanged; just route its output into a
  library entry instead of only campaign.brandContext.
- `product-knowledge-upload.tsx` — generalize to target a library entry (not just a campaign).
- `resolveProductKnowledge` (agent-runners) — extend the resolution chain to read the linked entry.

## Also carry over (still open)
- Phase 5 from the prior plan: deepen mandatory questions (Language/Length/Asset-type/Brand-voice,
  raise the thin-product bar) — now partly satisfied by the library dropdown.
- Roll doc-analysis cost into a persistent per-campaign/flow running total (today: shown per-upload).
- Optionally: upload in the Orchestrate chat (capture knowledge during the initial flow).

## Open questions
- Merge semantics when importing a second doc into an existing entry (append raw + re-summarize, or
  diff-merge?).
- DOCX support (needs a text extractor — deferred today).
