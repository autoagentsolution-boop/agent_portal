# Phase 02 — Full Workflow Build + 1 Test Video

**Status**: pending (tomorrow 2026-06-08)
**Effort**: 1.5 days
**Pre-req**: Phase 01 done

## Goal
Build end-to-end production pipeline that turns a dish fixture JSON → finished mp4 ready to upload. Test with 1 phở bò video to validate full flow.

## Acceptance criteria
- [ ] Run 1 command → out: `pho-bo-final.mp4` (~25-40s, 1080×1920, audio sync, ready for YT Shorts + FB Reels)
- [ ] Vision-verify retry loop catches duplicate/missing labels
- [ ] Composition cached (re-run same fixture = $0 image cost)
- [ ] Veo motion clip cached (re-run = $0 video cost)
- [ ] Final cost per fresh video: $0.17-0.19
- [ ] Visual + audio quality matches user's "near-real video" bar

## Sub-tasks

### 02.1 — Vision-verify retry loop (1.5h)
Extend `scripts/build-explode-composition.ts`:
- After Pro Banana gen → call Gemini Flash with composition image + prompt: "List every Vietnamese label visible. JSON: { labels: string[] }"
- Compare against expected fixture labels
- If duplicate or missing → retry gen (max 3 attempts)
- If still failing → flag composition with warning, save best attempt

**Files**:
- `scripts/build-explode-composition.ts` — add `verifyLabels()` step

### 02.2 — Asset cache (30m)
Avoid re-paying for identical gens:
- Hash inputs (`fixture content + ref image path + prompt`) → SHA-256 truncated
- Cache PNG/MP4 at `render-service/public/explode-cache/<hash>.png` (or .mp4)
- Skip gen if hit
- Reuse cache layer across motion + audio

**Files**:
- `render-service/src/jobs/asset-cache.ts` (new) — shared cache util
- Update `build-explode-composition.ts` to consult cache

### 02.3 — Veo 3.1 Light i2v motion (1h)
When quota resets:
- Input: composition.png + motion prompt (gentle: broth flow + steam + breathe + 5% camera push-in)
- Output: 8s mp4 vertical 1080×1920
- Reuse pattern from `scripts/test-spiral-composition.ts` genMotion()
- Wrap in retry+timeout (existing `render-service/src/util/retry.ts`)

**Files**:
- `render-service/src/jobs/gen-explode-motion.ts` (new)

### 02.4 — TTS narration script generator (2h)
Turn fixture → narration script → Azure Neural2 VN voice → mp3
- Script template: brief intro (3s) + per-ingredient tour (2-3s each, top-to-bottom order matching label reveal) + outro CTA (3s)
- Sample script for pho bo:
  ```
  Hôm nay, mình giới thiệu Phở Bò — tinh hoa ẩm thực Việt.
  Bắt đầu với muối, đường phèn, nước mắm — nêm cơ bản.
  Xương ống, xương sườn — hầm 6 giờ lấy nước dùng ngọt thanh.
  Đinh hương, thảo quả, quế, hoa hồi — gia vị truyền thống.
  ...
  Hành lá, ngò gai, rau quế, chanh ớt — sạch và tươi.
  Chan nước dùng nóng, thưởng thức ngay. Một tô phở bò chuẩn vị Việt!
  ```
- Use Gemini Flash to expand from fixture into natural VN narration ~30-45s
- Pass script to Azure Neural2 VN (existing render-service TTS module)

**Files**:
- `render-service/src/tts/narration-script.ts` (new) — Gemini Flash narration gen
- `render-service/src/tts/azure-vn.ts` (new) — Azure Neural2 VN client (or extend existing edge-tts module to route Azure for quality)

### 02.5 — Music track (Suno v4) (1h)
- Style brief: instrumental, lo-fi, traditional Vietnamese accents (đàn tranh / bamboo flute)
- Length: match video length (start with 30s, adjust)
- Cache by style+length hash
- Loop seamless if shorter than video

**Files**:
- `render-service/src/audio/music-suno.ts` (new) — Suno API client

### 02.6 — ffmpeg final encode (2h)
Compose final mp4:
- Layer 1: composition.png held 0-3s
- Layer 2: crossfade to motion.mp4 at 3s, play 3-11s
- Layer 3: hold last frame of motion + fade to outro composition (or hold motion last frame) 11-30s
- Audio: narration.mp3 mixed with music.mp3 (music at -18dB, narration -6dB)
- Output: 1080×1920 H.264 yuv420p, 30fps, AAC audio

