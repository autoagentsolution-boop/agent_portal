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

---

## Additional items added by user (2026-07-05, for tomorrow)

### 1. Per-platform asset-type support (carousel NOT universal)
Live publish error: `instagram does not support carousel | threads does not support
social.post.carousel | linkedin ... | x ...`. Carousel is only valid on some platforms (FB, and
per registry IG — but the runtime rejected IG too → RECHECK the connector registry's carousel
capability vs reality). Needed:
- Validate the post's assetType against EACH target platform's capabilities BEFORE publish; don't
  send carousel to a platform that can't take it.
- Ties directly into per-platform asset type (#4 from `260705-1846-...` plan): a post may need a
  different asset per platform (carousel on FB, single image on LinkedIn/X/Threads).

### 2. Publisher auto-runs by default — skip the Approve/Scheduler gate
Today `publisher.requiresApproval=true` halts for manual approval. User wants it to **auto-run by
default** (no Approve/schedule step). Options: flip the default (a per-flow/global "auto-publish"
setting), keep the gate only when a platform/format needs attention. NOTE: this loosens the
"nothing publishes until you approve" safety — confirm the demo-vs-safety intent. The pre-VIDEO
cost gate stays (that's a separate, cost-driven halt).

### 3. Publish step = a per-platform postability REVIEW
Instead of a bare approve button, the publish step should show a **review**: for each target
platform, can it post THIS format (assetType) given the user's setup/connection? Surface
compatible vs incompatible platforms (and why) so the user sees exactly what will go where. This
replaces the opaque gate with an informative pre-publish check (pairs with items 1 + 2).

### 4. Copy-gen vs concept_writer — duplicated?
`concept_writer` wraps `generateForPost` (copy-gen). Review whether they're redundant: is
concept_writer just an orchestration adapter around copy-gen, or is there real duplication to
consolidate? Decide: merge, or clearly document the boundary (concept_writer = DAG node seam,
copy-gen = the reusable copy engine). Check for divergent prompt/behavior between the two paths.
