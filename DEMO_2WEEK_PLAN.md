# Agent Operations Portal — Local Demo Development Plan (3 Weeks)
**Version:** 2.1  
**Date:** 2026-05-04  
**Prepared by:** Engineering Team  
**Status:** PENDING MANAGER APPROVAL  
**Start:** May 6, 2026  
**Deadline:** May 26, 2026 — buffer to May 30

---

## 1. Executive Summary

We are building a **local demo** of the Agent Operations Portal — a product that lets business users set up, run, and monitor AI automation agents through a controlled portal, powered by a self-hosted automation engine (n8n).

This is **not a production system**. The goal is to prove that the product model works end-to-end and present a working demo to the customer.

**Target timeline:** 3 weeks (15 working days) — May 6 to May 26, 2026  
**Team size:** 1 engineer + AI coding assistance  
**Demo format:** Live demo on presenter's machine + recording for commercial use  
**Presenter:** Engineer (self-hosted, runs on local machine)  
**Estimated cash cost:** $70–$650 (infrastructure is all local/free)  
**Estimated engineering cost:** $8,000–$12,000 (3 weeks at standard rate)

---

## 2. What This Demo Proves

> The core proof: a user logs in, creates an agent from a pre-approved template, runs it, and sees real results — with the entire flow going through backend validation and a real automation engine, not a fake UI.

```
User logs in
  → User creates Agent Instance from template
    → User clicks Run
      → Backend validates and records the execution
        → Automation engine (n8n) processes the job
          → Engine sends result back to backend
            → Frontend shows result, analytics, and notifications
```

This proves the product model is real before investing in full production infrastructure.

---

## 3. What Is In Scope (Demo)

| Area | What We Build |
|---|---|
| Authentication | Email/password login, account registration, protected routes |
| Frontend Portal | Dashboard, Agents, Integrations, Notifications, Analytics pages |
| Create Agent Wizard | 7-step guided flow for creating an agent from a template |
| Backend API | Control plane: auth, templates, agents, execution, notifications, analytics |
| Database | PostgreSQL — users, templates, executions, outputs, notifications |
| Automation Engine | Self-hosted n8n running locally via Docker |
| Agent Templates | **5 pre-built templates** (see Section 7) |
| Mock Integrations | Gmail, Slack, Google Sheet, Helpdesk (mock connected) |
| Real Integration | 1 real integration via n8n built-in nodes (no custom OAuth needed) |
| Approval Flow | Email Draft Responder: shows draft with Approve/Reject buttons (no real send) |
| Execution Tracking | Full history, detail view, retry failed executions |
| Notifications | Automatic alerts when execution fails or warns |
| Analytics | Success rate, duration, cost estimate, latest failures |
| Speed Test | Script to run 50 executions and measure local performance |
| Docker Setup | Single command: `docker compose up` runs everything |
| README | Clear setup instructions for any engineer |
| Demo Script | Step-by-step customer presentation guide |

---

## 4. What Is Out of Scope (Demo)

| Excluded | Reason |
|---|---|
| Production SaaS deployment | This is a local proof only |
| Full OAuth flow (Gmail, Slack, etc.) | Real integration via n8n nodes — no custom OAuth needed |
| Email verification | Mock auth is sufficient for demo |
| Billing / subscription | Not needed for demo |
| Multi-tenant enterprise security | Single demo workspace only |
| End-user workflow editor | Users cannot edit automation logic — by design |
| High availability / load balancing | Local Docker only |
| SOC2 / GDPR compliance layer | Post-demo phase |
| Production credential vault | Mock secrets only |
| Advanced RBAC | Single admin user for demo |
| n8n commercial license decision | Flagged as a next-phase legal/commercial decision |

---

## 5. Demo Success Criteria

The demo is considered **complete and ready for customer presentation** when all of the following pass:

| # | Criteria | How to Verify |
|---|---|---|
| 1 | `docker compose up` starts all services from scratch | Run on presenter's machine |
| 2 | Frontend loads at `localhost:3000` | Open browser |
| 3 | User can register and log in with email/password | Go through auth flow |
| 4 | Agent Templates come from backend (not hardcoded) | Check network tab |
| 5 | User creates an Agent Instance from a template | Go through wizard |
| 6 | User cannot select an integration not allowed by the template | Try to select disallowed integration |
| 7 | User cannot create agent with missing required config | Leave required field blank |
| 8 | Run Now creates an execution record | Check database / UI |
| 9 | Backend calls the correct n8n workflow | Check backend logs |
| 10 | n8n processes and sends result back to backend | Check n8n execution log |
| 11 | Backend updates execution to success / failed | Check execution detail |
| 12 | Frontend shows execution result | View execution detail page |
| 13 | Email Draft Responder shows draft with Approve/Reject buttons | Run Email Draft agent |
| 14 | Failed execution creates a notification | Simulate failure, check notifications |
| 15 | Retry creates a new execution | Press retry on failed execution |
| 16 | Analytics updates after each execution | Run agent, check analytics page |
| 17 | At least 1 real integration runs via n8n built-in nodes | Run real integration template |
| 18 | Speed test runs 50 executions | `npm run speed-test -- --count 50` |
| 19 | README guides a new engineer to set up in under 30 minutes | Have someone follow it cold |
| 20 | Demo script covers the full customer walkthrough | Review script |

