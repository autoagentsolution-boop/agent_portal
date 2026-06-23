# Phase 05 — Platform-Adapter Abstraction Spec

**Context:** [plan.md](plan.md) · [phase-02](phase-02-posting-workflow.md) fan-out · [phase-03](phase-03-meta-oauth-setup.md) creds.
Scouted: Threads two-step container/publish (WebFetch developers.facebook.com/docs/threads/posts), FB Graph multi-photo.
**Priority:** P1 (contract for P02). **Status:** pending.

## Overview
The `platforms` column (csv) maps each target to an **adapter**: a self-contained n8n subgraph that takes a
normalized post spec and returns a normalized result. Adding a channel = adding an adapter, no Loop-A rewrite.

## Adapter contract
**Input (normalized post spec, built once in P02 node [5]/[7]):**
```json
{
  "copyVi": "…", "copyEn": "…",
  "hero":   { "binary": "data_hero" },
  "slides": [ { "binary": "data_slide_01" }, … ],   // [] when none
  "creds":  "<env keys for this platform>"
}
```
**Output (normalized result, consumed by P02 node [10]):**
```json
{ "platform": "facebook|threads|x|instagram", "ok": true|false, "url": "…|null", "error": "…|null" }
```
**Rules every adapter obeys:**
- Pick locale per its own policy (FB/Threads → copyVi primary; X/IG → adapter decides). Format text to limits.
- `slides` empty → single-image (hero) post. `slides` present → carousel of slides (hero optional lead).
- MUST set `onError: continueErrorOutput` on publish nodes so failure → `{ok:false}` not workflow abort.
- MUST emit exactly one result object on both success and error branches (Merge in P02 depends on it).

## Phase-1 adapters

### FB Page (classic Page feed, image carousel)
- **Single image:** `POST /{MKT_FB_PAGE_ID}/photos` (published) with `url` or uploaded binary + `message`.
- **Carousel (multi-photo):**
  1. For each slide: `POST /{page}/photos?published=false&temporary=true` → collect `id`s.
  2. `POST /{page}/feed` with `message` + `attached_media=[{media_fbid:id1},…]`.
- Token: `{{$env.MKT_FB_PAGE_ACCESS_TOKEN}}`. Text limit generous (~63k); use copyVi.
- url = `https://facebook.com/{post_id}`.
- **Caveat (OQ#2):** requires CLASSIC Page; new Pages-experience profiles differ. Verify Page type.

### Threads (two-step container → publish)
- **Single image:**
  1. `POST /{MKT_THREADS_USER_ID}/threads?media_type=IMAGE&image_url=<hero>&text=<copy>` → `creation_id`.
  2. wait ~30s, `POST /{user}/threads_publish?creation_id=<id>` → media id.
- **Carousel (2–20 items):**
  1. each slide: `POST /{user}/threads?media_type=IMAGE&image_url=<slide>&is_carousel_item=true` → item ids.
  2. `POST /{user}/threads?media_type=CAROUSEL&children=<id1,id2,…>&text=<copy>` → `creation_id`.
  3. wait ~30s, `threads_publish?creation_id=<id>`.
- **IMPORTANT:** Threads needs PUBLIC `image_url`s, not binary upload. Hero/slides must be reachable URLs.
  → Drive files must be served as public links, OR push assets to a public bucket first. **Design note:**
  P02 must produce public URLs for Threads (Drive "anyone with link" share, or render-service static host).
  This is the one place hero-binary (FB) and hero-URL (Threads) diverge — the adapter abstraction absorbs it.
- Token: `{{$env.MKT_THREADS_ACCESS_TOKEN}}`. Text ≤500 chars → truncate copy for Threads.
- Rate: 250 posts/24h/profile (far above our 72/day ceiling).
- url = `https://www.threads.net/@<handle>/post/<id>` (or media permalink from publish response).

## Phase-2+ adapters (DESIGN ONLY — do not build now)
| Adapter | Status | Note |
|---------|--------|------|
| **X (Twitter)** | P2+ | Write needs paid tier. **$100/mo Basic = 3k posts/mo**; free tier write is 1.5k/mo but volatile. Media upload v1.1 + create v2. COST FLAG (P06). |
| **Instagram** | P2+ | IG Graph: `media` container (image_url) → `media_publish`, mirrors Threads pattern. Needs IG Business + FB Page link, `instagram_content_publish` scope. |

## `platforms` → handler mapping (P02 node [8])
```
csv "facebook,threads"  → Switch routes to [FB adapter] + [Threads adapter]
unknown token           → skip + record {platform, ok:false, error:"no adapter"} (no crash)
```

## Success Criteria
- [ ] FB adapter: single + carousel both post; returns normalized result.
- [ ] Threads adapter: single + carousel both post via public URLs; returns normalized result.
- [ ] Unknown platform token → recorded as failure, other adapters unaffected.
- [ ] Both adapters honor `onError: continueErrorOutput`.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| Threads needs public image URLs (Drive private) | H×H | flagged here; P02 produces public links (Drive share or static host) before Threads call |
| FB Pages-experience endpoint mismatch | M×M | OQ#2 verify Page type; smoke single-photo first |
| Threads 30s container delay → timeout | M×M | poll container status or fixed wait node; per-call timeout 60s |
| copy >500 chars breaks Threads | M×L | adapter truncates copy to 500 for Threads only |

## Next Steps
Implemented inside P02 fan-out. X/IG adapters deferred; X cost reality tracked in P06.
