# Pagination — Leads + PostBoard "Load more" (keyset, mirrors posts pattern)

Date: 2026-07-10
Branch: pivot/video-content-farm (not committed — user reviews first)

## Summary

Ported the existing posts keyset-pagination pattern (`listPosts` / `/posts` GET) onto
leads, and wired "Load more" buttons into `LeadsPage` and `PostBoard` so both lists
stop silently capping at their fetch limit.

## Files changed

Backend (MKTAgent):
- `src/db/repos/lead-repo.ts` — `listLeads` signature changed from `(ownerId, limit=100)`
  to `(args: ListLeadsArgs)` = `{ ownerId, limit, cursor? }`. `take: limit + 1`,
  `...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})`. Kept `orderBy: { receivedAt: 'desc' }`.
- `src/api/schemas.ts` — added `listLeadsQuery` (`limit` 1-100 default 20, `cursor` uuid
  optional), mirrors `listPostsQuery` exactly.
- `src/api/leads-router.ts` — `GET /` now parses `listLeadsQuery`, computes
  `hasMore = rows.length > q.limit`, slices, returns `ok(res, page.map(toLeadDto), { count, nextCursor })`
  — byte-for-byte the same shape as `posts-router.ts`.
- `src/api/email-router.ts` — **incidental fix**, not in the original file-ownership list
  but required: this file also calls `listLeads(req.userId!)` (old positional signature).
  Updated the one call site to `listLeads({ ownerId: req.userId!, limit: 100 })` (same
  100-row cap it had before — that surface isn't in pagination scope, just kept compiling).
- `src/contract/openapi.ts` — **also incidental**: `GET /leads` was hand-registered without
  a `request.query` (unlike `/posts`, which has `request: { query: listPostsQuery }`). Since
  this file isn't derived from the routers, I added the missing `request: { query: listLeadsQuery }`
  + `422` response and imported `listLeadsQuery`, or the generated OpenAPI/TS types would never
  have surfaced `nextCursor` correctly for the leads list (`meta` would've stayed untyped in the
  generated schema for that path). Regenerated after.

Frontend (web/):
- `web/src/api/client.ts` — **key decision**: `Result<T>` was already `{ ok: true; data: T; meta?: unknown }`
  — `request()` already returned `meta` off the envelope, just untyped. Rather than adding a
  parallel path, made `Result` and `request` generic on a second type param: `Result<T, M = unknown>`,
  `request<T, M = unknown>(...)`. Added `export interface ListMeta { count: number; nextCursor: string | null }`.
  `api.listPosts` and `api.listLeads` now call `request<PostDto[], ListMeta>` / `request<LeadRow[], ListMeta>`
  so `r.meta?.nextCursor` is typed at call sites, while every other `request<T>()` call in the file
  keeps `meta: unknown` (default) — zero call-site changes needed elsewhere, no breakage.
  `api.listLeads` also gained a `{ limit?, cursor? }` query param (was zero-arg).
- `web/src/components/LeadsPage.tsx` — added `leadsCursor`/`loadingMore` state, `LEADS_PAGE_SIZE = 30`.
  `load()` now calls `api.listLeads({ limit: 30 })` and stores `meta.nextCursor`. New `loadMoreLeads()`
  appends the next page to `leads` and advances the cursor. "Tải thêm" (`.btn`) button rendered
  centered under the lead-table, only when `leadsCursor` is non-null; hidden otherwise. Existing
  table/score rendering untouched.
- `web/src/components/PostBoard.tsx` — same treatment: `POSTS_PAGE_SIZE = 30`, `postsCursor`/`loadingMore`
  state, `load()` now requests `{ limit: 30 }` (was 100) and stores the cursor, new `loadMore()` appends
  + carries the `campaignId` filter through (so a campaign-scoped board never leaks another campaign's
  posts on page 2). Button rendered under the summary list only (detail view unaffected), hidden when
  `postsCursor` is null.

Contract:
- `openapi.json` (repo root) — regenerated via `npm run gen:openapi` (31 paths).
- `web/src/api/schema.d.ts` — regenerated via `npm run gen:types` (now types `/leads` GET query
  as `{ limit?, cursor? }` and its 200 body meta as `{ count, nextCursor }`, matching `/posts`).

## Curl verification

```
GET /posts?limit=1  → meta: {"count":1,"nextCursor":"0ef98ca3-bd2b-4c4d-bde6-8f8664cd4e77"}
GET /leads?limit=1  → meta: {"count":1,"nextCursor":null}   (data.length: 1)
```

Leads `nextCursor: null` is correct — owner `6455c2bd` has exactly 1 lead total (as noted in
the task), so there's no next page. Posts `nextCursor` non-null confirms the same owner has
more than 1 post, and the envelope shape (`{ count, nextCursor }`) matches `/posts` exactly.

## Typecheck / build

- `npm run typecheck` (MKTAgent, root): **PASS**, clean, no errors.
- `cd web && npx tsc -b`: **PASS**, clean, no errors.
- `cd web && npm run build`: **PASS** — `tsc -b && vite build` succeeded, 79 modules, dist emitted.

## Notes / deviations

- Did not touch `App.tsx`, `scheduled-view.tsx`, or the collectors-post fetch inside
  `LeadsPage` (`api.listPosts({ limit: 100 })` for the lead-collector card list) — none of
  these were named in the task scope, and their 100-row caps are a separate, smaller concern
  (they're display of published posts / a dashboard summary, not the same "silently caps" UX
  complaint the task called out for the two named lists).
- `email-router.ts` and `openapi.ts` are outside the literal file-ownership list in the task
  but had to change — the former because it's the only other caller of the repo function I
  changed the signature of (compile-breaking otherwise), the latter because it's the hand-maintained
  contract source of truth (not derived from the router file) and omitting it would have made
  `gen:types` silently under-type the new `/leads` query/response shape.

**Status:** DONE
**Summary:** Leads now keyset-paginated backend-to-frontend, mirroring the posts pattern exactly; both LeadsPage and PostBoard have working "Load more"/"Tải thêm" buttons that append and hide on exhaustion. All typechecks/builds green, curl-verified envelope shape on both endpoints.
**Concerns/Blockers:** None blocking. Minor scope-adjacent edits (email-router.ts call-site fix, openapi.ts query registration) were necessary for compile correctness / contract accuracy — flagged above for review since they're outside the literal file-ownership list.
