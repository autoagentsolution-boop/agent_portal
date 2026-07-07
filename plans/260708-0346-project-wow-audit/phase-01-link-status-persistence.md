# Phase 01 — Link-status persistence (P0 BUG, user-observed)

**Priority:** P0 · **Status:** planned · **Type:** clear bug, isolated
"Link status phải hit check-link, refresh thì mất." Confirmed root cause.

## Root cause (verified)
`checkPostLinks` (`MKTAgent/src/leads/sources/post-liveness.ts:25-62`) computes per-platform
`alive` live on every call and RETURNS it, but only writes the DB in the self-heal branch
(`:52-60`, when a watched comment-source dies) — it never persists the `alive` results. There
is NO column for it: `Post` (`prisma/schema.prisma:268`) has `lastLivenessCheckAt` (:348) but
no `linkStatus`. Web `LeadsPage.tsx` holds results in transient `useState` (auditor: `:46`),
populated only by the manual "Check links" button; `load()` (`:48-59`) never re-fetches → a
refresh resets to `{}` → status vanishes.

## Fix (design)
Persist the liveness result and hydrate it on load. Single write site in `checkPostLinks`.

### Steps
1. **Schema** — add to `Post` (`prisma/schema.prisma`, near :348):
   `linkStatus Json? @map("link_status")`  // LinkStatus[] snapshot
   Then `npx prisma migrate dev --name post_link_status` + `prisma generate`.
2. **Persist in `checkPostLinks`** (`post-liveness.ts:52-60`): make the write UNCONDITIONAL —
   always `prisma.post.update` with `{ linkStatus: results, lastLivenessCheckAt: new Date() }`,
   AND keep the existing `commentSourceIds`/`leadCollectorStatus` self-heal when changed.
   (Merges the timestamp write the sweep does at `:93` — can drop that duplicate.)
   ⚠ `checkPostLinks` takes an injectable `aliveFn` for `verify-leads-liveness-union.ts`; an
   always-on `prisma.post.update` may hit DB in that verify. Confirm the verify uses a real/seeded
   post or guard the write behind a `persist=true` param defaulted true (route+sweep pass true,
   verify passes false). Prefer the param — keeps the seam pure.
3. **DTO** — add `linkStatus` to the post DTO (`toPostDto`, grep `MKTAgent/src/api`), typed as
   `Array<{ platform: string; url: string; alive: boolean | null }> | null`.
4. **Client type** — add `linkStatus` to `PostDto` / Leads type in `web/src/api/client.ts`.
5. **Web hydrate** — in `LeadsPage.tsx`, seed the `linkStatus` state from `post.linkStatus` in
   `load()` (`:48-59`) so refresh shows the last-known status; the manual button still refreshes
   live and now the fresh result also persists (via the route calling checkPostLinks).
6. **Optional** — the leads cron sweep already calls `checkPostLinks`; with step 2 it now
   persists automatically each sweep, so the UI trends toward fresh without a manual click.

## Todo
- [ ] schema `Post.linkStatus Json?` + migration + generate
- [ ] unconditional persist in `checkPostLinks` (+ persist param for verify seam)
- [ ] DTO + client type
- [ ] hydrate web state from `post.linkStatus` on load
- [ ] run `verify-leads-liveness-union.ts` green; tsc backend + web

## Success criteria
- Check links → refresh page → status STILL shown (⚪/🔴/🟢) without re-clicking.
- Cron sweep persists status; verify seam stays injectable/pure.

## Risk
- Injectable-seam DB write (mitigate w/ `persist` param). Migration on shared DB — coordinate.