---

## 6. Architecture Overview

```
┌─────────────────────────────────────────────┐
│             Frontend Portal                  │
│  Auth / Dashboard / Agents / Integrations    │
│  Notifications / Execution Detail            │
└──────────────────────┬──────────────────────┘
                       │ REST API (JWT-authenticated)
                       ▼
┌─────────────────────────────────────────────┐
│           Backend Control Plane              │
│  Auth (Better Auth) / Template Registry      │
│  Agent CRUD / Validation / n8n Proxy         │
│  Callback / Execution Logs / Notifications   │
└───────────────┬─────────────────┬───────────┘
                │                 │
                ▼                 ▼
┌───────────────────┐   ┌─────────────────────┐
│    PostgreSQL      │   │   Self-hosted n8n    │
│  Users / Templates │   │  Automation Engine   │
│  Executions / Logs │   │  5 Workflow Templates│
└───────────────────┘   └─────────────────────┘
                ▲                 │
                │  Callback result│
                └─────────────────┘
```

**Key rules:**
- Frontend never calls n8n directly — all requests go through backend
- Backend validates everything, records every execution, then triggers n8n
- Frontend uses optimistic + polling pattern: create execution → poll GET `/executions/:id` every 2s → no dependency on callback reliability
- n8n callback updates execution when it arrives; polling picks up the result

---

## 7. Agent Templates (5 for Demo)

| Template | What It Does | Integrations | Real/Mock |
|---|---|---|---|
| Gmail Lead Classifier | Classifies inbound lead emails (hot/warm/cold) | Gmail (required), Slack / Google Sheet (optional) | Mock default; n8n Gmail node as real option |
| Email Draft Responder | Generates email draft replies with Approve/Reject UI | Gmail (required), Slack (optional) | Mock; approval UI only — no real send |
| Slack Daily Summary | Summarizes Slack messages and generates action items | Slack (required) | n8n Slack node as real option |
| Google Sheet Data Checker | Validates rows from a sheet-like data source | Google Sheet (required) | Mock |
| Ticket Triage Agent | Classifies support tickets by priority, sentiment | Helpdesk (required), Slack (optional) | Mock |

All templates use **mock integrations** by default. 1–2 templates leverage n8n's built-in nodes for a "real" feel without building custom OAuth.

---

## 8. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React + TypeScript + Vite + Tailwind + shadcn/ui | Fast setup, polished UI, type-safe |
| Backend | **NestJS + TypeScript** | DI/module pattern → AI generates consistent code; same ecosystem as n8n |
| Auth | **Better Auth** | Email/password + production-path OAuth, multi-tenant ready, NestJS compatible |
| ORM | Prisma | Type-safe, fast schema iteration |
| Validation | Zod | Matches config_schema pattern in spec |
| Database | PostgreSQL (Docker) | Relational, matches production direction |
| Automation Engine | n8n self-hosted (Docker) | Core product proof, free for local use |
| Containerization | Docker Compose | One-command setup on Windows |

### Why NestJS over Go/Python

| | NestJS (TypeScript) | Go (Fiber) | Python (FastAPI) |
|---|---|---|---|
| AI coding consistency | **Excellent** | Good | Good |
| Auth library quality | Better Auth (production-ready) | No equivalent | python-jose |
| n8n ecosystem | Same JS — easy debugging | Separate | Separate |
| Scale to SaaS | Very good | Excellent | Good |
| 3-week with AI | **Safest** | Risky | Safe |
| Shared types frontend↔backend | TypeScript = yes | No | No |

**Decision: NestJS + TypeScript.** Go is faster at runtime but TypeScript wins on AI-assisted development productivity and frontend type sharing.

---

## 9. 3-Week Sprint Plan

### Week 1 — Foundation + Auth + Core Loop

| Day | Focus | End-of-Day Deliverable |
|---|---|---|
| **Day 1** (May 6) | Docker Compose, repo structure, frontend + backend skeleton | `docker compose up` starts all 4 services, `/health` responds |
| **Day 2** (May 7) | Database schema (11 tables incl. users), Prisma migration, seed data | 5 templates, 6 integrations, demo workspace + user in DB |
| **Day 3** (May 8) | Auth system (Better Auth): login, register, JWT, protected routes | User can register, log in, and access protected API endpoints |
| **Day 4** (May 9) | Backend API: Templates, Agent Instances, full validation | `POST /api/agent-instances` validates integrations and config correctly |
| **Day 5** (May 12) | Backend n8n proxy, callback endpoint, n8n Workflow #1 (Gmail Lead Classifier) | n8n runs workflow, callbacks backend, execution updated in DB |

