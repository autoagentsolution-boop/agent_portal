# FEATURES — AgentPortal / MKTAgent

Full inventory of routes, pages, API endpoints, background jobs, data model, and business-logic workflows. Generated from a codebase scan of `MKTAgent/` (Express 5 backend `src/` + Vite/React SPA `web/`).

**What it is:** A marketing-automation platform where a conversational AI ("Atria") reasons over user requests and orchestrates a *closed registry of agent nodes* into a DAG that researches, writes copy, produces media (images/video), and publishes to social platforms — behind human (or granted-autonomous) approval gates, with a fleet of self-healing background crons, lead capture, and ROI reporting.

**Stack:** Express 5 · Prisma 7 (Postgres) · Zod · Google/Gemini · React 18 + Vite (custom nav SPA, no react-router) · SSE for live status. Port `7100`.

---

## Table of Contents
1. [Frontend Pages & Navigation](#1-frontend-pages--navigation)
2. [HTTP API Endpoints](#2-http-api-endpoints)
3. [Logic & Data Workflows](#3-logic--data-workflows)
4. [Background Jobs (Cron)](#4-background-jobs-cron)
5. [Data Model](#5-data-model)
6. [Configuration & Feature Flags](#6-configuration--feature-flags)

---

## 1. Frontend Pages & Navigation

**Model:** Single-page SPA, no react-router. `App.tsx` holds `useState<Page>('command-center')` switched via a conditional in `<main>`. `Page` union (`web/src/app-nav.ts`):
`command-center | flows | connections | product-knowledge | leads | usage | instructions | impact | scheduled`.

**Global chrome — `TopNav`** (on every page): brand → Command Center; 8-item primary nav (Command Center ◈, Impact 📈, Instructions ⚙, Connections 🔌, Usage 📊, Scheduled ◷, Knowledge 📚, Leads 🎯); **Chats ▾** dropdown (search/select/delete chat); **Workspace ▾** dropdown (`workspace-menu.tsx` — status dot, continue-chat 💬, delete ×, exit to classic); credits total + user email. Bilingual UI (Vietnamese-first + English). Unauthenticated → "Sign in with Google" card (`useAuth`).

| Page (nav key) | File | Purpose & Key Features |
|---|---|---|
| **Command Center** (`command-center`) *default* | `command-center-page.tsx` | Operating HUB — dark "Neural Network" canvas of real agent registry nodes from `GET /orchestration/agents`. Central **Atria core** + orbital agent nodes grouped/colored by division; live SSE "light-up" of running agents (`useAgentActivity`), animated data-flow dots. NL command bar + quick-command chips → hands to Orchestrate chat. Proactive "Nhắc nhở từ Atria" suggestion cards + resume-work cards. Node click → inline right **drawer** (not redirect): Workspace panel / Agent spotlight / Memory / Impact / Leads / Email surfaces. |
| **Orchestrate Chat** *(hosted inside Command Center)* | `OrchestratePanel.tsx` | Conversational Master Agent. Goal → Atria restates intent, asks questions as prose, presents planned DAG as in-chat **PlanCard**. Free-text refinement ("thêm video"/"bỏ infographic"). Actions: Save as flow, Duyệt & Chạy ngay (approve+execute), SaveOfferCard (campaign/test post/open flow). **Voice mode:** hands-free STT-in / TTS-out (mic push-to-talk, barge-in, Esc exit), read-aloud on replies. |
| **Active Flows** (`flows`) | `ActiveFlowsPage.tsx` | 3 sub-states: **(a) Saved flow** (`saved-flow-detail.tsx`): run DAG view, Execute/Re-run/Abort, **plan-tier cards** (Economy/Balanced/Full), rename, cost strip, per-node output viewer, approval gates (publisher approve; strategist gate → Content Calendar), connection-required block. **(b) Campaign** (`PostBoard.tsx`): breadcrumb, Safe/Live demo toggle, SSE-live posts, "+ New full brief" (Manual/Master Agent), product-knowledge upload. **(c) Empty** → create-flow. **PostCard**: Edit brief, Generate copy, Approve/schedule, Refine copy, Reject+rework, Publish now (Live-gated), Delete; embedded `PostWorkflowView` DAG, published URLs. **Content Calendar** (`content-calendar.tsx`): edit strategist slots → Approve & schedule → materialize → 2-step autonomy grant with upfront cost. |
| **Connections** (`connections`) | `ConnectionsPanel.tsx` | Per-platform cards (connected/needs-attention/not-connected), capability chips, Connect/Reconnect (OAuth) or Paste token. **Storage:** Local (always) + Google Drive connect (for IG/Threads public image URLs). **Kill switch:** emergency pause/resume of ALL external actions. |
| **Usage & Credits** (`usage`) | `UsageDashboard.tsx` | Cost strip (USD/tokens/credits/calls) + per-surface breakdown bars (chat, intake, copygen, research, lead-rescore, product-analysis, orchestration). |
| **Product Knowledge** (`product-knowledge`) | `ProductKnowledgeLibrary.tsx` | Reusable product profiles. Import product (PDF/img/txt → Gemini analysis → saved profile), inline edit (name/details/brand voice), delete. Lists read-only per-campaign `brandContext`. |
| **Leads** (`leads`) | `LeadsPage.tsx` | Lead Collector. Intake-token setup (mint once / revoke) for funnel/form/Cal.com/webhook. Poll-comments action; per-post collectors (start/stop/extend keyword, link-liveness 🟢🔴⚪). Leads table: hybrid intent score (hot/warm/cold), reasons, AI re-score per lead. |
| **Instructions** (`instructions`) | `instruction-editor.tsx` | ChatGPT-style custom instructions Atria layers into every agent prompt: add / enable-toggle / delete; marks memory-learned rules; per-campaign scope. |
| **Impact** (`impact`) | `impact-report.tsx` + `campaign-command-view.tsx` | Value report: measured stats (spend, posts, platforms, media, leads, reach/engagement) vs clearly-labeled estimates (cost/time saved vs agency), read-aloud narration. CampaignCommandView = live per-post rollup. |
| **Scheduled** (`scheduled`) | `scheduled-view.tsx` | Read-only queue. Scheduled sends (parked runs: email/post/action) — reschedule/cancel. Upcoming posts (brief → ⚡ Chuẩn bị autonomy grant) + recently published. |

**Support components:** `memory-panel`, `email-panel`, `atria-suggestion-cards`, `atria-resume-work-cards`, `run-dag-view`, `plan-tier-cards`, `cost-strip`, `create-post-modal`, `PostBriefForm`, `product-knowledge-upload`, `connection-required`, `node-setup-status`, `DemoModeToggle`, `read-aloud-button`, `voice-viz`.
**Legacy/unwired:** `CampaignList.tsx`, `CampaignSetupForm.tsx`, `FlowCanvas`, `AgentCatalogPreview`, `PlatformChecklist`, `concept-selection-gate`, `publish-review` — not imported by `App.tsx` (campaign creation now flows through chat + calendar materialization).

---

## 2. HTTP API Endpoints

Auth legend: **requireAuth** = JWT/session gated (tenant-scoped, cross-tenant → 404) · **self-guarded** = router resolves cookie/Bearer/`?token=` · **public (state JWT)** = ownership rides signed short-lived state · **secret-gated** = per-owner intake token / shared secret · **public** = none.
Body limit 1mb globally; 20mb for `/product-knowledge` and `/posts/:id/reference-image`.

### Health & Static (`server.ts`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | public | Liveness probe. |
| GET | `/media/images/*` | public | Static generated images (content-hashed, 1h cache). |
| GET | `/media/videos/*` | public | Static generated videos (Veo mp4, range-enabled). |

### Auth — `/auth`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/auth/google/start` | public | 302 to Google consent; 10m HMAC state nonce. |
| GET | `/auth/google/callback` | public (state JWT) | Exchange code → upsert user → session cookie + UI redirect (or `{token}` for CLI); handles drive-scoped state. |
| POST | `/auth/logout` | self-guarded | Revoke session + clear cookie (idempotent). |
| GET | `/auth/me` | requireAuth | Identity echo. |

### Social Connect — `/connect` & `/connect/drive`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/connect/:platform/start` | requireAuth | 302 to platform consent (FB/IG/Threads/LinkedIn/X; PKCE for X). |
| GET | `/connect/:platform/callback` | public (state JWT) | Exchange code → store encrypted per-user token. |
| GET | `/connect/drive/start` | requireAuth | 302 to Google (drive.file, offline) → per-user Drive refresh token. |
| GET | `/connect/drive/callback` | public (state JWT) | Fallback Drive callback. |

### Connections — `/connections`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/connections` | requireAuth | Read-only status of all social connectors. |
| GET | `/connections/storage` | requireAuth | Media storage targets (local + Drive flag). |

### Posts — `/posts`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/posts/:id/reference-image` | requireAuth | Upload base64 reference image (concept gate); `asHero=true` sets as media. |
| DELETE | `/posts/:id/reference-image` | requireAuth | Remove reference image. |
| GET | `/posts` | requireAuth | List posts (cursor-paged). |
| POST | `/posts` | requireAuth | Create brief under a campaign; clones campaign flow template into instance run. |
| POST | `/posts/from-agent` | requireAuth | Agent-authored create: free-text → analyzer extracts brief; may return clarification `questions`. |
| GET | `/posts/:id` | requireAuth | Post detail. |
| GET | `/posts/:id/postability` | requireAuth | Per-platform publish readiness. |
| PATCH | `/posts/:id` | requireAuth | Edit config (asset/targets/schedule/knowledge); 409 if scheduler-owned. |
| DELETE | `/posts/:id` | requireAuth | Delete; 409 if publishing in flight. |
| POST | `/posts/:id/generate` | requireAuth | Manual copy-gen trigger (brief/rework → review). |
| POST | `/posts/:id/refine` | requireAuth | LLM-refine existing copy via instruction. |
| POST | `/posts/:id/collector` | requireAuth | Activate/stop lead-collector keyword; backfills comment sources. |
| GET | `/posts/:id/link-status` | requireAuth | Check each published link still exists (self-heals). |
| POST | `/posts/:id/edit-copy` | requireAuth | Manual copy overwrite (no LLM). |
| POST | `/posts/:id/select-variant` | requireAuth | Pick a concept_writer variant → post.copy. |
| POST | `/posts/:id/publish-now` | requireAuth | Manual publish (ready → posting → real publish). |
| POST | `/posts/:id/approve` | requireAuth | Approve review → ready (optional scheduledAt). |
| POST | `/posts/:id/reject` | requireAuth | Reject → rework (with feedback). |
| POST | `/posts/:id/grant-autonomy` | requireAuth | Two-step per-post autonomy grant → run 'atria'. |

### Campaigns — `/campaigns`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/campaigns` | requireAuth | List (`?active=true`). |
| GET | `/campaigns/:id` | requireAuth | Get one. |
| POST | `/campaigns` | requireAuth | Create (validates attached flowId ownership). |
| PATCH | `/campaigns/:id` | requireAuth | Update. |
| DELETE | `/campaigns/:id` | requireAuth | Delete (cascades to posts). |
| POST | `/campaigns/:id/materialize` | requireAuth | Materialize approved calendar slots → N scheduled posts (idempotent). |
| GET | `/campaigns/:id/status` | requireAuth | Live status rollup. |
| GET | `/campaigns/:id/impact` | requireAuth | Per-campaign ROI report. |
| POST | `/campaigns/:id/grant-autonomy` | requireAuth | Two-step campaign-wide autonomy grant (cost ceiling). |

### Workspaces — `/workspaces`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/workspaces` | requireAuth | All campaigns as workspace cards (status counts + cost). |
| GET | `/workspaces/:campaignId` | requireAuth | One room: campaign + posts/runs + per-agent dashboard. |

### Instructions — `/instructions`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/instructions` | requireAuth | List (`?scope=`, `?refId=`). |
| POST | `/instructions` | requireAuth | Create (workspace/campaign/post scope). |
| PATCH | `/instructions/:id` | requireAuth | Update content/enabled/agentId. |
| DELETE | `/instructions/:id` | requireAuth | Delete. |

### Memory — `/memory`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/memory` | requireAuth | List learned memories. |
| GET | `/memory/proposals` | requireAuth | Analyze edited copy → proposed style rules (not persisted). |
| POST | `/memory/accept` | requireAuth | Approve proposal → persist as learned instruction. |
| DELETE | `/memory/:id` | requireAuth | Forget a memory. |

### Email — `/email`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/email/status` | requireAuth | Whether owner's Gmail is connected. |
| GET | `/email/leads` | requireAuth | Nurture-worthy leads (highest-intent first). |
| POST | `/email/draft` | requireAuth | LLM-draft nurture email for one lead. |
| POST | `/email/send` | requireAuth | Send reviewed email from owner's Gmail; stamps nurturedAt. |

### Atria — `/atria`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/atria/roadmap` | requireAuth | Roadmap agents Atria knows about. |
| GET | `/atria/suggestions` | requireAuth | Ranked proactive suggestions (logs pitches once). |
| POST | `/atria/roadmap-demand` | requireAuth | Accept a roadmap pitch → log demand. |

### Impact — `/impact`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/impact` | requireAuth | Per-period value report (`?period=7d\|30d\|90d\|all`). |

### Agent (Master Agent intake) — `/agent`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/agent/intake` | requireAuth | Parse message → structured setup draft. |
| GET | `/agent/chats` | requireAuth | List setup chats (latest 50). |
| POST | `/agent/chats` | requireAuth | Create setup chat (optional first message). |
| GET | `/agent/chats/:id` | requireAuth | Chat + full history. |
| POST | `/agent/chats/:id/messages` | requireAuth | Append user message → re-parse draft. |
| DELETE | `/agent/chats/:id` | requireAuth | Delete chat. |
| GET | `/agent/credentials/status` | requireAuth | Saved credentials metadata (no values). |
| PUT | `/agent/credentials/:agentId/:key` | requireAuth | Save/update encrypted credential (allowlist-gated). |
| DELETE | `/agent/credentials/:agentId/:key` | requireAuth | Delete credential. |

### Orchestration — `/orchestration`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/orchestration/runs` | requireAuth | **Main conversational entry:** message → Atria brain → reply OR workflow proposal; handles saved-flow campaign intent, in-place refine, execute-on-"chạy đi". |
| POST | `/orchestration/runs/:id/clarify` | requireAuth | Submit clarification answers → merge → re-plan. |
| POST | `/orchestration/runs/:id/save` | requireAuth | Save planned run as named Saved Flow (template). |
| PATCH | `/orchestration/runs/:id` | requireAuth | Rename saved flow. |
| POST | `/orchestration/runs/:id/execute` | requireAuth | Execute planned/failed run (async detached); connection gate. |
| POST | `/orchestration/runs/:id/test-run` | requireAuth | Clone template → throwaway instance → run. |
| POST | `/orchestration/runs/:id/grant-autonomy` | requireAuth | Two-step autonomy grant → approvalMode 'atria'. |
| POST | `/orchestration/runs/:id/materialize-calendar` | requireAuth | Create campaign from goal + materialize slots. |
| POST | `/orchestration/runs/:id/approve-node/:nodeId` | requireAuth | Resume past an approval gate (handles schedule-parking + publish-scheduling). |
| POST | `/orchestration/runs/:id/rerun-node/:nodeId` | requireAuth | Re-run one finished node + reset downstream (atomic; blocks published publisher). |
| GET | `/orchestration/runs/saved` | requireAuth | List Saved Flows. |
| GET | `/orchestration/runs` | requireAuth | List all runs. |
| GET | `/orchestration/runs/scheduled` | requireAuth | List parked scheduled runs. |
| POST | `/orchestration/runs/:id/cancel-schedule` | requireAuth | Cancel a scheduled run before it fires. |
| POST | `/orchestration/runs/:id/reschedule` | requireAuth | Reschedule a parked run. |
| GET | `/orchestration/runs/by-chat/:chatSessionId` | requireAuth | Latest run for a chat session. |
| GET | `/orchestration/runs/:id` | requireAuth | Run + nodes + artifacts (+cost rollup for templates). |
| POST | `/orchestration/runs/:id/apply-tier` | requireAuth | Rebuild plan from Economy/Balanced/Full tier. |
| POST | `/orchestration/runs/:id/abort` | requireAuth | Kill switch: abort run at next node boundary. |
| GET | `/orchestration/killswitch` | requireAuth | Read global external-actions pause. |
| POST | `/orchestration/killswitch` | requireAuth | Toggle global external-actions pause (audited). |
| GET | `/orchestration/runs/:id/plan-tiers` | requireAuth | Multi-tier plan options + credit estimates. |
| GET | `/orchestration/usage` | requireAuth | Per-owner spend totals + per-surface breakdown. |
| GET | `/orchestration/agents` | requireAuth | Agent registry as display data (groups + vision agents). |
| DELETE | `/orchestration/runs/:id` | requireAuth | Delete run/Saved Flow (409 if running). |

### Product Knowledge — `/product-knowledge` (20mb parser)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/product-knowledge/analyze` | requireAuth | Upload base64 docs/images → Gemini profile; optionally persist to campaign / library. |
| GET | `/product-knowledge` | requireAuth | List entries. |
| GET | `/product-knowledge/:id` | requireAuth | Get one. |
| PATCH | `/product-knowledge/:id` | requireAuth | Update. |
| DELETE | `/product-knowledge/:id` | requireAuth | Delete. |

### Voice — `/voice`
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/voice/tts` | requireAuth | Gemini TTS read-aloud → `audio/wav`; per-owner throttle (429), cost-tracked, cached. |

### Events (SSE) — `/events`
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/events` | self-guarded (Bearer/cookie/`?token=`) | Per-user SSE stream of post/node status changes; 25s heartbeat. |

### Leads — `/leads` (mixed auth)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/leads/webhook` | secret-gated | Generic JSON lead intake (`x-intake-token` or legacy `x-webhook-secret`). |
| POST | `/leads/form` | secret-gated | Google-Form-style row intake. |
| POST | `/leads/calcom` | secret-gated | Cal.com BOOKING_CREATED webhook (`?t=`/`?s=`). |
| POST | `/leads/intake-tokens` | requireAuth | Mint per-owner intake token (plaintext once). |
| GET | `/leads/intake-tokens` | requireAuth | List tokens (metadata). |
| DELETE | `/leads/intake-tokens/:id` | requireAuth | Revoke token. |
| POST | `/leads/poll-comments` | requireAuth | Manual: pull opt-in leads from published posts' comments. |
| POST | `/leads/:id/rescore` | requireAuth | Recompute hybrid score (rule + one Gemini adjustment). |
| GET | `/leads` | requireAuth | List leads (cursor-paged). |

---

## 3. Logic & Data Workflows

### 3.1 Orchestration Core (`src/orchestration/`)
Rule-based DAG planner + resumable executor over a **closed agent registry**, fronted by the Master Agent and the tool-using Atria brain.

**Agent Node Registry** (`registry/agent-registry.ts`) — the closed menu the planner selects from. Edges are *derived*, not hardcoded: each agent declares `requires`/`optional`/`produces` (artifact types); the planner links each consumer to the most-recent upstream producer.

| Node id | Group | Produces | Gate | Role |
|---|---|---|---|---|
| `ideation` | intelligence | `campaign_ideas` | — | Brainstorm 3–5 angles, pick strongest. |
| `strategy` | intelligence | `strategy_brief` | — | Positioning, audience, 2–4 pillars, funnel stage + proposed **lead-scoring criteria**. |
| `content_search` | intelligence | `research_summary` | — | "Researcher": live market/competitor research via Gemini Google-Search grounding (never hard-fails). |
| `campaign_strategist` | intelligence | `content_calendar` | `selection` | Multi-post: editable N-slot content calendar; parks for user edits. |
| `concept_writer` | action | `content_concept` | `selection` | Materializes Campaign+Post, drives copy-gen → 3–5 variants; parks to pick version (+ optional reference image). |
| `infographic` | action | `infographic_brief` | — | English image prompt + localized brief → real image (nano-banana) → attach as `image`. |
| `storyboard` | action | `storyboard` | — | 3–6 frames (LLM) → image per frame with shared style anchor; serves carousel + video keyframes. |
| `video` | action | `video_prompt` | `cost` | Veo i2v per frame → ffmpeg stitch → TTS voiceover mux → video hero. Most expensive → cost gate. |
| `publisher` | action | `publish_result` | `publish` | ONE publisher fanned to many platforms via capabilities; requires connection + approval. |
| `email_writer` | action | `email_draft` | — | Draft subject+body from goal/concept. |
| `email_agent` | action | `email_result` | `publish` | Send reviewed draft via owner's Gmail, per-recipient. |
| `scheduler` | action | `schedule_marker` | `schedule` | Type-agnostic control node — no content/action; parks the run for timed re-entry. |

**Gate semantics:** `selection` = pause AFTER (produce-then-pick) · `cost` = pause BEFORE (expensive spend OK) · `publish` = pause BEFORE external write · `schedule` = pause BEFORE terminal action for time-confirmation (parks run).
**Vision agents** (`registry/vision-agents.ts`): display-only roster NOT runnable — `memory`, `lead_collector`, `analytics`, `email` (each opens a real Command-Center surface).

**DAG Planning** (`master/workflow-planner.ts`, rule-based, not LLM):
1. `selectAgents(goal)` reads `goal.outputs.needs*` flags → email path `[email_writer, email_agent]`; campaign scope ≠ single → `[content_search?, ideation, strategy, campaign_strategist]`; else single-post pipeline `content_search? → ideation → strategy? → concept_writer → infographic? → storyboard? → video? → publisher?`.
2. **Scheduler splice** — if `goal.schedule.confirmed && .at`, insert `scheduler` before the terminal action.
3. `deriveDeps` links each required artifact backwards to latest producer.
4. Guard rails (publish-only-no-content → error).
5. `validatePlan` — inputs satisfiable + DAG acyclic (topo-sort reused by executor).

**Execution → Approval Gate → Publish** (`executor/workflow-executor.ts`): `runWorkflow` runs/resumes DAG in topo order. Per node: abort check → selection-gate resume → media-asset gating (skip media no platform needs) → publish-completeness hold → **approval halt** (parks at `needs_approval` unless approved node; publisher halt carries optimal-time suggestion) → auto-publish waiver (default OFF, opt-in, only when cleanly postable, suppressed if a cost gate exists) → future-scheduled publisher parked → execute node → store artifact + record cost/tokens + SSE `publishNodeStatus`. Failure → node+run `failed` (never hangs). **Single-node re-execute** (`rerunOnly`) re-seeds upstream, parks at `planned`; refuses to re-run concept on a published post.

**Agent Runners** (`executor/agent-runners.ts`) — the only place orchestration touches runtime. Maps each agentId to its produce-function; preserves user-edited copy on re-run; publisher **fails LOUD** if publish didn't happen; every provider call recorded once to the LLM-usage ledger; DRY-RUN seams stub external calls for verification. Grounding resolution chain: product-knowledge library → campaign `brandContext` → goal slot.

**Master Agent** (`master/master-agent.ts`) — pure planning brain (no write/publish). `handle` → `requirementAnalyzer.analyze` (Gemini → GoalSpec) → `planFromGoal` (clarification engine → `planWorkflow`). `refine` merges message as additive delta then subtracts removals (cumulative conversation).

**Atria Brain — Reasoning Loop** (`atria/atria-brain.ts` + `atria-tools.ts`): tool-using Gemini loop (replaces regex intent-classify). Bounded `MAX_ROUNDS=3`, `TURN_BUDGET_MS=45s`, `CALL_TIMEOUT_MS=30s`; static prefix served from context cache; degrades to apology (not a marketing plan) on runtime failure. **7 tools:** `web_search` (grounded), `get_workspace_data` (real metrics), `recall_memory`, `save_memory`, `propose_workflow` (→ planFromGoal, flow card, no execute), `set_schedule` (NL time → UTC instant for confirmation), `execute_workflow` (signal router to run proposed plan).

**Campaign Materialization** (`master/campaign-materializer.ts`): approved content_calendar → N real scheduled Posts, each its own registry-composed flow (slot → single-scope GoalSpec → planWorkflow → instance run + Post). Idempotent.

**Autonomy — Grant Model** (`autonomy/` + `executor/approval-policy.ts`): per-flow grant (not standing policy). User double-confirms → `run.approvalMode='atria'`. Executor consults `atriaApprovalPolicy(gate, ctx)` — pure, deterministic, **fail-closed** (unproven → hold+park+notify): selection→approve if content produced; cost→approve if `estCost ≤ budget`; publish→approve if connected+mediaReady+cleanlyPostable+checksPass; **schedule→NEVER auto-cleared**. Guardrails re-read fresh each boundary; every decision audited.

### 3.2 Lead-Collection Pipeline (`src/leads/`)
Sources → capture → scoring → notify. (1) On publish of a post with `leadCaptureKeyword`, scheduler records watched platform post-ids. (2) Leads cron polls each watched post (FB/IG live; Threads/LinkedIn/X best-effort), parses comments for `keyword + email`; `PostGoneError` deactivates a deleted post's collector. (3) `captureLead` — tenancy chokepoint, dedupes (Cal.com uid / email 30d), applies rule-scoring, persists Lead, notifies sales. Other intakes: forms, webhooks, Cal.com. (4) Scoring: `rule-score.ts` (deterministic 0–100 with reason trail, weights are data the Strategist can tune) + optional user-triggered `llm-score.ts` (Gemini −30..+30 adjustment).

### 3.3 Media Generation
- `imagegen/nano-banana.ts` — Gemini 2.5 Flash Image; `text-to-image` + `edit` (reference-conditioned consistency); cached = free. Used by infographic/storyboard.
- `video/` — `veo.ts` (Veo i2v, per-second, serial/rate-limited), `stitch.ts` (ffmpeg stitch+mux), `tts.ts` (Gemini TTS voiceover).
- `copygen/` — reusable copy engine (`generateForPost`/`generateVariantsForPost`), driven by concept_writer node, `POST /posts/:id/generate`, and the copy-gen cron. Language/brand resolution chain in `resolve-config.ts`.

### 3.4 Publishing & Connectors (`src/social/`, `src/connectors/`, `src/tokens/`)
- **Adapters** (`social/`): facebook, instagram, threads, linkedin, x + `publishTo`; `postability.ts` decides per-platform asset support; adapters swallow failures into `ok:false`.
- **Connector Runtime** (`connectors/runtime/connector-runtime.ts`): SINGLE external-write chokepoint. `invokeAction`: kill-switch check → input validation → **idempotency** (prior success short-circuits) → rate-limit slot → `withRetry(publishTo)` → audit every attempt (redacted). Exposed as `runtimePublishFn` (shared by executor + scheduler; no shadow bypass).
- **Token vault** (`tokens/`): `getActiveToken` (OAuth-first, lazy refresh-ahead, fail-closed on stale, vault fallback for pasted tokens); `runTokenMaintenance` (cron); `verifyAndRecordFormToken`. LLM never sees a token.

### 3.5 Analytics, Impact & Cost
- `analytics/` — real Insights adapters (fb/ig/threads/x), merged null-aware (Threads no reach; X null on free tier).
- `impact/` — `impact-metrics.ts` aggregates MEASURED data (cost ledger, Posts/Artifacts, leads, timestamps + social Insights); `value-model.ts` layers labeled ESTIMATES (cost/reach saved). Reconciles with Usage page (same `mkt_llm_usage` ledger).
- `cost/` — `llm-usage.ts` (authoritative per-owner token/media ledger), `credits.ts` (friendly conversion), `plan-estimate.ts` (pre-run tiers).

### 3.6 Cross-Cutting Stores
- `memory/` — `user-memory.ts` keyword-first recall (no embeddings) → compact block injected into analyzer so Atria stops re-asking; `captureFromGoal` persists durable slots.
- `product-knowledge/` — `analyze-documents.ts` (LLM → structured profile); wins the grounding resolution chain.
- `email/` — `gmail-send.ts` (owner-scoped Gmail send).

**Single-post happy path:**
```
User message → Atria brain (reason+tools) → propose_workflow
  → requirementAnalyzer → GoalSpec → clarification? → planWorkflow → DAG
  → [grant or execute] → runWorkflow (topo):
     content_search → ideation → strategy
       → concept_writer  ──(selection gate: pick version)──▶ park
       → infographic/storyboard → video  ──(cost gate)──▶ park
       → publisher  ──(publish gate + optimal-time)──▶ park
  → approve → runtimePublishFn (kill-switch→idempotency→rate-limit→adapter→audit)
  → Post live → scheduler records comment sources
  → leads cron captures opt-in leads → rule-score → notify
  → analytics/impact aggregate measured Insights + cost ledger
```

---

## 4. Background Jobs (Cron)
All behind `ENABLE_*` flags; `node-cron` + own advisory lock (overlapping ticks safe).

| Cron | File | Schedule | What it does |
|---|---|---|---|
| **Scheduler (publish)** | `scheduler/tick.ts` | every min | Due-post queue (oldest first) → skip publish-blocked → atomic claim (ready→posting) → per-platform validate → fan out via `runtimePublishFn` → write back → record comment sources → audit. One publishable row/tick (anti-burst). |
| **Scheduler resume** | `scheduler/resume-due-runs.ts` | every min | Claim one due parked run (scheduled→running) → re-enter `runWorkflow` at the pre-authorized terminal action (waives that one gate). Catch-up native. |
| **Reaper (self-healing)** | `scheduler/reaper.ts` | every 5 min | posting-stuck → error; nodes running-stuck → failed (video bigger budget) + cascade run failed; orphaned parked past TTL → logged. Idempotent. |
| **Autonomy kickoff** | `autonomy/autonomy-runner.ts` | every 2 min (:01) | Claim granted-but-unstarted runs → connection gate → execute through gated executor. Publishing forced DRY-RUN; parks pre-publish. |
| **Copy-gen** | `copygen/service.ts` | every 10 min | Pick one brief/rework Post → Gemini (grounded on knowledge + instructions) → write copy + status review. |
| **Token maintenance** | `tokens/service.ts` | hourly :17 | Refresh-ahead-of-expiry + liveness check → mark active/needs_attention. |
| **Leads (comment poller)** | `leads/sources/comment-poller.ts` | every 30 min | Sweep watched published posts for opt-in comment leads, then `sweepPostLiveness` (deleted → self-heal). |

---

## 5. Data Model
Postgres via Prisma. Tenant-scoped tables carry `ownerId` (FK → `mkt_user`, cascade). Table names in parens.

**Auth / Identity**
- **User** (`mkt_user`) — a tenant; identity = Google email. Fields: `email` (unique), `googleSub`, `passwordHash`, `accountType`, `role`, brand/language defaults. Enums: `AccountType`, `UserRole`.
- **Session** (`mkt_session`) — server-side BFF session; `tokenHash` (unique), `expiresAt`. Revocable.
- **OAuthToken** (`mkt_oauth_token`) — per-user social token vault; PK `(ownerId, platform)`; `token`/`refreshToken` (AES-256-GCM), `status`. Enums: `SocialPlatform`, `TokenStatus`.
- **AgentCredential** (`agent_credential`) — generic per-agent provider keys; `agentId`, `key`, `value` (encrypted); unique `(ownerId, agentId, key)`.

**Campaigns / Posts**
- **Campaign** (`mkt_campaign`) — product + angle + brand context; `platforms`, `postingWindow`/`timezone`, `active`; relations: `flowId`→WorkflowRun, `productKnowledgeId`, Post[].
- **Post** (`mkt_post`) — one publication; `status` (`PostStatus`), `assetType` (`AssetType`), `copy`/`copyEdited`, `platforms`, `scheduledAt`/`postedAt`, asset refs, lead-capture fields (`leadCaptureKeyword`, `commentSourceIds`, `platformPostIds`, `leadCollectorStatus`, `linkStatus`), outcome (`postUrls`, `error`). Enums: `PostStatus` (brief/review/rework/ready/posting/posted/partial/error), `AssetType` (image/carousel/video/text).
- **ProductKnowledge** (`mkt_product_knowledge`) — reusable product-facts library (`profile` JSON, `brandVoice`, `sourceDocs[]`, `referenceImage`).

**Orchestration / Runs**
- **WorkflowRun** (`wf_run`) — GoalSpec snapshot + planned DAG + state; `goal`/`plan` (JSON), `status`, `kind` (template/instance), `approvalMode` (human/atria), `scheduleConfirmed`, `scheduledResumeAt`, `templateId` (self-relation), `chatSessionId`.
- **WorkflowNodeRun** (`wf_node_run`) — per-node state; `nodeId`, `agentId`, `status`, `dependsOn[]`/`inputRefs[]`/`outputRefs[]`, per-node cost (`promptTokens`/`outputTokens`/`totalTokens`/`costUsd`).
- **Artifact** (`wf_artifact`) — typed agent output (Zod-validated); `type`, `data` (JSON).

**Agent Chat**
- **AgentChatSession** (`agent_chat_session`) — chat history; `title`, `draft` (JSON).
- **AgentChatMessage** (`agent_chat_message`) — one turn; `role`, `content`.

**Instructions / Memory / Roadmap**
- **Instruction** (`mkt_instruction`) — layered custom instructions; `scope` (workspace/campaign/post), `agentId?`, `content`, `enabled`, `source` (user/memory).
- **UserMemory** (`mkt_memory`) — durable facts; `kind` (product/brand/audience/preference/contact/fact), `key`, `content`, `usedCount`; unique `(ownerId, kind, key)`.
- **RoadmapDemand** (`mkt_roadmap_demand`) — pitch/accept log for not-yet-built agents.

**Leads**
- **Lead** (`mkt_lead`) — inbound lead; `name`/`email`/`phone`/`message` (AES-256-GCM), `emailBidx` (HMAC blind index), `source` (`LeadSource`: webhook/form/calcom/comment), `score`/`scoreReasons`, `receivedAt`, `nurturedAt`.
- **LeadIntakeToken** (`mkt_lead_intake_token`) — per-owner intake token; `tokenHash` (unique), `active`.

**Cost / Audit / Ops**
- **LlmUsage** (`mkt_llm_usage`) — universal LLM/media spend ledger; `surface`, `model`, token counts, `costUsd`, `runId`/`refId` (BigInt PK, survives user deletion).
- **MktRunLog** (`mkt_run_log`) — chronological audit log; `level`, `step`, `detail`.
- **ExternalActionAuditLog** (`external_action_audit_log`) — append-only outward-action audit; `platform`, `actionKey`, `status`, `externalId`, `detail` (redacted).
- **SystemFlag** (`mkt_system_flag`) — runtime kill switch; `key` (PK, e.g. `external_actions_paused`), `enabled`.

---

## 6. Configuration & Feature Flags
Centralized, zod-validated in `src/config/env.ts` (fail-fast at boot on missing critical vars).

**Cron toggles (`ENABLE_*`, default OFF):**
- `ENABLE_SCHEDULER_CRON` — publish ready posts.
- `ENABLE_SCHEDULER_RESUME` — re-enter parked scheduled runs at confirmed time.
- `ENABLE_TOKEN_CRON` — OAuth token refresh/health.
- `ENABLE_COPYGEN_CRON` — background copy generation.
- `ENABLE_LEADS_CRON` — comment-keyword poll (30 min) + liveness sweeps.
- `ENABLE_REAPER_CRON` — rescue rows stuck in transient states.
- `ENABLE_AUTONOMY_CRON` — start granted-but-unstarted runs (publish forced DRY-RUN).

**Tuning knobs:** `LEADS_LIVENESS_THROTTLE_HOURS` (6); reaper timeouts (`REAPER_POSTING_TIMEOUT_MIN` 10, `REAPER_RUN_TIMEOUT_MIN` 20, `REAPER_VIDEO_NODE_TIMEOUT_MIN` 30, `REAPER_ORPHAN_TTL_DAYS` 7); autonomy (`ATRIA_AUTONOMY_COST_CEILING_USD` 2, `AUTONOMY_MAX_PER_TICK` 3); impact baselines (`IMPACT_AGENCY_DAY_RATE_USD` 500, `IMPACT_HOURS_PER_POST` 2, `IMPACT_FREELANCER_PER_POST_USD` 50, `IMPACT_REACH_PER_POST` 300).

**Core / infra:** `NODE_ENV`, `PORT` (7100), `DATABASE_URL` (required), `MKT_API_KEYS`, `TOKEN_ENC_KEY` (AES-256-GCM), `JWT_SECRET`/`JWT_TTL` (60d), `UI_BASE_URL`/`SESSION_TTL` (30d), `PUBLIC_BASE_URL`/`GOOGLE_OAUTH_REDIRECT_URI`.

**External integrations:**
- **Google** — login (identity), Drive (asset store), Sheets (import), Gmail (nurture send).
- **Gemini** — `GEMINI_MODEL` (gemini-2.5-flash) copy/reasoning; `VEO_MODEL` (veo-3.1-lite) i2v; nano-banana images; TTS.
- **Meta** (FB/IG/Threads) — DAIS long-lived tokens (`MKT_*_ACCESS_TOKEN`) + per-user OAuth apps; pinned `GRAPH_VERSION` v25.0.
- **LinkedIn** — DAIS + per-user OAuth.
- **X/Twitter** — DAIS + per-user OAuth2 PKCE.
- **Lead capture** — `MKT_LEAD_WEBHOOK_SECRET`, `MKT_CALCOM_WEBHOOK_SECRET`, `MKT_SALES_EMAIL`.

*Two token models coexist: env-seeded DAIS long-lived tokens and per-user OAuth connect flows (→ `OAuthToken` table).*
