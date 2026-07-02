# Post-board & Master-Agent fixes — 2026-07-02

7 user feedback items on `pivot/video-content-farm`. Buyer demo Fri 2026-07-03.
Stack: web Vite `:5173`, backend `tsx watch` `:7100`, Postgres Docker `:5433` (hot reload — only PG containerized).

## Decisions (user-confirmed 2026-07-02)
- **Item 1**: video DEPENDS ON storyboard, NOT vice-versa. Storyboard usable alone (for posting). Adding video ⇒ storyboard implied. Removing video keeps storyboard.
- **Item 3**: Add-post modal (Master Agent | Manual). Manual path is fine already; the *real* bug is item 2 — chatting MA to create a campaign/post after a flow is saved forks a NEW flow instead of binding to the saved one.
- **Item 4**: Storage as a Connection — UI shell + wire to existing local storage. No Drive OAuth this round.
- **Item 2**: fix all three (create-loop, reuse saved flow, publisher shows selected platforms).

## Root causes (verified)
| # | Symptom | Root cause | File |
|---|---------|-----------|------|
| 1 | storyboard bundled with video | `selectAgents` pushes storyboard only inside `needsVideo`; no `needsStoryboard` flag | workflow-planner.ts, goal-spec.ts, deterministic-analyzer.ts, goal-merge.ts |
| 2 | MA forks new flow on follow-up; loop; publisher hides platforms | after `/save` run is `kind=template` → `POST /runs` `refine=false` → `handle()` plans fresh; no campaign-create intent; DAG cards never show `goal.platforms` | orchestration-router.ts, master-agent.ts, orchestrate-run-cards.tsx |
| 3 | add-post = manual only | no create-mode picker | campaign board component + PostCard |
| 4 | storage not a connection | no storage connector | connector-registry.ts, Connections UI |
| 5 | new post platforms unticked | `createPostForOwner` never inherits `campaign.platforms` | posts-router.ts POST / |
| 6 | node dots stay ○ on Generate | "Generate copy" = legacy copy-gen; DAG only moves on "Execute" (2 disjoint paths) | PostCard.tsx / PostWorkflowView.tsx |
| 7 | Execute does nothing | `PostWorkflowView` has NO ConnectionRequired block → `needs_connection` silently swallowed | post-workflow-view.tsx |

## Phases
- [x] [phase-01-post-execution-cluster.md](phase-01-post-execution-cluster.md) — items 5,6,7 (the dead-post-board cluster). **DONE 2026-07-02** — tsc+web build clean; inherit smoke 5/5 + template-instance 22/22 green vs rebuilt container.
- [x] [phase-02-master-agent-reuse.md](phase-02-master-agent-reuse.md) — item 2. **DONE 2026-07-02, REVISED to Option A.** First shipped Option B (button-only) — user retested: still felt like a loop because it re-offered instead of creating from the typed request. Upgraded to **Option A**: `campaign-from-flow.ts` ACTUALLY creates the campaign(+post) server-side, bound to the flow, and the panel navigates to the board (`onCampaignCreated`/`createdCampaignId`). reuse-http 16/16 + intent 10/10 + regressions green vs rebuilt container.
- [x] [phase-03-add-post-modal.md](phase-03-add-post-modal.md) — item 3 (create-mode picker). **DONE 2026-07-02.** Reframed per user: MA path is a conversational field-filler (not deep-link) — `POST /posts/from-agent` runs `requirementAnalyzer` → `goalToBrief` → creates post UNDER the current campaign (no fork), reusing extracted `buildPostUnderCampaign` (DRY w/ manual POST /). Two-choice modal (Manual = unchanged PostBriefForm | Master Agent = describe→auto-fill). verify-post-from-agent 10/10 green (live Gemini: vi/instagram/video) vs fresh :7133 server; tsc + web build clean.
- [x] [phase-04-storyboard-video-dep.md](phase-04-storyboard-video-dep.md) — item 1. **DONE 2026-07-02** — independent `needsStoryboard` flag; video ⇒ storyboard (planner-enforced); "bỏ video" keeps storyboard, "bỏ storyboard" drops both. verify-storyboard-video-dep 14/14 green.
- [ ] [phase-05-storage-connection.md](phase-05-storage-connection.md) — item 4 (storage connector UI shell).

## Ordering rationale
P1 first — it's what makes the board look broken in the demo and is self-contained. P2 next (MA loop is the most confusing bug). P3 depends on P2 (modal's MA path routes through the reuse logic). P4/P5 independent, lower risk.

## Cross-cutting gotchas
- After `prisma migrate dev` → ALWAYS `npx prisma generate` before tsc (phantom column errors otherwise).
- DRY-RUN only for any publish in verification (memory: no burst social posts).
- VN diacritics: use `\p{L}` lookarounds, `\b` breaks on Vietnamese.
- Live Gemini emits `""` not `null` → `trim()||null`, not `??`.
- Verify vs REBUILT container with `--force-recreate` (only if schema/migration changed; source is hot).