**Week 1 gate:** Auth works. End-to-end loop working. Frontend → Backend (authenticated) → n8n → Callback → Frontend result visible.

---

### Week 2 — Full User Flow + 5 Templates

| Day | Focus | End-of-Day Deliverable |
|---|---|---|
| **Day 6** (May 13) | Frontend auth pages + protected routes + connect Templates/Agents APIs | User logs in → sees templates from backend → creates agent |
| **Day 7** (May 14) | Create Agent Wizard (7 steps), dynamic config form from schema | User creates agent through wizard with full validation |
| **Day 8** (May 15) | Execution History, Execution Detail, Retry | User views past executions, retries failed ones |
| **Day 9** (May 16) | n8n Workflows #2 (Email Draft Responder) + #3 (Slack Daily Summary) + Approval UI | Email Draft shows draft with Approve/Reject; Slack Summary runs |
| **Day 10** (May 19) | n8n Workflows #4 (Sheet Checker) + #5 (Ticket Triage) + real integration via n8n nodes | All 5 templates active; 1 real integration demo-ready |

**Week 2 gate:** All 5 templates run. User can create, run, approve drafts, and inspect any agent.

---

### Week 3 — Operations Layer + Demo Package

| Day | Focus | End-of-Day Deliverable |
|---|---|---|
| **Day 11** (May 20) | Notifications UI, failure simulation, Integrations page | Failed execution creates notification; integrations show correct state |
| **Day 12** (May 21) | Analytics page, Dashboard wires up to backend | Analytics live; dashboard reflects real execution data |
| **Day 13** (May 22) | Speed test script, UI polish: loading/empty/error states | Speed test runs 50 executions; all key states handled in UI |
| **Day 14** (May 23) | Demo data prep, Demo Script, dry run walkthrough | Complete demo script written and rehearsed |
| **Day 15** (May 26) | README, clean setup test on presenter's machine, recording dry run | Demo-ready: one-command setup works, recording quality confirmed |

**Week 3 gate:** All 20 success criteria pass on presenter's machine. Live demo + recording ready.

---

## 10. Milestone Summary

| Milestone | Target Day | What It Proves |
|---|---|---|
| M1: Stack Running + Auth | End of Day 3 | Infrastructure up, users can authenticate |
| M2: Data Layer Ready | End of Day 2 | Schema and seed data confirmed |
| M3: Backend API Complete | End of Day 4 | Validation and business rules enforced |
| **M4: Core Loop Working** | **End of Day 5** | **Product model is real — most critical milestone** |
| M5: Full User Flow | End of Day 8 | User can create, run, and inspect any agent |
| M6: All 5 Templates Live | End of Day 10 | Full template catalog active including approval flow |
| M7: Operations Layer | End of Day 12 | Failure handling, notifications, analytics working |
| **M8: Demo Ready** | **End of Day 15 (May 26)** | **Customer presentation ready** |

---

## 11. Execution Model: Optimistic + Polling

To de-risk the n8n callback reliability on Docker/Windows:

```
POST /api/agent-instances/:id/run
  → Backend creates execution (status: running)
  → Backend triggers n8n webhook (fire and forget)
  → Returns { execution_id, status: "running" } immediately

Frontend polls GET /api/executions/:id every 2 seconds
  → When status changes to success/failed → stop polling, show result

n8n callback POST /api/n8n/callback
  → Updates execution status, metrics, output, notification
  → Polling picks up the update on next tick
```

This means the demo works even if callback is slow or delayed — the UI always shows correct state.

---

## 12. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | Timeline too tight for Week 3 of May | **High** | High | Buffer to May 30 agreed. If behind after Day 10, cut analytics polish — core loop + 5 templates is the demo |
| R-02 | n8n callback unreliable on Docker/Windows | Medium | Medium | Polling fallback (Section 11) eliminates this risk |
| R-03 | Auth setup (Better Auth) takes longer than Day 3 | Medium | High | Better Auth has NestJS guide; allocate full Day 3 for auth only |
| R-04 | Real integration via n8n nodes requires real credentials | Medium | Medium | Only 1 template needs real creds; others stay mock. Credentials set in n8n env vars — no OAuth code needed |
| R-05 | Scope creep mid-sprint | High | High | Lock scope at Day 1. New requests → staging backlog |
| R-06 | AI coding generates inconsistent API structure | Medium | Medium | Fix schema/API contract on Day 2; review every AI diff; NestJS module structure enforces consistency |
| R-07 | Docker Compose fails on presenter's Windows machine | Low | High | Test on presenter's machine on Day 15; fix environment issues then |
| R-08 | n8n commercial licensing for future SaaS | Low (demo) | High (production) | Demo is fine under fair-use. Flag as required legal decision before production |

