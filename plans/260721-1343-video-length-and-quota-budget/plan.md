# Video length as a user choice, under a hard quota budget

**Branch:** `pivot/video-content-farm` · **Created:** 2026-07-21 · **Status:** PROPOSED, not started

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
| 01 | Classify RPD vs RPM | S | Read the 429 body (`RESOURCE_EXHAUSTED` quota metric names the limit). A per-day exhaustion stops retrying immediately instead of burning 3.5 min; a per-minute burst keeps today's backoff. Quota errors get their own error class so `runVideo` can refuse to mark them `degraded`. |
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

1. Does the image model share the 10/day bucket with Veo, or are they separate? **Must be measured
   before Phase 02's arithmetic is trusted** — it is the difference between "5 shots costs 10 units"
   and "5 shots costs 5". Do not guess this.
2. Is the deployment target staying on the free tier? A paid tier moves the constraint back to money
   and makes Phase 02 much less urgent (though still correct).
3. Should a quota-blocked run park and auto-resume tomorrow (the `scheduler` node already parks and
   the cron already re-enters), rather than fail? Elegant, reuses existing machinery — but a run
   silently sitting for 18 hours needs its own UX.
