# Atria — Demo-Readiness End-to-End Test Plan (Manual / Browser)

**Date:** 2026-07-09 21:00 · **Branch:** `pivot/video-content-farm` · **Author:** QA (manual browser walkthrough)
**App under test:** Atria marketing-automation web app (MKTAgent)
**Scope:** Read-only-authored plan; every feature a demo customer will see, grounded in the real components/routes.

---

## 0. Environment setup & conventions

### 0.1 Start the stack
- **Backend (Express):** from `C:\Users\Vincere\Desktop\Claude\AgentPortal\MKTAgent`, start the API on **port 7100** (the app's usual `npm run dev` / server entry). Confirm `GET http://localhost:7100/health` (or any route) responds.
- **Web (Vite/React):** `cd web && npm run dev` → default **http://localhost:5173** (`web/package.json` → `"dev": "vite"`).
- **Auth:** the app gates on Google sign-in (`App.tsx` → `loginUrl()`); sign in as `auto.agent.solution@gmail.com`. For headless/browser-driver runs, the known auth-bypass recipe is: mint a session server-side and inject the `mkt_session` cookie.

### 0.2 Feature flags / crons the tester must know
- **Autonomy cron** (`orchestration/autonomy/autonomy-cron.ts`) runs every 2 min ONLY when `ENABLE_AUTONOMY_CRON=1`. Sections G/H depend on it — either enable the flag before the run, or invoke `runAutonomyOnce()` manually (see G-note).
- **Scheduler cron** (`scheduler/tick.ts`) fires every minute; publishes one due `ready` post per tick.
- **DRY-RUN is the safe default.** The autonomy path forces DRY publish (`autonomy-runner.ts` → `dryAutonomyPublish`, never reaches a real platform). Manual publish-now performs a REAL social write only for connected platforms — keep demo connections in dry/safe posture unless a live post is explicitly intended.

### 0.3 How to read a test case
- **Precond** = state required before starting. **Steps** = exact clicks. **Expected** = concrete observable result. Tick `[ ]` items as you go; mark the **Result** box **PASS** / **FAIL** and note the build/console evidence.
- **Console watch (applies to EVERY case):** keep DevTools Console + Network open. A case does **not** pass if it logs an uncaught error, a failed XHR that breaks the view, or a React key/hook warning storm.
- **Overflow watch:** at every viewport, the page body must **never scroll horizontally**; wide content scrolls inside its own container.

### 0.4 Viewports
Run Section A twice: **Desktop** (≥1280px) and **Narrow (~380px)** (mobile emulation). Other sections run at Desktop unless noted.

---

## Section A — Shell / Regression (P0)

> Grounded in `web/src/components/top-nav.tsx`, `web/src/app-nav.ts`, `web/src/App.tsx`, `workspace-menu.tsx`.
> Top nav order (`NAV` array): Command Center `◈`, Impact `📈`, Instructions `⚙`, Connections `🔌`, Usage `📊`, Scheduled `◷`, Knowledge `📚`, Leads `🎯`. Right cluster: Chats `💬 ▾`, Workspace `⌂ ▾` (+ count), credit `◈ N`, theme toggle (`◐`/`☼`), user email.

### A1 — Default landing is Command Center
- **Precond:** Signed in, fresh load of `/`.
- **Steps:** Load the app.
- **Expected:**
  - [ ] Landing page is the **Command Center** (dark "Neural Network" surface), not the chat or a sidebar (`App.tsx` default `page='command-center'`).
  - [ ] Top nav renders 8 destination items + right cluster; brand reads **Atria / COMMAND CENTER**.
  - [ ] No console errors; no horizontal scrollbar.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### A2 — Every top-nav destination routes (no dead routes)
- **Precond:** Signed in.
- **Steps:** Click each nav item in order and confirm its surface renders.
- **Expected (one checkbox per destination):**
  - [ ] **Command Center** (`◈`) → neural graph + command bar.
  - [ ] **Impact** (`📈`) → Impact report ("last 30d"); if a campaign is active also a per-campaign block (`App.tsx` impact branch → `ImpactReport period="30d"`).
  - [ ] **Instructions** (`⚙`) → "Atria Instructions" editor (`InstructionEditor scope="workspace"`).
  - [ ] **Connections** (`🔌`) → `ConnectionsPanel`.
  - [ ] **Usage** (`📊`) → `UsageDashboard`.
  - [ ] **Scheduled** (`◷`) → "◷ Scheduled" view (Upcoming / Recently published).
  - [ ] **Knowledge** (`📚`) → `ProductKnowledgeLibrary`.
  - [ ] **Leads** (`🎯`) → `LeadsPage`.
  - [ ] Active nav item shows the `is-active` highlight matching the shown page.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### A3 — Chats ▾ menu (search / select / delete)
- **Precond:** At least 1 chat exists (create one via Section B first if empty).
- **Steps:** Click **💬 Chats ▾**. Type into "Tìm chat…". Click a chat name. Reopen, click a chat's `×`.
- **Expected:**
  - [ ] Panel opens; search input auto-focuses and filters by title (case-insensitive, `top-nav.tsx` `filtered`).
  - [ ] Empty search state shows "Chưa có chat nào" when no matches.
  - [ ] Clicking a name opens that chat inside the Command Center (`selectChat` → `ccChatOpen`, page=command-center) and closes the menu.
  - [ ] `×` prompts `Delete "<title>"?`; confirming removes the row and toasts "Chat deleted".
  - [ ] Clicking outside the menu closes it (outside-click handler).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### A4 — Workspace ▾ menu (open / continue-chat / delete / count badge)
- **Precond:** At least 1 workspace/campaign exists (create via Section B→materialize, or an existing campaign).
- **Steps:** Click **⌂ Workspace ▾**. Observe the count badge. Open a workspace. Reopen menu, click `💬` (continue chat) on a workspace. Reopen, click `×` (delete).
- **Expected:**
  - [ ] Button shows a **count badge** equal to workspace count (`workspace-menu.tsx` `cc-ws-menu-count`); header reads "Workspaces · N".
  - [ ] Each row shows a status dot (running/held/failed/posted/planned priority) + name.
  - [ ] Row name → opens that workspace's drawer on the Command Center (`onOpenWorkspace` → `openWorkspaceFromNav`).
  - [ ] `💬` continue-chat is **disabled** when `chatSessionId` is null (title "Chưa có hội thoại liên kết"); enabled rows reopen the originating chat.
  - [ ] `×` prompts `Xoá workspace "<name>"? Toàn bộ post trong đó sẽ bị xoá.`; confirming deletes (cascade) and toasts "Đã xoá workspace"; badge count decrements.
  - [ ] "⤴ Về giao diện cổ điển" (exit to classic) returns to Command Center.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### A5 — Theme toggle + credit display
- **Steps:** Click the theme toggle (`◐`/`☼`). Read the credit chip.
- **Expected:**
  - [ ] Toggling flips app theme (`theme-light`/`theme-dark` on `app-root`); Command Center stays dark-skinned regardless.
  - [ ] Credit chip shows `◈ <number>` from `GET /orchestration/usage` (`—` while loading), matching Usage page total.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### A6 — Narrow viewport (~380px) full regression
- **Precond:** DevTools device emulation at 380px width.
- **Steps:** Repeat A1–A5 at 380px. Open Chats ▾ and Workspace ▾ menus; open the CC drawer.
- **Expected:**
  - [ ] No horizontal page overflow anywhere; nav items/labels wrap or truncate gracefully (icons remain tappable).
  - [ ] Dropdown menus (Chats/Workspace) fit within the viewport and are scrollable if long.
  - [ ] The CC drawer (`.cc-drawer`) and embedded post views don't force body-level horizontal scroll (wide DAG/tables scroll inside their own container).
  - [ ] No console errors during any interaction.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

---

## Section B — Plan a Campaign via Atria chat

> Grounded in `OrchestratePanel.tsx`, `orchestration-router.ts` (`POST /orchestration/runs`, `/clarify`, `/save`), `orchestrate-run-cards.tsx` (PlanCard/SaveOfferCard).

### B1 — Natural-language intake opens a chat
- **Precond:** Command Center home.
- **Steps:** In the command bar (`Ra lệnh cho Atria…`) type a real goal, e.g. *"Tạo chiến dịch marketing cho khoá học AI automation, đăng Facebook và Instagram"*, press **➤** (or Enter).
- **Expected:**
  - [ ] Graph collapses to a mini-hero; chat embeds in the CC (`cc-chat-embed`), back button "← Trung tâm điều hành" present.
  - [ ] User bubble appears immediately; an animated **"Thinking…"** bubble shows while the LLM runs (`thinking-bubble`).
  - [ ] Atria replies in the **same language** as the request (Vietnamese in → Vietnamese out), restating intent (`recordTurn` authored reply).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### B2 — Clarification as prose (only high-impact questions)
- **Precond:** A goal thin on detail (omit product specifics).
- **Steps:** Send a deliberately vague goal, e.g. *"Launch a post for our new feature"*.
- **Expected:**
  - [ ] Atria asks the missing high-impact questions **as prose in a chat bubble** (no form dump).
  - [ ] Answering in free text (type answers, send) merges into the goal and advances toward a plan (refine path — `masterAgent.refine`, `PRE_EXEC`).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### B3 — Plan card with credit forecast
- **Precond:** Goal has enough detail to plan.
- **Steps:** Continue until the **PlanCard** renders.
- **Expected:**
  - [ ] A plan card appears in-chat listing the DAG steps (agents/nodes).
  - [ ] The card shows a **credit forecast/estimate** for the plan and a default flow name prefilled from the product (`PlanCard defaultName` = goal.slots.product).
  - [ ] Refining via free text ("thêm video", "bỏ infographic") re-plans the same run in place (nodes update, no duplicate run).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### B4 — Save / approve the plan → Save-offer
- **Steps:** Click **Save** on the PlanCard (enter/confirm a name).
- **Expected:**
  - [ ] Toast `Flow "<name>" saved`; an assistant **offer bubble** appears.
  - [ ] A **SaveOfferCard** renders with actions: **Set up first campaign**, **Run a test post**, **Open flow**.
  - [ ] The saved flow appears in the Chats history and (once a campaign is set up) the Workspace menu.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### B5 — Campaign strategist → calendar → materialize (multi-post workspace)
- **Precond:** A goal that triggers the campaign strategist (a multi-post campaign, not a single post).
- **Steps:** Follow the plan to the strategist's content-calendar gate; edit slots if offered; approve/materialize.
- **Expected:**
  - [ ] A content calendar is presented; approving calls `POST /runs/:id/materialize-calendar`.
  - [ ] A new campaign/workspace is created and populated with scheduled `brief` posts; navigation lands on the new workspace/board.
  - [ ] Partial-skip (if any slot fails to plan) is surfaced, not silently dropped.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

---

## Section C — Content generation per asset type

> Grounded in `post-workflow-view.tsx`, `run-dag-view.tsx`, `concept-selection-gate.tsx`, `orchestration-router.ts` (`/execute`, `/rerun-node`, `/approve-node`), `posts-router.ts` (`/edit-copy`, `/refine`, `/select-variant`).
> Each sub-flow: open a post's workflow (via Workspace drawer → post row, or the board), then Execute.

### C0 — Open a post workflow & inspect the DAG shell
- **Precond:** A campaign post with a backing run exists.
- **Steps:** Open the post's `PostWorkflowView` (Workspace drawer → post → the run opens).
- **Expected:**
  - [ ] Header shows "Workflow · N steps"; status hint matches state (`planned` → "Ready to run — click Execute…").
  - [ ] DAG is open by default (no collapse); each node shows a status dot.
  - [ ] For a fresh `planned` run, an **▶ Execute** button is present.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### C1 — TEXT-only post
- **Precond:** A post whose plan has NO media step (text/copy only).
- **Steps:** Click **▶ Execute**. Watch nodes light up. Click the concept node to inspect. When it parks at the concept gate, pick a version and Continue; proceed to the publisher gate.
- **Expected:**
  - [ ] On execute, the next runnable node optimistically flips to `running` (`markRunning`); nodes advance via SSE (`useRunEvents`).
  - [ ] concept_writer produces copy variants; the concept selection gate lets you pick one (`ConceptSelectionGate`).
  - [ ] No infographic/storyboard/video node runs (text-only).
  - [ ] Run reaches the publisher gate (`needs_approval`), copy visible per-platform (body/threads/x).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### C2 — IMAGE post (infographic)
- **Precond:** A post whose plan includes the `infographic` step.
- **Steps:** Execute. Watch the DAG. After concept, let/approve the infographic step run. Click the infographic node to inspect the artifact.
- **Expected:**
  - [ ] Infographic node runs (~image-gen latency) and lights up; selecting it shows the generated **image** in the artifact view (`selectedView.imageUrl`).
  - [ ] `hasMediaStep` is true → the concept gate notes an uploaded reference image would condition generation.
  - [ ] Run parks at the publisher gate with image attached.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### C3 — VIDEO post (storyboard → video cost gate)
- **Precond:** A post whose plan includes `storyboard` + `video`.
- **Steps:** Execute. Let storyboard run. At the **video gate** (`needs_approval`, `gateNode.agentId==='video'`) review frames, then **▶ Approve — generate video**. Inspect the video artifact.
- **Expected:**
  - [ ] Status hint reads "Paused before video generation (the costly step)…".
  - [ ] Storyboard frames render as a gallery (`selectedView.imageUrls`); approving triggers video gen.
  - [ ] After gen, the video node shows a playable `<video controls>` artifact (`selectedView.videoUrl`).
  - [ ] Video is NOT generated before explicit approval (cost gate holds).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### C4 — Concept version pick (review mode)
- **Precond:** A completed concept step with >1 variant.
- **Steps:** Select the concept node after it completed; use the review picker to change the chosen version.
- **Expected:**
  - [ ] Version picker shows all variants with the chosen one marked (`conceptChosen`); picking calls `/select-variant`, sets `post.copy`, persists `chosen` index.
  - [ ] Reloading the run reflects the new pick.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### C5 — Edit copy (manual, no LLM)
- **Steps:** On the selected concept node, click **✎ Edit copy**, change Body/Threads/X, **Save copy**.
- **Expected:**
  - [ ] Inline editor opens with 3 textareas; Save calls `POST /posts/:id/edit-copy`, toasts "Copy updated", run reloads with new copy.
  - [ ] Post returns to `review` state (no token spend for a plain edit).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### C6 — Refine with AI (LLM instruction)
- **Steps:** Click **✨ Refine with AI**, enter e.g. *"shorten the hook, warmer tone"*, click **Refine**.
- **Expected:**
  - [ ] Refine calls `POST /posts/:id/refine`; toast "Copy refined"; copy updates per the instruction while preserving intent.
  - [ ] A concurrent copy-gen returns 409 `copygen_busy` gracefully (no crash) if triggered twice fast.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### C7 — Re-run a single node
- **Steps:** On a completed non-publisher node, click **↻ Re-run this step**.
- **Expected:**
  - [ ] Node re-runs; downstream nodes are marked stale/pending; hint tells you to Continue to regenerate them.
  - [ ] Re-running the publisher is blocked; re-running an already-posted chain returns 409 `already_posted` (no re-post).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

---

## Section D — Style enrichment by user instruction

> Grounded in `instruction-editor.tsx` (`/instructions`), `memory-panel.tsx` (`/memory`), and the executor honoring `source:'memory'` + workspace instructions in every agent prompt.

### D1 — Add a workspace instruction
- **Steps:** Instructions page → add e.g. *"Always end with a question. Never use emojis. Warm, expert tone."* → **Add**.
- **Expected:**
  - [ ] Row appears enabled; toast "Instruction added — Atria will honor it across your content."
  - [ ] Toggling the checkbox disables/enables it; `×` deletes.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### D2 — Generated copy honors the instruction
- **Steps:** With D1 enabled, run C1/C2 concept generation on a NEW post; read the generated copy.
- **Expected:**
  - [ ] Copy reflects the instruction (ends with a question, no emojis, warm tone).
  - [ ] Disabling the instruction and re-running concept produces copy that no longer forces the rule (proves it's the steer, not coincidence).
  - [ ] Hard limits (length/platform caps) still apply regardless.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### D3 — Memory style rules (learned from edits)
- **Precond:** At least 3 hand-edited posts (do C5 a few times).
- **Steps:** Command Center → click the **🧠 Memory** node → **Analyze my edits** → **Remember** a proposal.
- **Expected:**
  - [ ] With <3 edited posts, it says to edit a few more first.
  - [ ] With ≥3, it proposes style rules; **Remember** writes a `source:'memory'` instruction (shows "learned" badge on the Instructions page).
  - [ ] A subsequent concept draft honors the learned rule; **Forget** removes it.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

---

## Section E — Manual publish

> Grounded in `post-workflow-view.tsx` publisher gate + `PublishReview`, `posts-router.ts` (`/publish-now`, `/postability`, `/approve`), `scheduler/tick.ts` (`processPost`).

### E1 — Publisher gate + postability review
- **Precond:** A run parked at the publisher gate (`needs_approval`, `gateNode.agentId==='publisher'`).
- **Steps:** Observe the `PublishReview` block (per-platform publishable/blocked).
- **Expected:**
  - [ ] Each target platform shows publishable vs blocked with a reason (asset unsupported OR connection state), from `GET /posts/:id/postability`.
  - [ ] A platform publishes only when asset supported AND connection live.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### E2 — Connection gate redirect
- **Precond:** A run whose target platform is not connected.
- **Steps:** Execute a run needing an unconnected platform.
- **Expected:**
  - [ ] Run parks at `needs_connection`; a connect card or "🔌 Go to Connections" button routes to Connections (`onOpenConnections`).
  - [ ] After connecting, "Check connection & run" resolves and proceeds ($0 spent before connection — gate is pre-executor).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### E3 — Approve → publish now (DRY default)
- **Precond:** Publisher gate, schedule field left EMPTY, demo connections in safe/dry posture.
- **Steps:** Leave schedule blank, click **Approve publisher**.
- **Expected:**
  - [ ] Empty schedule → publish now path (`approve-node` with no scheduledAt); toast "Publishing…".
  - [ ] Post transitions to `posted`/`partial`; publish result URLs surface on the DAG (`publishUrls`).
  - [ ] **SAFETY:** no real outward post fires unless a live connection is deliberately configured. Confirm the result is dry-run/simulated in the demo posture.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### E4 — Impact reflects the publish
- **Steps:** After E3, open **Impact** (30d and, if applicable, the campaign block).
- **Expected:**
  - [ ] `posts published` count and `platforms` increment to include the just-published post.
  - [ ] Spend (`usdSpent`/`creditsSpent`) reflects the run's cost.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

---

## Section F — Scheduled publish

> Grounded in publisher gate schedule input (`post-workflow-view.tsx`), `approve-node` scheduledAt → `setPostSchedule` (`orchestration-router.ts`), `scheduled-view.tsx`, `scheduler/tick.ts` (`findPublishDueBatch`, `isPublishBlocked`).

### F1 — Approve with a FUTURE datetime → post parks scheduled
- **Precond:** Publisher gate.
- **Steps:** In "Schedule (optional)" pick a time ~3–5 min in the future; click **📅 Approve + schedule**.
- **Expected:**
  - [ ] Toast "Scheduled for <time>"; the post is parked `ready` with `scheduledAt` (not published inline — executor parks future-scheduled posts).
  - [ ] The button label switches to "📅 Approve + schedule" when a future time is set.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### F2 — Appears in Scheduled view
- **Steps:** Go to **Scheduled** (`◷`).
- **Expected:**
  - [ ] The post appears under **Upcoming (N)** with its scheduled time and platforms (`scheduled-view.tsx` `upcoming`).
  - [ ] Rows nearing/at due time get the `due` highlight.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### F3 — Scheduler fires at time (DRY-verify)
- **Precond:** Scheduler cron running; demo connections safe.
- **Steps:** Wait until the scheduled time passes (≤1 min after due). Refresh Scheduled.
- **Expected:**
  - [ ] Within ~1 tick after due, the post moves out of Upcoming into **Recently published** (`posted`/`partial`).
  - [ ] A post whose run is still producing/parked is DELAYED (not published early) — `isPublishBlocked` holds it.
  - [ ] No real outward post fires in safe posture (DRY/simulated result).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

---

## Section G — Autonomous ("⚡ Chuẩn bị") per-post grant

> Grounded in `post-workflow-view.tsx` grant, `workspace-panel.tsx` grant, `scheduled-view.tsx` grant, `posts-router.ts` (`/grant-autonomy`), `autonomy-runner.ts`, `autonomy-cron.ts`.
> **G-note (cron):** ensure `ENABLE_AUTONOMY_CRON=1`, OR trigger a sweep manually via `runAutonomyOnce()` between steps. Cadence is every 2 min.

### G1 — Grant a planned post (2-step forecast → confirm)
- **Precond:** A fresh `planned` campaign post with a backing run (`canGrant`).
- **Steps:** Open the post workflow → click **⚡ Chuẩn bị**. Observe the forecast. Click **Xác nhận**.
- **Expected:**
  - [ ] Step 1 (`POST /grant-autonomy`, no token) surfaces the credit forecast `≈ N cr?` + a confirmation token — **nothing granted yet**.
  - [ ] Step 2 (**Xác nhận**, echoes token, `scheduleConfirmed:true`) toasts "Đã cấp quyền — Atria đang chuẩn bị nội dung rồi dừng ở review."
  - [ ] **Huỷ** cancels without granting.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### G2 — "Atria đang chuẩn bị" state
- **Steps:** Stay on the granted post's workflow.
- **Expected:**
  - [ ] Execute/grant buttons are suppressed (`isAtriaGranted`); the **preparing** banner shows "Atria đang chuẩn bị nội dung — sẽ dừng ở bước review để bạn duyệt." with a pulsing dot.
  - [ ] The view polls (~8s) while `approvalMode==='atria'` and status planned/running.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### G3 — Cron prepares → parks at needs_approval (NOT auto-published)
- **Precond:** Autonomy cron enabled or a manual sweep triggered.
- **Steps:** Wait for the sweep (or trigger it). Refresh.
- **Expected:**
  - [ ] The run is claimed and executes pre-steps through the SAME gated executor with `autoPublish:false`.
  - [ ] The run **parks at `needs_approval`** before the publisher — it does **NOT** auto-publish.
  - [ ] **SAFETY ASSERTION (critical):** even if it reached the publisher, the autonomy publish fn is DRY (`dryAutonomyPublish`) — nothing hits a real platform before human approval. A run whose platforms aren't connected parks at `needs_connection` instead.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### G4 — Human approve → scheduled publish
- **Steps:** Review the prepared content, approve at the publisher gate (optionally with a future time).
- **Expected:**
  - [ ] Approval publishes now, or with a future time parks `ready` for the scheduler (Section F semantics).
  - [ ] Only AFTER human approval can a real publish occur (in a live-connected posture).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### G5 — Grant entry points parity (Workspace / Scheduled)
- **Steps:** Repeat G1 from the **Workspace panel** post list (`⚡ Chuẩn bị` on a `planned` post) and from the **Scheduled view** (`⚡ Chuẩn bị` on a `brief` post).
- **Expected:**
  - [ ] Both surfaces show the same 2-step forecast→confirm and end in the preparing state (`workspace-panel.tsx`, `scheduled-view.tsx`).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

---

## Section H — Campaign-level grant

> Grounded in `orchestration-router.ts` `POST /runs/:id/grant-autonomy` (run-level, double-confirm token), workspace panel / scheduled surfaces.

### H1 — Grant a whole planned campaign flow
- **Precond:** A planned/executable run (campaign flow) not yet run.
- **Steps:** From the workspace/flow surface, grant autonomy on the run (2-step token confirm), `scheduleConfirmed:true`.
- **Expected:**
  - [ ] Step 1 issues a token WITHOUT granting; step 2 flips `approvalMode → 'atria'` (audited `atria_grant`).
  - [ ] A template flow refuses direct grant (409 `template_not_executable`) — grant applies to an instance run.
  - [ ] The autonomy cron then prepares each granted run and parks pre-publish (same safety as G3).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### H2 — Multi-post campaign: each post parks for review
- **Precond:** A materialized multi-post campaign, posts granted.
- **Steps:** Grant, let the sweep run, open the Workspace panel.
- **Expected:**
  - [ ] Status counts show posts moving planned → (running) → **held/needs-you**; none jump to `posted` without approval.
  - [ ] "Cost by agent" accrues as prep runs; workspace credit total updates live (SSE `●`).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

---

## Section I — WOW: neural graph & live node light-up

> Grounded in `command-center-page.tsx` (`useAgentActivity`, `is-conducting`, `cc-node.is-running`, `cc-link-live`), `hooks/use-agent-activity.ts` (SSE).

### I1 — Nodes light up during a REAL run
- **Precond:** A run actively executing (start C1/C2 and return to the Command Center while it runs).
- **Steps:** With a run in flight, view the Command Center graph.
- **Expected:**
  - [ ] Agents that are `running` right now get the `is-running` state; their edge to the core animates (`cc-link-live`, higher opacity/stroke).
  - [ ] The graph + core enter **`is-conducting`** while any agent runs (`anyRunning`).
  - [ ] As the run advances, the lit node/edge follows the active agent; returns to idle when the run ends.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### I2 — The "conducting" core & dark styling
- **Steps:** Inspect the Atria core node and overall dark skin.
- **Expected:**
  - [ ] Core reads "Master Agent / Atria / Nhạc trưởng"; clicking it opens the chat (`onLaunch()`).
  - [ ] Dark "Neural Network" theme is confined to `.command-center`; the drawer is light.
  - [ ] Legend dots match group colors; `planned` vision nodes show a "soon" pill and toast "sắp ra mắt" instead of opening.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### I3 — Alive amplification (typewriter / breathing)
- **Steps:** Send a chat message and watch the newest agent reply.
- **Expected:**
  - [ ] Only the newest agent bubble types out (`TypewriterText animate`); restored history renders instantly (no re-typing).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

---

## Section J — Voice (read-aloud)

> Grounded in `read-aloud-button.tsx`, `voice-router.ts` (`POST /voice/tts`, WAV, hash-cached).

### J1 — Read an Atria reply aloud
- **Precond:** A chat with at least one non-empty agent bubble.
- **Steps:** Click the speaker (`🔊`) on an agent bubble (`bubble-tts`).
- **Expected:**
  - [ ] Icon goes to loading `…` then playing `⏸`; audio plays the bubble text.
  - [ ] First call has a noticeable latency (~5s TTS synth); note it.
  - [ ] Clicking `⏸` toggles playback off (back to `🔊`).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### J2 — Read the Impact report aloud
- **Steps:** Impact page → click the speaker next to the "Impact" heading (`impact-tts`).
- **Expected:**
  - [ ] Plays the composed narration (headline + spent + posts + leads + measured reach + savings) — see `impact-report.tsx` `narration`.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### J3 — Only one narration at a time
- **Steps:** Start J1, then (while playing) start J2.
- **Expected:**
  - [ ] Starting the second pauses the first (module-level `currentAudio`); only one plays. The first button resets to `🔊`.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### J4 — Cached repeat is instant + free
- **Steps:** Play the same bubble text again after it finished.
- **Expected:**
  - [ ] Second play of identical text returns near-instantly (server WAV cached by text hash) and is not re-charged (`recordMediaCost` only on non-cached).
  - [ ] Scrolling the bubble away / unmounting stops its audio (no orphan playback).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

---

## Section K — Insights / Impact

> Grounded in `impact-report.tsx` (`campaignImpact` / `periodImpact`), measured-vs-estimated sections.

### K1 — Measured vs estimated separation
- **Steps:** Open Impact (30d).
- **Expected:**
  - [ ] A **Measured** block (spent, posts published, platforms, media pieces, leads, and — when available — reach/engagements labeled by source `FB/IG/TH/X`).
  - [ ] A visually distinct **Estimated** block with an `estimate` badge (cost saved vs agency, time saved, and est. reach only when no measured reach).
  - [ ] Assumptions line shows agency day rate / hours-per-post / reach-per-post.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### K2 — Per-campaign vs 30d
- **Steps:** With an active campaign, open Impact; compare the "(this campaign)" block to "(last 30d)".
- **Expected:**
  - [ ] Per-campaign numbers scope to that campaign; the 30d block aggregates across the window.
  - [ ] Measured reach shows null-gracefully (falls back to estimate) — expected on small FB pages (reach withheld).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

---

## Section L — Cross-cutting

> Grounded in `orchestration-router.ts` (`/usage`, `/killswitch`, `/runs/:id/abort`), connection gates, empty/error states.

### L1 — Credits / usage accuracy
- **Steps:** Note the top-nav credit chip; open **Usage**.
- **Expected:**
  - [ ] Usage total matches the top-nav chip (`GET /orchestration/usage`).
  - [ ] Per-surface breakdown present (chat, intake, copygen, research, orchestration, voice, etc.); after running C/E flows the totals increase consistently.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### L2 — Kill switch (global external-actions pause)
- **Steps:** Toggle the global kill switch (`POST /orchestration/killswitch {paused:true}`). Attempt a publish.
- **Expected:**
  - [ ] With external actions paused, the connector runtime refuses every external write platform-wide (no publish reaches a platform).
  - [ ] Un-pausing restores publishing. Toggle is audited.
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### L3 — Run abort
- **Steps:** Start a run, then abort it (`POST /runs/:id/abort`).
- **Expected:**
  - [ ] Run flips to `aborted`; the detached executor stops at the next node boundary; a terminal run refuses re-abort (409).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### L4 — Empty / error states
- **Steps:** Visit Scheduled with nothing scheduled; Leads/Impact with no data; trigger a failed step.
- **Expected:**
  - [ ] Scheduled empty → "Nothing scheduled…" guidance; Impact empty → "No impact data yet."; Memory empty → guidance to edit posts.
  - [ ] A failed node shows the failed dot + hint "A step failed — fix and re-run"; a stale card firing Approve on a moved-on post self-corrects (no dead-end 409).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

### L5 — Connection-required redirects (regression)
- **Steps:** From a gated run and from the board, click through the connection prompts.
- **Expected:**
  - [ ] Every "needs connection" surface offers a route to Connections and returns to the run after connecting (no stranded state).
- **Result:** ⬜ PASS ⬜ FAIL — notes: ______________________

---

## Demo happy-path script (the exact click sequence)

> Target: ~7–9 minutes. Shows the **4 headline flows** (plan → generate → grant/autonomy → impact) + **forecast** + **voice**. Have `ENABLE_AUTONOMY_CRON=1` and connections in safe/DRY posture BEFORE starting.

| # | Action | Shows | ~Time |
|---|--------|-------|-------|
| 1 | Land on **Command Center**; hover the neural graph, click the **Atria core** | WOW graph + core | 0:20 |
| 2 | In the command bar type *"Tạo chiến dịch cho khoá học AI automation, đăng Facebook + Instagram"* → **➤** | NL intake, same-language reply | 0:40 |
| 3 | Answer the one clarifying question in free text | Prose clarify (no form) | 0:30 |
| 4 | On the **Plan card**, point out the **credit forecast**, then **Save** | Plan + forecast (headline flow 1) | 0:30 |
| 5 | From the Save-offer, **Set up first campaign** / open the workspace; open a post's workflow → **▶ Execute** | Content generation + DAG light-up | 1:20 |
| 6 | Switch to **Command Center** briefly while it runs — nodes light up / core "conducting" | Live WOW (SSE) | 0:20 |
| 7 | Back on the post: inspect the image artifact, **✨ Refine with AI** ("warmer tone") | Quality controls (headline flow 2) | 0:40 |
| 8 | On a second **planned** post click **⚡ Chuẩn bị** → show forecast → **Xác nhận** | Autonomy grant + forecast (headline flow 3) | 0:40 |
| 9 | Show the **"Atria đang chuẩn bị"** banner; note it will PARK at review (safety) | Safety story | 0:20 |
| 10 | At the publisher gate on the first post, set a **future time** → **📅 Approve + schedule**; open **Scheduled** to show it queued | Scheduled publish | 0:40 |
| 11 | Open **Impact** — measured vs estimated; click the **🔊 speaker** to have Atria read the report | Impact + Voice (headline flow 4) | 0:40 |
| 12 | (Optional) Play a chat bubble's 🔊 to show one-at-a-time voice | Voice polish | 0:20 |

---

## Known constraints / safe-demo notes

- **DRY-RUN is the safe default.** The autonomy path is hard-wired DRY (`dryAutonomyPublish`) and parks pre-publish (`autoPublish:false`); it never writes to a real platform. Manual **Publish now** / scheduled publish perform a REAL write only for genuinely-connected platforms — keep the demo tenant in dry/safe posture unless a live post is intended.
- **No burst social posts.** Never fire multiple rapid real posts (Meta 24–48h ban risk). `ok:true` ≠ a playable/real post in dry mode. The scheduler publishes at most one post per minute by design.
- **TTS first-call latency ~5s.** The first `/voice/tts` for a given text synthesizes (~5s) and charges $0.02; repeats of identical text are cached (instant + free). Pre-warm the demo narration once before presenting.
- **FB post-reach is null on small pages.** Graph v25 withholds `post_impressions*`/`post_engaged_users` for pages <100 followers → measured reach shows null and Impact gracefully falls back to the estimate. This is expected, not a bug.
- **Autonomy cron cadence.** Grants only progress when `ENABLE_AUTONOMY_CRON=1` and only every ~2 min. For a live demo, enable it ahead of time or trigger `runAutonomyOnce()` to avoid dead air.
- **Video gen is slow + paid.** The video step can take ~60s and costs credits; the cost gate intentionally holds before generation. Budget demo time or use a pre-generated post.
- **Auth for automation.** Browser-driver sessions need the `mkt_session` cookie injected (mint server-side) since the app gates on Google sign-in.
- **Per-post grant is NOT yet e2e-verified** (per project memory) — treat Sections G/H as the highest-risk demo path; rehearse them first.

---

## Sign-off summary

| Section | Cases | Pass | Fail |
|---------|-------|------|------|
| A Shell/Regression | 6 | | |
| B Plan a campaign | 5 | | |
| C Content generation | 8 | | |
| D Style enrichment | 3 | | |
| E Manual publish | 4 | | |
| F Scheduled publish | 3 | | |
| G Per-post grant | 5 | | |
| H Campaign grant | 2 | | |
| I WOW graph | 3 | | |
| J Voice | 4 | | |
| K Insights/Impact | 2 | | |
| L Cross-cutting | 5 | | |
| **Total** | **50** | | |

**Demo-ready gate:** all Section A (P0 regression) + the 4 headline flows (B4, C2/C3, G3, K1) + J (voice) must PASS. Section G safety assertion (nothing publishes before human approval) is a **hard blocker** — a FAIL there stops the demo.
