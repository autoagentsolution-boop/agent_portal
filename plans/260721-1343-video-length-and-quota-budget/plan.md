# Video length as a user choice, under a hard quota budget

**Branch:** `pivot/video-content-farm` · **Created:** 2026-07-21 · **Status:** Phase 01 DONE; 02–03 not started

Follow-on to `plans/260721-1231-media-quality-video-script-agent/` (shipped). Written because a
controlled live test showed `videoTarget` cannot do what it implies, and because the real ceiling
turned out to be provider quota, not money.

## Two findings that set the scope

**1. `videoTarget` does not change runtime.** Controlled live test, same product, only the slot varied:

| target | total | shots |
|---|---|---|
| tiktok | 24s | 5 |
| reels | 24s | 5 |
| youtube | 26s | 5 |
| feed | 24s | 4 |

It *does* steer rhythm (feed chose 4 longer shots incl. an 8s; tiktok chose 5 short ones) and aspect
framing. It does **not** steer length, because the contract caps shots at 3–6 and Veo renders at most
8s — a hard 48s ceiling. "YouTube long-form" is structurally impossible, not a prompting failure.

> ## ⚠ RETRACTED 2026-07-21 — finding 2 below is FALSE for this deployment
>
> The "3/min, 10/day ⇒ 1–2 videos per day" premise came from **free-tier documentation, never from
> measurement**. The account is on a **paid prepaid tier**. Measured from `mkt_llm_usage`:
>
> | | claimed ceiling | actually observed 2026-07-21 |
> |---|---|---|
> | Veo calls in a day | 10 (whole quota, all models) | **45** |
> | Veo calls in one hour | ~3 (RPM-bound) | **24** |
> | all media+LLM calls in a day | — | **426** |
>
> Nothing in the ledger has ever hit a daily request wall. **The binding constraint is the prepaid
> balance, not request count**: $39.54 lifetime, of which **$17.91 was spent on 2026-07-21 alone**
> — 45% of all-time spend in one day. Phase 02 must therefore budget **money**, not requests, and
> per the owner's decision the quota/balance figures are **superadmin-visible only**.
>
> Phase 01 shipped and is still correct — "a provider stop must fail loud, not silently truncate"
> holds whatever causes the stop. **Known gap:** a *prepaid-balance* exhaustion has an unknown error
> shape; the classifier defaults an unrecognised body to `minute`, so it would still retry and could
> still truncate. That shape has not been measured and must not be guessed.

**2. Quota, not cost, is the binding constraint.** Gemini free tier: **3 requests/min, 10/day.**

`runVideo` renders one keyframe **and** one Veo clip per shot, serially. A 5-shot video is
**5 image + 5 Veo calls = 10 requests — the entire daily quota, for one video.**

Current handling, verified by reading:

| Limit | Status |
|---|---|
| **RPM burst** | **Handled.** `video/veo.ts:65-105` retries 429/503 with 25s/50s/75s/75s backoff (4 attempts), which outlasts the rolling-minute window. `imagegen/nano-banana.ts:13` uses `withRetry`. |
| **RPD exhaustion** | **Not handled.** `veo.ts:64` admits it: *"A true daily-quota exhaustion just retries a few times then surfaces."* It burns ~3.5 min of pointless backoff, throws, and `runVideo`'s per-shot catch turns that into `degraded: true` — a **silently truncated video**. |
| **Pre-flight check** | **None.** Nothing tells the user, before they approve, that they have quota for 2 more shots and are asking for 6. |

So the failure a user actually hits is: approve → wait ~10 minutes → receive a 2-shot video with no
explanation. That is worse than a clean refusal.

## Decisions taken

- **The user picks the length.** Not the model, not a hardcoded cap. `videoTarget` stays as a
  rhythm/aspect hint but stops pretending to control runtime.
- **Do not raise the shot cap globally.** Under a 10/day quota, allowing 10–12 shots means every
  video fails partway. Length choice must be presented *against remaining quota*.
- **Quota exhaustion fails loud, before spending.** Never silently truncate.

## Phases

## Decided since this plan was drafted (2026-07-21)

- **A single preview keyframe is generated inside `video_script`** (shot 0, the hook). One image call,
  ~$0.04, so the user sees style/tone/composition before approving ~$1.20 of Veo. Chosen over
  rendering every keyframe because a rejected script would otherwise burn 4–6 of the 10 daily
  requests. Shot 0 doubles as the anchor every later keyframe is conditioned on, so it genuinely
  represents the whole video. Trade-off accepted: a node named "script" now generates one image,
  slightly bending the "planning spends no media budget" line drawn in the previous plan.
