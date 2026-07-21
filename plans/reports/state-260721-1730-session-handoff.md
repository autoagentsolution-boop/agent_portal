# Session state — 2026-07-21 (evening). Supersedes `state-260721-1455-session-handoff.md`

Branch `pivot/video-content-farm`, pushed. Written for a fresh session with no context.
**A big live test is planned for 2026-07-22.**

## Read this first if you are about to test

1. **`npm run verify` is 71/71 (default gate) and `--tier all` is 85/85.** Green as of `ffa9b28`.
2. **Turn on auto-reload in AI Studio before testing.** The account is paid **prepaid**. At $0
   balance Google stops **every API key on the billing account** — chat, copygen, research, video,
   all at once. $17.91 was spent on 2026-07-21 alone against $39.54 lifetime, so the balance moves
   faster than the lifetime number suggests. No API can read the balance (see below).
3. **The dev DB is `mktagent-postgres-1` on :5433**, psql user `mktagent` (not `postgres`).
4. Backend `npx tsx src/server.ts` :7100 · web `npm run dev` :5173 (`VITE_API_BASE` split origin).

## What shipped today

The whole **video length + quota track is complete** (`plans/260721-1343-video-length-and-quota-budget/`).

| Commit | What |
|---|---|
| `1d9b656` | Classify Gemini 429 as per-minute vs per-day; `runVideo` fails loud instead of `degraded` |
| `ab6d589` | **Retracted the 10/day quota premise** — measured, it was false |
| `66c6ac5` | Depleted prepaid credits treated as a terminal stop |
| `37ca544` | Provider-spend panel in the super-admin console |
| `8dac91f` | Video runtime is a user choice; `videoTarget` demoted to rhythm + aspect |
| `b817316` | feature-map retraction + the three features recorded |
| `ffa9b28` | http verify tier deterministic and green (85/85) |

## The retraction that matters most

**"Gemini free tier: 3 req/min, 10/day ⇒ 1–2 videos/day" was FALSE for this deployment.** It came
from free-tier documentation and was never measured. `mkt_llm_usage` for 2026-07-21:

| | claimed | measured |
|---|---|---|
| Veo calls/day | 10 total, all models | **45** |
| Veo calls/hour | ~3 | **24** |
| all calls/day | — | **426** |

No daily request wall exists anywhere in the ledger. **The binding constraint is the prepaid
balance.** Do not re-plan around request quotas.

## Behaviour changes to expect during the test

- **Video length is now chosen, not fixed.** Say "a 60 second video" (EN or VI, seconds or minutes)
  and `goal.slots.videoLengthSec` is set; 12–120s, clamped. Default stays 24s → 3–6 shots, so
  nothing changes if no length is asked for. `videoTarget` (tiktok/reels/…) now only steers rhythm
  and aspect — it never controlled runtime, that was measured.
- **A terminal provider stop fails loud.** A spent daily quota or a depleted balance stops the video
  node with a message naming the cause, how many of N shots rendered, and that the finished ones are
  cached. It no longer ships a silently truncated video. `degraded` now means only the flaky
  "200 with no image" case.
- **Re-running after a stop is nearly free** — content-hash caches on the persisted `mktagent-media`
  volume replay finished shots with no API call.
- **`/superadminatria101` has a provider-spend panel:** rolling 24h/7d/30d/lifetime, a 14-day series,
  and 30-day by-surface/by-model. It shows **no remaining balance** and never will — see below.
- **Bare "short" no longer means video.** "Short punchy Instagram post" used to plan a Veo video for
  a text post. `shorts`/`youtube short`/`video`/`reel`/`clip`/`tiktok` still do.

## Facts worth not rediscovering

- **There is NO API for the Gemini prepaid balance.** Not Cloud Billing, not any Gemini endpoint.
  AI Studio → Dashboard → Usage and Limits is the only place it exists. Checked 2026-07-21.
- **Prepaid depletion arrives as `429 RESOURCE_EXHAUSTED` + `"Your prepayment credits are
  depleted"`, with no quota metadata** — the same envelope as a rate limit. That collision is why
  `lib/quota-error.ts` matches the message. The match is deliberately narrow (`deplet`,
  `insufficient credit|balance|funds`) and **not** the word "billing", which appears in the ordinary
  rate-limit copy ("check your plan and billing details").
- **`socialPlatform` is a PUBLISHING enum with Prisma backing** and must not gain tiktok/youtube.
  Video framing lives on `goal.slots.videoTarget`.
- **UI gate copy lives in four places** — both gate blocks (`post-workflow-view.tsx`,
  `saved-flow-detail.tsx`), a `statusHint` string, and `flow/artifact-format.ts`. Grep the sentence,
  not the component.
- **73% of spend is per-asset media**, so context/prompt/caching work cannot touch it. Do not
  re-propose caching node prompts (336–612 tokens, below Gemini's ~1024-token cache floor).

## The verify suite, and one honest gap

`npm run verify` (unit+db, 71) is the gate. `--tier all` adds 14 http scripts.

**The http tier now runs against a server booted WITHOUT a Gemini key**, deliberately: run creation
goes through the Atria brain, whose plan-vs-converse decision is a live model judgement, and that
nondeterminism is what made three scripts flake — while spending real money every run. Keyless, the
brain falls back to the deterministic planner those scripts were written against.

- If you start your own server on :7100, the runner **borrows** it and prints a warning: a keyed
  server puts the brain back in the loop and the http tier is no longer deterministic. Stop yours
  before running `--tier all` if you want a clean result.
- **Two sections skip themselves** and the runner prints them under "Sections skipped inside passing
  scripts". `verify-api`'s live-execution section is **unreachable in any stable configuration** —
  keyless, planning is solid but the DAG cannot run; keyed, the DAG runs but planning flakes. The
  live executor is covered deterministically by the db tier (`verify-executor`,
  `verify-flow-cost-rollup`, `verify-rerun-node`) with injected stubs. Fixing it properly means
  building its run through the repos instead of the chat endpoint — worth doing, not done.

## Open questions

1. Should a quota/balance-blocked run park and auto-resume? The `scheduler` node already parks and a
   cron re-enters, so the machinery exists — but a run sitting silently for hours needs its own UX.
2. The preview keyframe of shot 0 inside `video_script` is **decided but unbuilt**, and its original
   justification ("a rejected script burns 4–6 of the 10 daily requests") died with the retraction.
   Re-justify it on cost before building.
3. Multi-page / agency is blocked by `OAuthToken`'s composite PK `@@id([ownerId, platform])` = one
   account per platform per tenant. Target shape is a `Channel` entity with a `Client` layer above.
   Deferred by decision.