---

## 13. Cost Estimate

### Cash Cost (Infrastructure)

| Item | Cost |
|---|---|
| n8n local Docker | $0 |
| PostgreSQL local Docker | $0 |
| Frontend / Backend local | $0 |
| AI coding tools (Claude, Copilot) | $20–$100 |
| LLM API for workflow testing | $50–$200 |
| Miscellaneous (ngrok for testing, etc.) | $0–$50 |
| **Total cash** | **$70–$350** |

### Engineering Cost

| Scenario | Rate | 3 Weeks | Total |
|---|---|---|---|
| Low | $75/hr | 120 hrs | ~$9,000 |
| Mid | $100/hr | 120 hrs | ~$12,000 |
| High | $125/hr | 120 hrs | ~$15,000 |

**Recommended planning number: $9,000–$12,000 for the demo phase.**

---

## 14. What Comes After the Demo

The demo is Phase 1. If approved by the customer, the following phases follow:

| Phase | Description | Estimated Duration |
|---|---|---|
| Phase 2: Staging | Real cloud deployment, real OAuth for Gmail/Slack, multi-user support, 2+ additional templates | 4–6 weeks |
| Phase 3: Production | Full SaaS, billing, enterprise security, multi-tenant, compliance baseline | 3–4 months |
| Phase 4: Customer Onboarding | Customer setup, data migration, training | 2 weeks per customer |

**Note on n8n licensing:** Self-hosted n8n is free for local and internal use. Before launching a commercial SaaS built on n8n, a formal licensing review is required.

---

## 15. Open Questions

| # | Question | Status | Decision |
|---|---|---|---|
| Q-01 | 3 or 5 templates? | **Resolved** | 5 templates |
| Q-02 | Real integration needed? | **Resolved** | Yes — via n8n built-in nodes, no custom OAuth |
| Q-03 | Approval flow for Email Draft Responder? | **Resolved** | Approve/Reject UI only, no real send |
| Q-04 | Who presents? | **Resolved** | Engineer — demo runs on presenter's machine |
| Q-05 | Video recording needed? | **Resolved** | Yes — live demo + recording for commercial use |
| Q-06 | Customer demo date? | **Resolved** | Target Week 3 of May (May 23); buffer to May 30 |
| Q-07 | Existing frontend codebase? | **Resolved** | Greenfield — React + Vite + Tailwind + shadcn/ui |
| Q-08 | Backend language? | **Resolved** | NestJS + TypeScript + Better Auth |
| Q-09 | Is 5 templates enough or do we need all from spec? | **Resolved** | 5 templates proves the model sufficiently |

---

## 16. Assumptions

| # | Assumption |
|---|---|
| A-01 | Engineer has Docker Desktop and Node.js 18+ on local Windows machine |
| A-02 | **Greenfield project** — React + Vite frontend built from scratch |
| A-03 | No real customer data is used in the demo |
| A-04 | The spec is locked — no significant product changes during the 3-week sprint |
| A-05 | n8n self-hosted (community edition) is acceptable for the demo phase |
| A-06 | Mock integrations are the default — 1 real integration via n8n built-in nodes |
| A-07 | One full-time engineer is dedicated to this sprint (no context switching) |
| A-08 | Better Auth email/password is sufficient for demo auth (no email verification required) |
| A-09 | Docker Compose works correctly on presenter's Windows machine |

---

## 17. Approval Request

| Item | Decision |
|---|---|
| Scope approved as defined in Section 3 | ☐ Approved ☐ Changes needed |
| Out-of-scope items accepted (Section 4) | ☐ Approved ☐ Changes needed |
| **3-week timeline approved (May 5 – May 23)** | ☐ Approved ☐ Changes needed |
| Budget range approved ($70–$350 cash, $9,000–$12,000 engineering) | ☐ Approved ☐ Changes needed |
| Tech stack approved (NestJS + Better Auth + React + Vite) | ☐ Approved ☐ Changes needed |
| Assumptions in Section 16 confirmed | ☐ Confirmed ☐ Needs clarification |

**Manager sign-off:**

Name: ____________________________  
Date: ____________________________  
Notes: ____________________________

---

*Document based on: `agent_operations_portal_local_demo_spec.md`*  
*Version 2.1: Start date shifted to May 6 (Day 1 = May 6, Day 15 = May 26). Tech stack confirmed: NestJS + Better Auth + React + Vite.*  
*Next step after approval: Begin Day 1 (May 6) — Docker Compose + NestJS skeleton + React/Vite setup.*