- **Partial render under quota exhaustion is cheap to resume, because the media cache already
  exists.** Verified by reading: `video/veo.ts:38` keys on (prompt + duration + reference-image
  bytes) and `imagegen/nano-banana.ts:42` on (prompt + mode + reference path), both content-hash
  filesystem caches. Re-running after a quota stop replays already-rendered shots as **cache hits —
  zero API calls, zero cost, zero quota** — and only calls the provider for the missing shots.

  So the correct behaviour on "rendered 3 of 6, then hit the daily cap" is: **fail loud, naming
  quota**, keep the run resumable, and let tomorrow's re-run cost only the remainder. What must NOT
  happen is today's behaviour — the per-shot catch turns it into `degraded: true` and ships a
  3-shot video with no explanation.

  **Durability checked, and it holds:** the cache lives on the filesystem (`output/images`,
  `output/videos`), and `docker-compose.yml:32` mounts a **named volume** `mktagent-media:/app/output`
  precisely to "persist generated media across rebuilds/recreates". So cache survives a rebuild and
  the resume path is design, not luck. (`runVideo`'s "frame image is missing on disk" error still
  earns its keep for a dev running outside compose, or a volume pruned by hand.)

Phase files are **not written yet** — this document is the proposal to react to first. Sketch:

| # | Phase | Effort | What it does |
|---|---|---|---|
| 01 | Classify RPD vs RPM | S | **DONE 2026-07-21.** `lib/quota-error.ts` reads the `QuotaFailure` `quotaId` + `RetryInfo.retryDelay`. Daily → throw at once (`veo.ts`, `nano-banana.ts`, `withRetry`); per-minute → old backoff, now floored by the provider's own `retryDelay`. `runVideo` re-throws a daily quota naming the model, the N-of-M shot count and the cached remainder, instead of marking it `degraded`. Unknown body shapes classify as per-minute, so the fallback is the old behaviour. `lib/verify-quota-error.ts` + 4 cases in `verify-video-script.ts`; suite 70/70. |
| 02 | Pre-flight quota budget | M | Track requests spent per day per owner (the `mkt_llm_usage` ledger already records every call with a timestamp — count from it, no new table). Surface "this needs N requests, you have M left" at the cost gate next to the dollar figure. |
| 03 | User-chosen length | M | Explicit shot-count / length control at setup, shown against remaining quota. `videoTarget` demoted to what it actually does: rhythm + aspect. |

01 → 02 → 03 in order: 03's UI is meaningless without 02's budget, and 02 needs 01's classification
to know what "exhausted" means.

## Success criteria

- A daily-quota 429 fails in **seconds**, not after ~3.5 minutes of backoff, with a message naming
  quota as the cause.
- A user who cannot render the video they chose is told **before** approving, not after waiting.
- No run ever produces `degraded: true` from a quota error — degradation stays reserved for the
  genuinely flaky "200 with no image" case.
- Video length is a visible choice with its quota cost shown next to it.

## Open questions

1. ~~Does the image model share the 10/day bucket with Veo?~~ **ANSWERED 2026-07-21 — the question
   was malformed.** There is no 10/day bucket on this key: 121 image + 45 Veo calls landed on
   2026-07-21 with no wall hit. See the retraction box at the top.
2. ~~Is the deployment target staying on the free tier?~~ **ANSWERED — paid, prepaid.** So Phase 02
   becomes a *balance* pre-flight, superadmin-only, not a request counter.
3. **NEW, and now the one that matters:** what does Gemini return when a **prepaid balance** hits
   zero? Almost certainly not the free-tier `...PerDayPerProjectPerModel-FreeTier` quotaId that
   Phase 01 keys on. Until that shape is known, `runVideo` can still truncate silently on the one
   failure this deployment will actually hit. Cannot be measured without exhausting the balance —
   the alternative is to treat *any* unrecoverable provider stop mid-render as fail-loud.
4. Should a quota-blocked run park and auto-resume tomorrow (the `scheduler` node already parks and
   the cron already re-enters), rather than fail? Elegant, reuses existing machinery — but a run
   silently sitting for 18 hours needs its own UX.
