# Diagnosis — user copy edits lost on concept re-run (copygen↔concept_writer merge)

## Confirmed mechanism
No edit-protection exists. `post.copy` is a plain JSON field; nothing marks it "user-touched".

1. User edits copy → `POST /posts/:id/edit-copy` → `editPostCopy` overwrites `post.copy`, status→review.
   Same for `POST /posts/:id/select-variant` (writes the chosen version to `post.copy` + `chosen` on artifact).
2. Any re-run that re-executes the concept node → `runConceptWriterForExistingPost` (agent-runners.ts:130):
   - resets `post.status` → `brief` (unconditionally, if not already brief/rework),
   - `finalizeConcept` → `generateVariantsForPost` (copygen/service.ts:200) →
     `updatePost({ copy: variants[0], status: review })` → **overwrites the user's edited/selected copy**
     and resets the active version to index 0.

So the merge (concept_writer's job IS to run copy-gen) means re-executing that node ALWAYS regenerates
copy — there is no "preserve if the user edited/selected it" branch.

## Scope ("all of them")
- Affects EVERY post that passes through concept_writer — systemic, not a one-off.
- Both loss modes: manual `/edit-copy` AND version choice `/select-variant` are wiped (chosen → 0).
- concept is the DAG root, so: re-running the flow from the top, or explicitly re-running the concept
  node, both wipe it. (Re-running only a downstream media node does NOT, since it doesn't reset concept.)
- Reference image (`setPostReferenceImage`) survives — finalizeConcept doesn't touch it.

## Root design gap
Two different user intents are conflated into one code path:
- "Regenerate the copy from scratch" (user WANTS new variants), vs
- "Continue the flow / re-run downstream" (user wants their edited+approved copy PRESERVED).
`runConceptWriterForExistingPost` always does the first.

## Fix options
**A — Explicit-intent guard (NO migration).** Preserve existing copy unless the concept node is the
EXPLICIT re-run target (`opts.rerunOnly === conceptNodeId`) or the post has no copy yet. On a flow-
continue, concept_writer emits the EXISTING copy/variants as its artifact instead of regenerating.
Smallest change; "re-run concept" still regenerates (matches "re-run this step").

**B — Edited flag (1 migration).** Add `post.copyEdited` (bool), set by edit-copy + select-variant,
cleared on an explicit regenerate. concept_writer skips regen when `copyEdited` is true (protects the
edit even against an explicit concept re-run — a separate "Regenerate copy" action clears the flag).
Strongest protection; needs a migration + a UI "regenerate" affordance.

**C — Both.** Flag for hard protection + explicit-intent guard for flow-continue. Most robust.

## Open questions
1. On an EXPLICIT "re-run concept" — should it regenerate (lose the edit) or preserve (option B)? i.e.
   is there a separate "Regenerate copy" button, or is re-run the only affordance?
2. Should downstream media (infographic/storyboard) also be preserved across a concept re-run, or is
   re-running concept expected to invalidate them?
