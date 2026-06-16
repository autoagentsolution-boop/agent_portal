# Phase 01 — Zod Schema v2 + Validator

## Context Links
- Prompt spec: `plans/260616-1319-storyboard-v2/prompts/chatgpt-storyboard-v2.md` (section G defines target shape)
- Existing v1 types: `render-service/src/templates/cooking-explosion/types.ts`
- Existing nano-banana cache: `render-service/src/image/nano-banana.ts` (we will hash `imagePrompt` similarly)
- Project asset cache: `render-service/src/util/asset-cache.ts` (shared util we will reuse, not duplicate)

## Overview
- **Priority**: P2 (blocker for phases 02-04)
- **Status**: pending
- **Effort**: 3h
- **Brief**: Define a strict Zod schema mirroring section G of the ChatGPT prompt. Provide `parseStoryboardV2(json)` returning the typed object or throwing with `zodError.format()`-style field path message. No silent degradation, no defaults that mask bad input.

## Key Insights
- Schema is the contract — every field listed in section G is required (the prompt itself tells ChatGPT "do not omit or rename fields, do not add extra fields"), so Zod must be **`.strict()`** to reject extra keys early.
- `transition` enum + `kind` enum drive Remotion branching — must use `z.enum` not `z.string`, or we lose discriminated-union type-narrowing in phase 03.
- `dishSlug` must match `^[a-z0-9-]+$` (used in filesystem paths). Validate at schema layer to avoid path-traversal / unicode-in-filename surprises.
- Cross-field invariant: `sum(panels[].durationSec) === totalDurationSec`. Floating-point safe comparison (tolerance 0.01s). Use `.superRefine`.
- Cross-field invariant: `panels[0].kind === 'intro'` and `panels[last].kind === 'outro'`, all middle `kind === 'step'`, `panels.length >= 9`. Use `.superRefine`.

## Requirements

### Functional
1. Parse v2 JSON into a typed `StoryboardV2` object.
2. Emit a `StoryboardValidationError` with `path` (e.g. `panels[3].imageTextLabel.line1`) and `message` for each failure.
3. Provide a sibling `isV2(json)` type guard for routing in phase 06.

### Non-functional
- File size ≤200 lines (schema may need a single sibling file if it grows).
- Zero new dependencies beyond `zod` (already in repo per render-service package — verify in step 1).
- Pure function, no I/O.

## Architecture

```
caller (CLI / adapter)
   │
   ▼
parseStoryboardV2(raw: unknown) ─► z.parse via schema ─► throws StoryboardValidationError
   │                                       │
   │                                       └─ Zod refinements check cross-field invariants
   ▼
returns StoryboardV2 (typed, frozen)
```

## Related Code Files
- **Create**: `render-service/src/storyboard/schema-v2.ts` (Zod schema + types, target ≤180 lines)
- **Create**: `render-service/src/storyboard/validate.ts` (parse wrapper + custom error class, target ≤80 lines)
- **Read**: `render-service/src/templates/cooking-explosion/types.ts` (for naming style + export conventions)
- **Read**: `render-service/package.json` (confirm `zod` present; if missing, install `zod@^3` — no major version bump)
- **Read**: `prompts/chatgpt-storyboard-v2.md` (the schema spec — match exactly)

## Implementation Steps

1. **Verify dep**: `cd render-service && cat package.json | grep zod`. If absent, install `zod@latest`. Document in commit.
2. **Define enums** in `schema-v2.ts`:
   - `PanelKind = z.enum(['intro', 'step', 'outro'])`
   - `Transition = z.enum(['cut', 'fade', 'zoom', 'swipe'])`
3. **Define `ImageTextLabel`** — `line1: z.string().min(1)`, `line2: z.string().nullable()`, `line3: z.string().nullable()`.
4. **Define `Ingredient`** — `name: z.string().min(1)`, `amount: z.string()`. Note `amount` can be empty string but not null per prompt spec.
5. **Define `Panel`** — all fields from section G, `.strict()`. `durationSec: z.number().positive()`, `index: z.number().int().positive()`.
6. **Define `StoryboardV2`** — top-level `.strict()`, `schemaVersion: z.literal('v2')`, `dishSlug: z.string().regex(/^[a-z0-9-]+$/)`, `panels: z.array(Panel).min(9)`.
7. **Add `.superRefine`** to enforce:
   - `panels[0].kind === 'intro'`
   - `panels[panels.length - 1].kind === 'outro'`
   - all middle panels `kind === 'step'`
   - `Math.abs(sum(durationSec) - totalDurationSec) < 0.01`
   - `panels[i].index === i + 1` (sequential)
7. **Write `validate.ts`**:
   - `class StoryboardValidationError extends Error { issues: Array<{path: string; message: string}> }`
   - `parseStoryboardV2(raw: unknown): StoryboardV2` → on ZodError, map issues to `path.join('.')` + message, throw custom error.
   - `isV2(raw: unknown): boolean` → soft check: `typeof raw === 'object' && (raw as {schemaVersion?: string}).schemaVersion === 'v2'`.
8. **Compile check**: `cd render-service && npx tsc --noEmit`. Fix any type errors.

## Todo List
- [ ] Verify/install `zod` dep
- [ ] Author `schema-v2.ts` with enums + Panel + StoryboardV2 + superRefine
- [ ] Author `validate.ts` with `parseStoryboardV2` + `StoryboardValidationError` + `isV2`
- [ ] Hand-craft a malformed JSON (missing `imagePrompt` on panel 3) and confirm error message reads `panels.2.imagePrompt: Required`
- [ ] Hand-craft a JSON where `sum(durationSec) !== totalDurationSec` and confirm refinement catches it
- [ ] `npx tsc --noEmit` clean

## Success Criteria
- Valid Bò Kho v2 JSON parses without error and returns typed object.
- Each of the 5 invariants in step 7 produces a distinct, field-path-prefixed error message when violated.
- v1 fixture (`cooking-pho-bo.json`) passed to `isV2()` returns `false`.
- TypeScript compiler reports zero errors in `render-service/`.
- Schema file ≤200 lines.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ChatGPT output deviates from schema (extra field, missing field) | High | Low | Strict mode + clear error → user re-prompts ChatGPT |
| Floating-point `sum(durationSec)` mismatch from JSON serialization | Medium | Low | 0.01s tolerance in `superRefine` |
| Zod v3 → v4 breaking change if dep absent | Low | Medium | Pin to `zod@^3` in install command |
| Vietnamese characters in `imagePrompt` break Zod string parsing | Very Low | Low | Zod is UTF-8 native, no issue expected |

## Security Considerations
- `dishSlug` regex prevents path-traversal when slug used in filesystem paths (phases 02/05).
- No eval / no `Function` constructor used.
- Schema rejects extra keys → prevents prototype-pollution-style JSON injection.

## Next Steps
- Phase 02 imports `StoryboardV2` type + `parseStoryboardV2` from this phase.
- Phase 03 imports `PanelV2` + `Transition` enums to type Remotion props.
- No external integrations triggered by this phase.
