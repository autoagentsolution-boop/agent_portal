# Session state — 2026-07-21

Branch `pivot/video-content-farm`. Written for a fresh session with no context.

## Where things stand

**Shipped this session** (committed, 69/69 verify green, tsc clean on backend + web):

1. `video_script` — 19th registry node. Video DAG is now `content_concept → video_script → video`;
   storyboard left the video path.
2. `infographic` rewritten from a fixed string template into a prompt-as-data overview planner.
3. Video cost gate renders the script (`web/src/components/video-script-review.tsx`).
4. Language split fixed — model-input fields (English) are no longer shown to users.
5. Docs consolidated: `docs/README.md` index, 7 stale handoffs → `docs/archive/`.

Full detail: `docs/project-changelog.md` (2026-07-21) and
`plans/260721-1231-media-quality-video-script-agent/plan.md`.

## Next work — decided, NOT built

`plans/260721-1343-video-length-and-quota-budget/plan.md`. **Read that plan before touching video.**
Phase files are not written yet; the plan.md is the proposal.

Two things the user chose but that are not implemented:

- **A single preview keyframe of shot 0, generated inside `video_script`.** Chosen over rendering
  every keyframe: a rejected script would otherwise burn 4–6 of the 10 daily provider requests. Shot
  0 is also the anchor every later keyframe is conditioned on, so it represents the whole video.
- **Quota-aware failure.** Classify RPD vs RPM, fail loud naming quota, resume off the cache.

## The constraint that governs all video work

**Gemini free tier: 3 requests/minute, 10/day.** `runVideo` calls one image + one Veo per shot, so a
5-shot video is 10 requests — the whole daily quota, for one video. **1–2 videos per day, maximum.**

- **RPM is handled.** `video/veo.ts:65-105` backs off 25/50/75/75s over 4 attempts, outlasting the
  rolling-minute window.
- **RPD is not.** `veo.ts:64` admits it: *"A true daily-quota exhaustion just retries a few times then
  surfaces."* It burns ~3.5 min of pointless backoff, throws, and `runVideo`'s per-shot catch turns
  that into `degraded: true` — **a silently truncated video**. This is the top thing to fix.
- **Resume is nearly free and this is verified, not assumed.** `veo.ts:38` keys on (prompt + duration
  + reference-image bytes), `imagegen/nano-banana.ts:42` on (prompt + mode + ref path) — content-hash
  filesystem caches — and `docker-compose.yml:32` persists them via named volume
  `mktagent-media:/app/output`. A run that stopped at shot 3 replays shots 1–3 as cache hits (0 API,
  0 cost, 0 quota) and renders only the remainder.

## Facts worth not rediscovering

- **`socialPlatform` is a PUBLISHING enum with Prisma backing** (`Post.platforms`,
  `Campaign.platforms` are `SocialPlatform[]`). It has no tiktok/youtube and must not gain them:
  adding to Zod only breaks post creation at the DB; adding to both makes the publisher fail
  `no target platform can publish this post` — the failure doc 08 measured as 4 of 6 real failures.
  Video framing lives on `goal.slots.videoTarget` instead.
- **`videoTarget` steers rhythm and aspect, NOT total runtime.** Measured live, same product:
  tiktok 24s · reels 24s · youtube 26s · feed 24s. The contract caps shots at 3–6 × max 8s = a hard
  48s ceiling, so "YouTube long-form" is structurally impossible. Raising the cap is a cost/quota
  decision, not a prompt fix — see the quota plan.
- **UI gate copy lives in four places**, not one: both gate blocks (`post-workflow-view.tsx`,
  `saved-flow-detail.tsx`), a separate `statusHint` string, and `flow/artifact-format.ts`. Grep for
  the user-visible sentence, not the component name.
- **Cost economics** (`plans/reports/audit-260721-1108-...md`): 73% of spend is per-asset media, so
  context/prompt/caching work cannot touch it. Chat caching already runs at a 66% hit rate. Do not
  re-propose caching node prompts — they are 336–612 tokens, below Gemini's ~1024-token cache floor.
- **Sub-agent line is held.** `docs/product/07` + `08` still apply; no `src/` change this session
  invalidates them. The self-repair wrapper is still NOT justified (0 malformed-output failures).

## Environment

- Dev DB is `mktagent-postgres-1` on **:5433** (not the root compose stack, which is a different
  Postgres on 5432 plus n8n).
- Backend `npx tsx src/server.ts` :7100 · web `npm run dev` :5173 (split-origin via `VITE_API_BASE`).
- Browser smoke tests: mint a `mkt_session` row and set the cookie on the **API origin :7100**, not
  :5173. Click via `eval(el.click())`, not coordinates — refs go stale after re-render.
- `npm run verify` runs 69 scripts via `tsx` (not `node --experimental-strip-types`, which chokes on
  parameter properties).

## Open questions

1. Does the image model share the 10/day bucket with Veo, or are they separate? The quota plan's
   arithmetic depends on this and it has **not** been measured. Do not guess it.
2. Is the deployment target staying on the free tier? A paid tier moves the constraint back to money
   and makes the quota work much less urgent.
3. Should a quota-blocked run park and auto-resume next day? The `scheduler` node already parks and a
   cron re-enters — the machinery exists, but a run sitting silently for 18 hours needs its own UX.
4. Multi-page / agency (`plans` not written): blocked by `OAuthToken`'s composite PK
   `@@id([ownerId, platform])` = one account per platform per tenant. Target shape is a `Channel`
   entity with a `Client` layer above it. Deferred by decision.
