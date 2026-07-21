# Media quality: overview infographic + a real Video Script agent

**Branch:** `pivot/video-content-farm` · **Created:** 2026-07-21 · **Scope:** media track only
(multi-page / agency deferred by decision)

## Problem

Measured in `plans/reports/audit-260721-1108-context-memory-cache-economics.md`: the three media
nodes sit at three different levels of intelligence, and the two most expensive are the dumbest.

| Node | Decides how | LLM? | Spend share |
|---|---|---|---|
| `infographic` | fixed string template (`agent-runners.ts:516-559`) | **No** | **43%** |
| `storyboard` | LLM plans frames, own contract, anchor consistency | Yes | ~1% |
| `video` | reuses storyboard's **still-image** prompt as the **motion** prompt | **No** | **30%** |

Four concrete defects:

1. `infographic` never reasons — its registry `decisionFramework` (`agent-registry.ts:172`) describes
   work that no code performs. `no text overlay` is hardcoded into a node named "infographic".
2. `video` has no motion planning. The storyboard contract (`agent-prompts.ts:48`) emits only
   `{index, imagePrompt, caption}` — no motion field — so a static composition description is fed to Veo.
3. `snapDuration(8)` is a constant: every frame is 8s regardless of platform or content.
4. Voiceover is frame captions concatenated. Captions are written for images, not to be spoken aloud.

## Decisions (locked with the user, 2026-07-21)

- **DAG for video becomes `concept → video_script → video`.** Storyboard leaves the video path
  entirely. Video generates its own keyframes from the script.
- **Role separation:** `infographic` = product **overview** explainer (one image).
  `storyboard` = **feature detail** + carousel slides. `video_script` = narrative for video.
- **`infographic` stays exactly 1 image** (`assetType: 'image'` unchanged, publish validation
  untouched) but becomes a real overview visual: structured, text-bearing, thumbnail-legible.
- **`video_script` owns all four:** shot list + per-shot motion · per-shot and total duration by
  platform · a separate spoken voiceover script · a mandatory 3-second hook and closing CTA.

## Constraints carried from `docs/product/07` and `08`

- No node decides the next node (C7 rejected permanently). `video_script` is a **registry node**,
  which is the sanctioned way to add capability — not dynamic spawning.
- Action nodes (`publisher`, `email_agent`, `dm_agent`, `greeting_agent`, `scheduler`, `security`)
  are untouched.
- No unbounded loops. Every new LLM call is single-shot against a Zod contract, as today.
- `video` keeps `requiresApproval: true, gate: 'cost'` — the human still reviews before Veo spends.

## Phases

| # | Phase | Status |
|---|---|---|
| 01 | [Infographic becomes an overview agent](phase-01-infographic-overview-agent.md) | **done** |
| 02 | [`video_script` node: schema, registry, contract, runner](phase-02-video-script-node.md) | **done** |
| 03 | [Decouple `video` from `storyboard`](phase-03-decouple-video-from-storyboard.md) | **done** |
| 04 | [Rewrite `runVideo` to execute the script](phase-04-rewrite-video-runner.md) | **done** |
| 05 | [Verify scripts, golden snapshot, cost & budget](phase-05-verify-and-cost.md) | **done** — 69/69 green |

## What actually happened vs the plan

Four things the plan did not predict, recorded because they change what a reader should trust:

1. **A 7th coupling site.** `deterministic-analyzer.ts:200` also inferred storyboard from video
   keywords. The plan's 6-site table was incomplete. Found by re-grepping, as the plan's step 6 said to.
2. **`kịch bản` turned out ambiguous.** It means *script*, which is now `video_script`'s job — but it
   was a storyboard trigger word. Split: `kịch bản` + a video → video only; `kịch bản` alone → storyboard.
3. **Two real bugs caught by the new verify script, not by review.** (a) The video runtime rollup
   summed the *first N* shots instead of the ones that actually rendered, so a mid-script failure
   reported a runtime the file did not have. (b) The first version of the test could not have caught
   it — both surviving shots happened to share a duration.
4. **`stitchClips`/`muxAudio` had no injectable seam** while every other media op did, so a DRY-RUN
   video run shelled out to ffmpeg on stub paths. Added `stitchFn`/`muxFn` to `RunnerContext`.

Also: the same 4-line LLM stub was copy-pasted across 5 verify scripts and all 5 broke at once.
Extracted to `orchestration/testing/stub-llm-json.ts` — adding the next node is one edit, not six.

**Deferred (not done):** the cost gate now shows the user a *script* rather than rendered frames.
The review UI does not render shots/motion/timing/narration yet. See phase-04's open question.

Phase 01 is independent and can ship alone. Phases 02→03→04 are strictly ordered (03 breaks the old
edge, 04 fills the new one — running 03 without 04 leaves video unable to resolve its input).
Phase 05 closes all of them.

## Key dependencies

- `video.requires: ['storyboard']` is pinned in **6** places: `agent-registry.ts:209`,
  `requirement-prompt.ts:36`, `orchestration-mappers.ts:107`, `goal-merge.ts:123`,
  `verify-storyboard-video-dep.ts` (whole script), and `planner-golden-snapshot.json`.
- Adding an LLM call to `infographic` (which has none today) changes `plan-estimate.ts` inputs and
  needs a `thinking-budget.ts` entry.
- `AGENT_OUTPUT_CONTRACTS` currently has no `infographic` key — `buildAgentPrompt('infographic')`
  would throw today. Phase 01 adds it.

## Success criteria

- A video goal plans `concept_writer → video_script → video` with **no** storyboard node.
- A carousel goal still plans `concept_writer → storyboard` unchanged.
- `npm run verify` passes, including a rewritten `verify-storyboard-video-dep.ts` that pins the new
  edge and asserts video no longer requires storyboard.
- Video duration derives from platform + shot count; `snapDuration(8)` is gone as a constant.
- Infographic image prompts differ meaningfully across two different products (not one skeleton).

## Not in scope

Multi-page / multi-account (`OAuthToken` composite PK `@@id([ownerId, platform])` allows exactly one
account per platform per tenant). Agency-shaped `Channel` + `Client` layer deferred by decision.
