# Phase 02 — `video_script` node

**Context:** [plan.md](plan.md) · depends on nothing · blocks Phases 03, 04

## Overview

**Priority:** P0 · **Status:** pending

A new registry node that authors a real video script. This is the sanctioned extension path from
`docs/product/08` — *"add new nodes to the registry (not dynamic spawning)"* — so it inherits the
gate, cost, contract and snapshot machinery for free.

## Key insights

- The planner is registry-driven backward-chaining (`workflow-planner.ts`). Adding a node = a
  registry entry + an artifact type + a `PIPELINE_ORDER` slot. Edges derive themselves from
  `requires`/`produces`. No planner logic to write.
- Today nothing in the pipeline has a concept of a **hook** or **pacing**. Retention on short video
  is decided in the first 3 seconds and the system has no representation of that.
- Voiceover is currently frame captions joined (`agent-runners.ts:739`). Captions describe images;
  they are not written to be spoken. The script must carry spoken lines as a distinct field.

## Requirements

**Functional** — the script decides:

1. **Shot list with motion.** Per shot: `imagePrompt` (English, for the keyframe), `motion` (camera
   move + subject action + pacing, English, for Veo), `durationSec`.
2. **Duration.** Per-shot seconds snapped to Veo's `[4,6,8]`, plus a total bounded by platform:
   TikTok/Reels ≤ ~30s, YouTube longer. Total = sum of shot durations.
3. **Voiceover.** A separate `narration` line per shot, written in the run language, phrased to be
   spoken aloud — not an image caption.
4. **Hook + CTA.** Shot 0 is the hook and must earn attention in ≤3s. The final shot is the CTA.

**Non-functional** — single LLM call, Zod-validated, no loop. Cost is one reasoning call (~600
prompt tokens), negligible against Veo.

## Architecture

```
content_concept ──> video_script ──> video
                    (LLM, no media)   (Veo, gate: cost)
```

`video_script` generates **no media and spends no media budget** — it is pure planning. That means
the existing `gate: 'cost'` on `video` still halts the human in front of every dollar of Veo spend,
exactly as today.

## Related code files

**Modify**

- `src/orchestration/schemas/artifact-schemas.ts` — add `'video_script'` to `artifactType`, add the Zod schema
- `src/orchestration/registry/agent-registry.ts` — new `video_script` entry
- `src/orchestration/prompts/agent-prompts.ts` — add `'video_script'` to `ContractKey` + contract
- `src/orchestration/master/workflow-planner.ts` — insert into `PIPELINE_ORDER` before `'video'`
- `src/orchestration/executor/agent-runners.ts` — add `runVideoScript`, register in the runner map
- `src/orchestration/thinking-budget.ts` — reasoning tier

## Implementation steps

1. Artifact schema `videoScript`:
   `{ platform, totalDurationSec, hook: string, cta: string, shots: [{ index, imagePrompt, motion, narration, durationSec }] }`.
   Constrain `durationSec` to `4|6|8`, `shots` to 3-6, `index` starting at 0 and incrementing.
2. Registry entry: `id: 'video_script'`, `requires: ['content_concept']`, `optional: ['strategy_brief', 'research_summary']`,
   `produces: ['video_script']`, `group: 'creative'`, `requiresApproval: false`, no gate.
   The cost gate stays on `video`, where the money is.
3. Output contract: English `imagePrompt` + `motion`; run-language `narration`, `hook`, `cta`.
   Require a shared style anchor phrase at the start of every `imagePrompt` (copy the mechanism
   `storyboard`'s contract already uses at `agent-prompts.ts:52` — it demonstrably works).
4. `runVideoScript`: resolve language / instructions / product knowledge with the existing helpers,
   pass target platforms from `ctx.goal.platforms` so the model can bound total duration, call the
   LLM once, `safeParse`, record usage under a new `surface: 'video_script'`.
5. Add `'video_script'` to `PIPELINE_ORDER` between `'storyboard'` and `'video'`.
6. `thinkingBudgetFor`: `case 'video_script': return REASONING`.

## Todo

- [ ] `videoScript` Zod schema + `artifactType` entry
- [ ] Registry entry
- [ ] Output contract + `ContractKey`
- [ ] `runVideoScript` + runner-map registration
- [ ] `PIPELINE_ORDER` slot
- [ ] Thinking-budget case
- [ ] Compile clean

## Success criteria

- Node produces 3-6 shots, each with a non-empty `motion` distinct from its `imagePrompt`.
- `hook` is present and shot 0's `durationSec` ≤ 4.
- `narration` is in the run language; `imagePrompt`/`motion` are English.
- `sum(shots.durationSec) === totalDurationSec`, and total respects the platform bound.

## Risks

| Risk | Mitigation |
|---|---|
| Model returns `motion` that just repeats `imagePrompt` | Contract states explicitly that motion must describe change over time, not composition. Verify script asserts they differ. |
| Duration arithmetic drifts | `totalDurationSec` is validated against the shot sum in the runner, not trusted from the model. |

## Security

No external writes. No new tenant-data path — same owner-scoped helpers as every other creative node.

## Next steps

Phase 03 rewires the planner so `video` consumes this. Do not ship 02 alone expecting behaviour
change — until 03, nothing selects this node.
