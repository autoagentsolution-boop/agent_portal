# Next Session — P6: Master Agent creates & sets up campaigns/posts

Resume of the Flow↔Post convergence work. **P1–P5 are DONE** (not committed). This doc is the P6 brief + the manual-test / commit checklist for what's already built.

Plan: `plans/260701-1304-flow-post-convergence/plan.md`. Memory: `project_flow_post_convergence`.

## First: manual e2e + commit P1–P5 (before starting P6)

Stack: web = Vite dev `:5173`, backend = `tsx watch` `:7100`, Postgres = Docker `:5433`. Source changes are hot — no rebuild. (Only Postgres is containerized.)

1. **P1 Connect form** — `:5173` → Connections → any platform → "Enter token" → paste a token → card flips to **Connected**. Publishing still respects Safe mode.
2. **P2 DAG under post** — run a flow to completion → open its post → expand **"Workflow · N steps"** → click Infographic node → image + clean text render.
3. **P4 Re-run node** — on that post's DAG, select Concept → **"↻ Re-run this step"** → concept re-runs, downstream marked stale (pending), publisher NOT re-fired.
4. **P5 Refine + overrides** — a review post → **Refine** → type an edit → copy changes on-target, returns to review. New brief → set per-post Angle/Brand voice overrides.
5. If green: commit (conventional, no AI refs) + push. Two migrations included: `20260701064554_post_run_link`, `20260701090147_post_voice_angle_overrides`.

## P6 scope — the real agent-agency story (user's words)

Master Agent should be a **guide**: choose + confirm with the user, create the flow, THEN ask:
- "Tạo campaign/task đầu tiên cho workflow để bắt đầu chiến lược không?"
- "Muốn thử post đầu tiên để test hệ thống không?"
- If **no** → redirect to their approved flow for chat.
- On **return** → suggest workflows they created but that have **no strategy/task assigned yet**.

## P6 implementation notes (from exploration)

- `concept_writer` (agent-runners.ts) already materializes 1 Campaign + 1 Post at run execution — the create machinery exists. P6 is the **conversational offer** + routing, not new create logic.
- Master Agent (`src/orchestration/master/master-agent.ts`) only plans; persistence is in `orchestration-router.ts`. The offer belongs in the Orchestrate reply flow after approve/save.
- "Flows without strategy" hint = savedRuns whose linked campaigns have no posts / no scheduled task. Surface in sidebar empty-state or on chat return (App.tsx).
- Files: `src/orchestration/master/*`, `web/src/components/OrchestratePanel.tsx`, `web/src/App.tsx`.

## Gotchas carried forward

- ⚠ After `prisma migrate dev`, ALWAYS `npx prisma generate` before tsc — else phantom "Property does not exist on type" for new columns.
- Convergence key is `Post.runId` (SetNull). Cardinality 1 run : 1 post; manually-created posts are run-less (no DAG) — P6's "create first campaign" gives them one.
- Downstream re-run policy = **mark stale, do NOT auto-run** (deliberate image/video spend). Publisher re-run is blocked (use approve-node gate).
- DRY-RUN only for any publish path in verification (memory: no burst social posts).
