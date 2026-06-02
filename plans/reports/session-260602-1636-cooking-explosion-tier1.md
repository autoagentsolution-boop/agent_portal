# Session Report — 2026-06-02 — Cooking Explosion Tier 1 R&D

## Outcome
- All 12 planned phases (00-11) of video-content-farm pivot completed earlier in session, tagged `m2-all-pipelines-stable`, pushed to private GitHub repo `autoagentsolution-boop/agent_portal`.
- Tier 1 standalone Remotion rendering verified working (no Docker, no API, no n8n needed for composition testing).
- New 4th pipeline `CookingExplosion` designed, iterated through 4 visual versions; current state = vertical layout matching infographic reference + cinematic effects.
- Image generation script ready to run; **operator action pending**.

## What was built this session

### Tier 1 rendering pipeline verified
- `cd render-service && npx remotion render src/templates/index.tsx <CompId> <out.mp4> --props=<fixture.json>`
- First run downloads Chromium Headless Shell (~250MB) → cached in `%USERPROFILE%\AppData\Local\Remotion\`
- Composition-only render — no DB / no API / no Docker needed.
- Quiz fixture (`fixtures/quiz-sample.json`) renders 1950 frames @ 30 FPS = 65s, 4.7MB mp4.

### Quiz fixes applied (2026-06-02)
- Fixed countdown ring overlapping options → replaced with bottom horizontal progress bar + "Ns" digit chip
- Added explicit 2s reveal phase showing correct answer (was 0 frames before)
- Deleted unused `CountdownRing.tsx`

### CookingExplosion template — 4 iterations

| v | What | Why deprecated |
|---|---|---|
| v1 | Educational layout: 3-phase explosion + group sort + step cards | User: step cards overlap content |
| v2 | 15s cinematic storyboard (Catalyst → Vortex → Liquid → Plate) | User: lacks real images + ad-grade polish |
| v3 | Vertical layout matching `ReferenceVideoType/foodexplosion.png` — bowl bottom + 6 step layers ascending + steam ribbon | User: feels like flash cards, want 3D + cinematic |
| **v4 (current)** | v3 + 3D perspective + depth blur on far layers + camera dolly + steam particles + light rays + bowl rim shine + disc breathing + warm color-grade + vignette + Audio component support | Pending: real photos + audio injection |

### Code structure (current cooking-explosion)
```
render-service/src/templates/cooking-explosion/
├── types.ts                   # schema: dish + steps[] + ingredients[] + style enum + audio paths
└── CookingExplosion.tsx       # vertical scene + cinematic primitives (Bowl, SteamParticles, SteamRibbon,
                                #   StepLayer, BowlRimShine, LightRays, Vignette, Disc)
