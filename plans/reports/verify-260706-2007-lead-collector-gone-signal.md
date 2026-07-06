# Verify: lead-collector gone-signal mapping (per-platform)

**Date:** 2026-07-06 · **Branch:** pivot/video-content-farm · **Owner tested:** 6455c2bd
**Method:** live HTTP against 2 real posts with deleted platform copies. `checkPostLinks` (tri-state) + raw-status probe + X ground-truth via `GET /2/tweets/{id}`.

Posts: `1724113c` (fb/ig/threads/linkedin published then deleted; no X — X failed to publish) · `9dc9f382` (all 5 published incl. X, then deleted).
Both have `comment_source_ids = NULL` → cron poller skips them; verified via `checkPostLinks` which parses `postUrls`+`extractPostId`.

## Result

| Platform | code verdict | truth | correct? | raw signal |
|---|---|---|---|---|
| Facebook | alive:false | deleted | ✅ genuine | 400 code100 **subcode33** on valid `{page}_{post}` id |
| Instagram | alive:false | deleted | ⚠️ right-answer/wrong-reason | 400 code100 on **shortcode** (Graph can't resolve → always "gone") |
| Threads | alive:false | deleted | ⚠️ right-answer/wrong-reason | 400 code100 on **shortcode** (replies endpoint needs numeric media-id) |
| LinkedIn | alive:true | deleted | ❌ false-positive | 403 `socialActions.GET_ALL.NO_VERSION` swallowed → `[]` → "reachable" |
| X | alive:true | deleted | ❌ false-positive | search 200-empty; `GET /2/tweets/{id}` → `errors[].type=resource-not-found` at **HTTP 200** |

Only **Facebook** gone-detection is trustworthy.

## Root causes + fixes

1. **FB** — works (`subcode33` on a real id). Keep.

2. **IG/Threads — shortcode stored, not numeric media-id.** `extractPostId` pulls the permalink shortcode; comments/replies endpoints require the numeric id returned at PUBLISH time. `isMetaGraphPostGone` conflates "subcode33 on valid id (deleted)" with "code100 on unresolvable shortcode (can't query)" — both are code100.
   - **Fix:** capture the numeric media-id from the IG/Threads publish response and store THAT in `commentSourceIds` (publish adapters already receive it). Then subcode33 is trustworthy.
   - **Interim:** if stored ig/threads id is non-numeric → liveness must return `null`, never `false` (code100-on-shortcode ≡ can't-know, not gone). Prevents self-deactivating live collectors.

3. **LinkedIn — 403 permission → `[]` → alive:true.** Consumer tier can't read `socialActions`; every call 403s.
   - **Fix:** 401/403 = "couldn't authoritatively read" → liveness `null`, never `true`. For real existence check the object itself (`GET /v2/ugcPosts/{urn}` / `/rest/posts`); if that too is tier-gated, LinkedIn liveness is unsupported → always `null` + UI "can't verify on this tier".

4. **X — two bugs.** (a) `search/recent?conversation_id` returns 200-empty for BOTH deleted and no-reply tweets → can't detect deletion. (b) v2 signals not-found via `errors[].type=…resource-not-found` at **HTTP 200**; fetcher's `res.status===404`-only trigger never fires.
   - **Fix (liveness):** use `GET /2/tweets/{id}`; treat `errors[].type` ending `resource-not-found` (or absent `data`) as gone → `alive:false`. Parse HTTP-200-with-body-errors. Keep search only for reading replies, never for liveness.

5. **Cross-cutting (`post-liveness.ts`):** `alive = didn't-throw ? true : (PostGoneError ? false : null)` leaks ambiguity into `true`. Assert `alive:true` ONLY on a positively-confirmed object read; every ambiguous outcome → `null`. The `null` bucket is currently under-used.

## Operational impact

Cron `pollCommentsForLeads` uses the same fetchers → same misclassification:
- Deleted LinkedIn/X post → never marked `post_deleted`, polled until 30d TTL (wasted API calls, dead-post noise).
- Live IG/Threads post (once a shortcode source is recorded) → first poll throws PostGoneError → collector wrongly deactivated → zero leads captured from a live post.

The 2 tested posts have `comment_source_ids=NULL` so cron doesn't touch them — impact bites posts with keyword + recorded sources.

## Status: FIXED (2026-07-06, not committed)

All 5 root causes implemented + verified live vs the same 2 posts → FB=false, X=false, IG/Threads/LinkedIn=null (was: LinkedIn/X false-positive true, IG/Threads false-for-wrong-reason). New file `post-exists.ts` (tri-state); numeric `platformPostId` captured at publish → new migration `platform_post_ids`. Code-review DONE_WITH_CONCERNS → both concerns hardened:
- **M1**: `isMetaGraphPostGone` tightened to `404 || subcode 33` (dropped bare `code 100` — the generic "invalid param" bucket) so a non-delete code-100 on a LIVE post can't false-deactivate a collector. FB genuine-delete still detected (subcode 33). Safe failure = keep polling / show ⚪.
- **L2**: `extractPostId('facebook', …)` now reads the `?v=` query param for watch/video permalinks (was returning the literal `"watch"`).

tsc clean; verify-leads-{post-deleted,comments,expiry,scoring,criteria} green; container rebuilt.

## Open questions
- Do IG/Threads publish adapters currently return + persist the numeric media-id anywhere? (Check before choosing fix 2 vs interim.)
- Is LinkedIn object-existence readable on the current consumer tier at all, or is liveness simply unsupported there?
