// Mirror a post's new copy onto its run's content_concept artifact.
//
// Three routes change a post's copy AFTER generation — /refine (LLM instruction), /edit-copy (hand
// edit) and /select-variant (pick a version) — and the workflow view renders the ARTIFACT, not
// post.copy, so each must push the change across or the edit appears to revert on reload.
//
// `keyMessage` is DERIVED from the body at generation time (agent-runners.ts: copy.body.slice(0,200))
// and is read back downstream — runStoryboard briefs its frames and video keyframes on it. Mirroring
// only `copy` left keyMessage pinned to the PRE-edit text, so a post refined to "40% off, ends Friday"
// still produced keyframes briefed on the original message. Re-derive it here with the same rule so
// the artifact stays internally consistent.
import { listArtifacts, updateArtifactData } from '../orchestration/executor/artifact-store.ts';

// Same rule as the generator — keep the two in lock-step.
export const deriveKeyMessage = (body: string): string => body.slice(0, 200);

// `copy` arrives as a Prisma JsonValue from post.copy, so narrow here rather than casting at every
// call site; a shape that isn't a copy bag is skipped instead of writing a malformed artifact.
export const mirrorCopyOntoConcept = async (
  runId: string,
  ownerId: string,
  copy: unknown,
  extra: Record<string, unknown> = {},
): Promise<void> => {
  const body = (copy as { body?: unknown } | null)?.body;
  if (typeof body !== 'string') return;
  const arts = await listArtifacts(runId);
  const concept = arts.find((a) => a.type === 'content_concept');
  if (!concept) return;
  const data = (concept.data as Record<string, unknown>) ?? {};
  await updateArtifactData(concept.id, ownerId, 'content_concept', {
    ...data,
    copy: copy as Record<string, unknown>,
    keyMessage: deriveKeyMessage(body),
    ...extra,
  }).catch(() => {});
};
