# Phase 01 — Google Sheet Schema + Google Drive Layout

**Context:** [plan.md](plan.md) · scouted asset convention from `scripts/gen-cooking-images.ts:6-12` (slug folders).
**Priority:** P1 (blocks P02). **Status:** pending.

## Overview
Define the control-plane data model. The Sheet is the single source of truth for what to post, when,
and what happened. Drive holds the heavy assets; the Sheet only references a Drive folder ID per row.

## Data Flow
- **In:** user (manual, Phase 1) fills `calendar` rows + uploads PNGs to a Drive folder.
- **Transform:** none at rest; Loop A mutates `status`/`postUrl`/`postedAt`/`error` columns over a row lifecycle.
- **Out:** Loop A reads rows; Loop B appends to `leads`.

## `calendar` tab — columns

| Col | Field | Type | Notes |
|-----|-------|------|-------|
| A | `id` | string | stable unique key (e.g. `2026-06-23-bunmam-01`). Used for write-back targeting. |
| B | `product` | string | product/offer name |
| C | `angle` | string | commercial angle (e.g. "save-time", "premium") — becomes Phase-2 gen brief |
| D | `copyVi` | string | post body, Vietnamese |
| E | `copyEn` | string | post body, English (optional; adapter picks per-channel locale or both) |
| F | `driveFolderId` | string | Drive folder holding hero + slide PNGs. **Empty allowed** → hero/copy-only post |
| G | `platforms` | csv | e.g. `facebook,threads`. Controls adapter fan-out (see P05) |
| H | `scheduledAt` | ISO datetime | `Asia/Bangkok` (matches existing workflows; see OQ#6). Post when `≤ now` |
| I | `status` | enum | `ready → posting → posted | partial | error`. Lifecycle below |
| J | `postUrl` | string | JSON map `{facebook:url, threads:url}` written back per platform |
| K | `postedAt` | ISO datetime | set when a terminal state reached |
| L | `error` | string | short per-platform error summary on `partial`/`error` |
| M | `rowNum` | (derived) | n8n Sheets node exposes row index; used for write-back. NOT a stored column |

### status lifecycle
```
ready ──claim──▶ posting ──all ok────▶ posted
                    │      ──some ok──▶ partial   (error col lists which failed)
                    │      ──none ok──▶ error
                    └─ (manual reset: user sets partial/error back to ready to retry)
```
- `ready` is the ONLY state the cron filter picks (P02). `posting` acts as the in-flight lock.
- `partial`/`error` are terminal until a human re-arms the row → prevents silent infinite retry loops.

## `leads` tab — columns (append-only)

| Col | Field | Notes |
|-----|-------|-------|
| A | `receivedAt` | ISO, server time |
| B | `name` | from form |
| C | `email` | from form; dedupe key |
| D | `phone` | from form (optional) |
| E | `message` | free text |
| F | `sourceProduct` | hidden form field = which post/product drove the lead (UTM-style) |
| G | `sourcePlatform` | hidden form field = fb/threads (from CTA link param) |
| H | `rawPayload` | full JSON for audit |

## Google Drive layout convention
Mirror the repo's `source/<slug>/` + `output/<slug>/` split (memory: asset layout). Per calendar row:
```
GoogleDrive/
  marketing-creative/
    <id>/                         ← driveFolderId points here
      hero.png                    ← REQUIRED single hero image
      slides/                     ← OPTIONAL; if absent or empty → carousel skipped
        01.png
        02.png
        ...
```
- Loop A globs `slides/*.png` sorted by filename for carousel order.
- Hero is mandatory; a row with no `hero.png` is an `error` (validation in P02).
- Filenames kebab/numeric; zero-padded for deterministic order (`01.png` not `1.png`).

## Implementation Steps
1. Create the Sheet, two tabs `calendar` + `leads`, header rows exactly as above.
2. Freeze header row; set `status` column data-validation to the enum values (prevents typos breaking the filter).
3. Create Drive `marketing-creative/` root; share with the Google service/OAuth account n8n will use.
4. Seed 1 test row: status=`ready`, scheduledAt in the past, a real `driveFolderId` with `hero.png` only
   (no slides) → exercises the skip-carousel path first.

## Success Criteria
- [ ] Sheet + tabs exist with exact headers; `status` validated to enum.
- [ ] Drive root shared with n8n's Google account; test folder has `hero.png`.
- [ ] One seed row readable by a manual n8n Sheets "read" test (P02 smoke).

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| Header drift breaks column mapping | M×H | Reference columns by header name in n8n, not index; document headers as contract |
| Author writes wrong tz in scheduledAt | M×M | Data-validation note in header; OQ#6 to user; default Asia/Bangkok in filter |
| Drive folder shared to wrong account | L×H | Smoke test in step 4 catches it before go-live |

## Next Steps
Feeds P02 (workflow reads this), P05 (adapter uses `platforms`/locale columns).