```

Schema supports `style: 'vertical' | 'river' | 'smash'` but only `vertical` implemented. River + smash fall through to vertical with TODO comment.

### Image generation script
- `scripts/gen-cooking-images.ts` — Nano Banana wrapper, standalone (no dotenv dep)
- **Shared asset directory** (cross-fixture dedup):
  - `render-service/public/cooking-assets/dishes/<dish-slug>.png`
  - `render-service/public/cooking-assets/ingredients/<ingredient-slug>.png`
- Filename = pure slug (no hash suffix). Same Vietnamese name → same file.
- Idempotent: skips existing files; only gens new ones across runs.
- Cost: ~$0.039/img × 19 (first fixture) = $0.78. Subsequent fixtures share existing ingredients → $0.10-0.30 each.
- Run: `npx --prefix render-service tsx scripts/gen-cooking-images.ts <fixture.json>`

## Operator actions pending (do before next session)

1. **Add GEMINI_API_KEY to `.env`** — operator has the key (`autoagentsolution-boop` account on Google AI Studio).
   - Edit `C:\Users\Vincere\Desktop\Claude\AgentPortal\.env`
   - Add line: `GEMINI_API_KEY=AIza...`
   - Verify still gitignored (already is — `.gitignore` line 6: `.env`).

2. **Run image gen script:**
   ```powershell
   cd C:\Users\Vincere\Desktop\Claude\AgentPortal
   npx --prefix render-service tsx scripts/gen-cooking-images.ts render-service/fixtures/cooking-pho-bo.json
   ```
   Expected: ~3-5 min runtime, $0.74 cost, 19 PNGs in `cooking-assets/`.

3. **Re-render cooking with real photos:**
   ```powershell
   cd render-service
   npx remotion render src/templates/index.tsx CookingExplosion out/cooking-real.mp4 --props=fixtures/cooking-pho-bo.json
   ```

4. **Visual feedback for next session** — what's good, what needs sharpening.

## Strategic decisions made this session

User confirmed via multi-choice answers:

| Question | Answer |
|---|---|
| Quality target | **Mix A + B by content type**: Quiz = Path A, food/cinematic = Path B (when ready) |
| Budget asset gen | $60-120/mo |
| API keys status | Has GEMINI_API_KEY (not in .env yet) |
| AI video gen strategy | Path A first to grow followers, then progressively try Hailuo → Kling → Veo |

→ Implication for next session: **stay on Path A**, push Remotion + real photos + audio to limit before introducing AI video gen wrappers.

## Quality bar gap analysis (honest)

| Layer | Tier 1 (now) | Ad-grade (e.g. Vinamilk/Apple) |
|---|---|---|
| Render | Headless Chrome + CSS | Cinema 4D / Blender path-traced |
| 3D | CSS perspective (fake) | Real GPU mesh + PBR materials |
| Materials | Flat gradient + photo overlay | Subsurface scatter, soft shadows, GI |
| Motion blur | Off (4× render cost) | 8-32 samples/frame |
| Source images | Nano Banana (after operator step) | Pro food photography |
| Audio | Schema-ready, no files yet | Foley + cinematic music + narration |

**Ceiling of pure Remotion**: "great motion graphics" — cannot reach Cinema 4D level without AI video gen hybrid or full 3D pipeline.

## Path B exploration (for after Path A is exhausted)

| Provider | Cost/clip | Quality | Use case |
|---|---|---|---|
| Hailuo (MiniMax) | $0.5-1 | 70% of Veo | Daily mix-in, cheap experiments |
| Runway Gen-3 / Kling | $1-3 | Hollywood-style | Mid-tier hero shots |
| Veo 3 / Veo 3 Fast | $2-4 | Best, native audio | Weekly hero video |

**Strategy when ready**: weekly hero video (4/mo × $7 ≈ $28/mo) within $60-120 budget.

## Memory + security rules captured

Two rules saved in `~/.claude/projects/.../memory/feedback_never_push_env.md`:
1. Never commit/push `.env` files (only `.env.example` allowed)
2. Never commit/push n8n workflow JSON containing literal key values (real or fake) — must use `{{$env.VAR}}` references; alert user immediately if detected

Pre-commit security checklist documented in the feedback memory.

## Repo state at session end

- **Branch:** `pivot/video-content-farm`
- **Last commits:**
  - `6935b29` refactor(gen-images): shared asset dir + slug-only filenames
  - `e5d7c4f` feat(cooking): vertical layout + 3D depth + cinematic upgrade
  - earlier 12 phase commits
- **Tags:** `archive/agent-portal-demo`, `m2-all-pipelines-stable`
- **Remote:** https://github.com/autoagentsolution-boop/agent_portal (private)
- **Uncommitted:** none
- **Generated artifacts not committed:**
  - `render-service/out/quiz-test.mp4`
  - `render-service/out/cooking-pho-bo.mp4`
  - `render-service/out/cooking-vertical.mp4`
  - `render-service/out/cooking-cinematic.mp4`
- **Pending operator artifacts:** `render-service/public/cooking-assets/**` (after image gen run)

## Files most relevant for next session

| Path | Purpose |
|---|---|
| `render-service/src/templates/cooking-explosion/CookingExplosion.tsx` | Active cooking composition |
| `render-service/src/templates/cooking-explosion/types.ts` | Schema (incl. style + audio fields) |
| `render-service/fixtures/cooking-pho-bo.json` | Test fixture (will be patched with imagePath after gen) |
| `scripts/gen-cooking-images.ts` | Nano Banana asset generator |
| `ReferenceVideoType/foodexplosion.png` | Visual reference for vertical layout |

## Unresolved / open for next session

1. **Operator action gate** — image gen + re-render with real photos before any more visual iteration
2. **River + Smash styles** — schema supports, implementation pending
3. **Audio integration** — schema ready, no `scripts/gen-cooking-audio.ts` written yet (would: TTS narration per step + concat + BGM)
4. **Cooking pipeline n8n workflow** — `n8n-workflows/cooking-pipeline.json` not yet written (would: Gemini sinh recipe → call gen-images via /image route → /render CookingExplosion → upload)
5. **Add cooking to render-service /render whitelist** — `KNOWN_TEMPLATES` in `render-service/src/render.ts` currently `[QuizCountdown, NewsComic, HacksList]`; cooking needs to be added before Phase 04+ pipeline integration
6. **Motion blur** — Remotion supports but adds 4× render time; deferred per cost/benefit
7. **Whether to commit `cooking-assets/` to git** — same trade-off as `db/generated/`: commit for zero-coordination vs gitignore for cleaner diffs. Decision pending operator preference after first gen run.

## Quick resume checklist for next session

```
[ ] Read this report
[ ] Check render-service/public/cooking-assets/ — exists? operator ran the gen script?
[ ] Check render-service/fixtures/cooking-pho-bo.json — has imagePath fields populated?
[ ] Ask operator: visual feedback on cooking-real.mp4
[ ] Branch is still pivot/video-content-farm; main = old portal frozen
[ ] If proceeding to audio: write scripts/gen-cooking-audio.ts (edge-tts CLI + ffmpeg concat)
[ ] If proceeding to other styles: implement river + smash layouts in CookingExplosion.tsx
[ ] If proceeding to n8n integration: write cooking-pipeline.json + add CookingExplosion to KNOWN_TEMPLATES
```
