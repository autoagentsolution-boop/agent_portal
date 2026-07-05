# Concept variants + reference image (2026-07-05)

Branch: pivot/video-content-farm. Two features on the flow between concept_writer and media.

## Decisions (user-confirmed)
- **Pause at concept**: after concept_writer generates 3-5 versions, the run HALTS for the
  user to pick one (+ optionally upload a reference image), then Continue → media/publish.
- **Reference image = reference-only for gen**: with a media step, an uploaded image conditions
  the infographic/storyboard generation (Gemini edit mode); no upload → text-to-image (current).
  With NO media step, the uploaded image becomes the post media directly. Optional, non-blocking.

## Slice 1 — concept variants + selection gate (backend)
- copygen: `buildVariantsBody(post, n)` (array responseSchema, "N distinct versions") + `parseVariants`.
- `generateVariantsForPost(postId, ownerId, n)` — sets post.copy = variants[0], status review.
- concept_writer stores `variants[] + chosen` on the content_concept artifact; does NOT auto-approve.
- executor SELECTION_GATE = {concept_writer}: after concept executes, park (node awaiting_approval,
  run needs_approval). On approve-node(concept): confirm (node completed) + continue downstream.
- `POST /posts/:id/select-variant { index }` → sets post.copy = variants[index] (via artifact).

## Slice 2 — reference image (backend)
- Migration: `Post.referenceImage String?` (local:<path>).
- `POST /posts/:id/reference-image { dataB64, mimeType, asHero? }` — save to disk; asHero=false →
  set referenceImage (gen conditioning); asHero=true → attachPostMedia('image') (own image = media).
  `DELETE` clears.
- infographic/storyboard: when post.referenceImage set → generateImage mode 'edit'
  referenceImagePath = the ref (all storyboard frames anchor on it). Else text-to-image.

## Slice 3 — UI (concept gate)
- PostWorkflowView: gateNode.agentId === 'concept_writer' → variant cards (radio-select) +
  ref-upload button (asHero = (no infographic/storyboard node downstream)) + Continue (approve-node).

## Open
- Variant count: LLM returns 3-5 (ask for 4, accept 3-5). Cost ≈ one copy call (bigger output).