**Files**:
- `render-service/src/jobs/encode-explode-video.ts` (new) — ffmpeg recipe
- Reuse `@remotion/compositor-win32-x64-msvc/ffmpeg.exe`

### 02.7 — Postgres run_log entry (30m)
Persist run metadata:
```sql
INSERT INTO run_log (pipeline, dish_id, composition_hash, motion_hash, narration_path,
                     music_path, final_path, cost_breakdown, status, created_at) ...
```
- Add `pipeline='cooking_explode'` enum value if not present

**Files**:
- `db/prisma/schema.prisma` — verify pipeline enum
- `render-service/src/db.ts` — already exists, use existing prisma client

### 02.8 — Single test video E2E (1h)
- Trigger: `npx tsx scripts/run-cooking-explode.ts render-service/fixtures/dishes/pho-bo.json`
- Steps run sequentially with cache hits
- Output: 1 final mp4 + run_log row + cost report
- Manual review: visual + audio quality

**Files**:
- `scripts/run-cooking-explode.ts` (new) — full E2E entry script

### 02.9 — Document outcome (30m)
- Update `docs/runbook-cooking-pipeline.md` with full pipeline runbook
- Update `docs/project-changelog.md` with Phase 12 entry
- Capture final cost actuals + retry stats

**Files**:
- `docs/runbook-cooking-pipeline.md` (new)
- `docs/project-changelog.md` (extend)

## Files to modify
- `scripts/build-explode-composition.ts` (extend with verify loop)
- `db/prisma/schema.prisma` (verify enum)
- `docs/development-roadmap.md` (mark phase done)
- `plans/260531-1755-video-content-farm-pivot/plan.md` (link to this pivot pipeline)

## Files to create
- `render-service/src/jobs/asset-cache.ts`
- `render-service/src/jobs/gen-explode-motion.ts`
- `render-service/src/jobs/encode-explode-video.ts`
- `render-service/src/tts/narration-script.ts`
- `render-service/src/tts/azure-vn.ts`
- `render-service/src/audio/music-suno.ts`
- `scripts/run-cooking-explode.ts`
- `docs/runbook-cooking-pipeline.md`

## Risks + mitigation
| Risk | Mitigation |
|---|---|
| Veo 3.1 Light quota still capped | Fall back to Veo 3.0 fast ($0.15/clip), still in budget |
| Vision-verify gives false positives | Tune Gemini Flash prompt; allow 1 mismatch tolerance |
| Azure TTS VN quality không emotional enough | Researcher recommends Azure Neural2; if flat, try ElevenLabs VN ($0.12/video) |
| Suno API rate limits | Bach cache 5-10 tracks; reuse across multiple videos |
| ffmpeg recipe complexity | Start with simple hold+crossfade; iterate if needed |
| Motion clip looks awkward looped | Crossfade last frame of motion → composition for seamless loop |

## Out of scope (defer to Phase 03)
- n8n workflow automation
- Auto-gen dish fixtures via Gemini Flash from "dish name" input
- YT Shorts + FB Reels upload integration
- Multi-dish daily schedule
- Cost dashboard

## Locked decisions (2026-06-12)
1. **TTS voice**: HoaiMy + NamMinh A/B render. Custom recorded voice planned later → narration module must accept swappable voice provider.
2. **Music**: Lo-fi instrumental (Suno style brief: "lofi instrumental, mellow, Vietnamese food vibe, no vocals").
3. **Video length**: 45s target → narration script ~110-130 từ, hold composition 0-3s + Veo motion 3-11s + hold last frame 11-45s.
4. **Upload**: Kênh test riêng cho video #1. Production channel chỉ sau khi review local + confirm chất lượng.

## Implementation impact of locked decisions
- `narration-script.ts` cần param `{ voiceId: 'HoaiMy' | 'NamMinh' | 'custom' }` + render 2 mp3 cho A/B
- `azure-vn.ts` interface phải swappable → add `TtsProvider` type (Azure now, custom file later)
- `music-suno.ts` style brief locked → cache key chỉ phụ thuộc length
- `encode-explode-video.ts` cần output 2 file: `<dish>-final-hoaimy.mp4` + `<dish>-final-namminh.mp4` (share image+motion+music, swap narration only)
- Upload step OUT of scope this phase — chỉ render local mp4, manual upload kênh test

## Success metric
After Phase 02 complete:
- Run 1 command → finished mp4 in < 5 minutes (excluding Veo wait)
- Cost actual matches $0.17-0.19/video estimate ±20%
- User watches output mp4 và confirm "đúng vision, near-real video quality"
