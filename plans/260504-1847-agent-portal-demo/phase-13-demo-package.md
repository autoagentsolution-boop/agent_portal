# Phase 13: Demo Package

**Days:** 14–15 (May 23–26, 2026)  
**Priority:** Critical — Milestone M8 (Demo Ready)  
**Status:** Pending

## Context Links
- Plan: `plans/260504-1847-agent-portal-demo/plan.md`
- DEMO_2WEEK_PLAN.md §5: 20 Success Criteria (verification checklist)
- Prior handoff: `phase-12-speed-test-ui-polish.md` → Handoff Notes

## Overview
Prepare the demo package: enrich seed data for presentation quality, write README, write demo script, run full verification against all 20 success criteria on the presenter's machine. No new features — only polish, documentation, and verification.

## Prerequisites
- Phases 00–12 complete: all features implemented and working
- Speed test passes 50 executions
- All 5 n8n workflows active

## Files to Create / Modify

```
AgentPortal/
├── README.md                        (create)
├── DEMO_SCRIPT.md                   (create)
├── backend/prisma/seed.ts           (modify — enrich demo data)
└── docs/
    └── n8n-workflow-setup.md        (create — n8n import guide)
```

## Day 14: Data Prep + Documentation

### 1. Enrich seed data for demo presentation
The initial seed creates minimal data. For demo, pre-populate realistic history:

**Agents to create in seed:**
```typescript
// 3 pre-created agents with history:
// 1. "Sales Lead Pipeline" (gmail-lead-classifier) — status: running, 45 past executions
// 2. "Weekly Slack Report" (slack-daily-summary) — status: running, 12 executions  
// 3. "Support Ticket Router" (ticket-triage-agent) — status: paused, 8 executions, 1 failure

// Execution history (seeded, not from n8n):
// - 40 successful executions across agents
// - 5 warnings
// - 5 failures (with notifications)
// Spread over past 7 days (random timestamps)
// Analytics will show: ~91% success rate, avg 4.2s, ~$0.85 total cost
```

**Why:** Analytics page looks convincing with real history. Empty analytics = weak demo.

### 2. Demo seed script — separate from initial seed
```bash
npm run prisma:demo-seed   # runs demo-enrichment.ts
```

Create `backend/prisma/demo-enrichment.ts`:
```typescript
// Creates demo agents + execution history
// Safe to run multiple times (upsert pattern)
// Run AFTER base seed
```

### 3. README.md
```markdown
# Agent Operations Portal — Local Demo

## Prerequisites
- Docker Desktop
- Node.js 18+ (for speed test script only)
- 10 minutes

## Quick Start
\`\`\`bash
git clone <repo>
cd AgentPortal
cp .env.example .env
docker compose up --build
\`\`\`

## Access
| Service | URL | Credentials |
|---------|-----|-------------|
| Portal | http://localhost:5173 | admin@demo.local / demo1234 |
| n8n | http://localhost:5678 | admin / admin |
| Backend API | http://localhost:4000/api/health | — |

## n8n Workflow Setup (Required)
See docs/n8n-workflow-setup.md

## Seed Demo Data
\`\`\`bash
docker compose exec backend npm run prisma:seed
docker compose exec backend npm run prisma:demo-seed
\`\`\`

## Speed Test
\`\`\`bash
npm run speed-test -- --template gmail-lead-classifier --count 50
\`\`\`

## Troubleshooting
- n8n not starting: check port 5678 not in use
- Backend 500: verify DATABASE_URL in .env
- Auth failing: confirm BETTER_AUTH_SECRET matches in .env
```

### 4. docs/n8n-workflow-setup.md
Step-by-step guide:
1. Open http://localhost:5678, login (admin/admin)
2. For each workflow in `n8n-workflows/`:
   - New workflow → ⋮ → Import → paste JSON
   - Activate toggle (top right)
3. Verify all 5 workflows show green "Active" status
4. (Optional) Slack real integration: Settings → Credentials → New Slack → paste bot token

### 5. DEMO_SCRIPT.md
Customer walkthrough script — ~10 minutes:

```markdown
# Demo Script — Agent Operations Portal

**Duration:** 10 minutes  
**Presenter:** Engineer  
**Setup:** docker compose up, seed done, all n8n workflows active

---

## Opening (1 min)
"This is Agent Operations Portal — a controlled environment where business teams
can run AI automation agents without touching the underlying workflow logic."

## Act 1: Template Catalog (2 min)
1. Open http://localhost:5173 → log in
2. Navigate to Agents → Templates tab
3. "Templates are defined by engineering. Users can browse but cannot edit workflow logic."
4. Show: Gmail Lead Classifier card — required/optional integrations, cost level

## Act 2: Create Agent Wizard (3 min)
1. Click "Create Agent" on Gmail Lead Classifier
2. Step 2: "Note the limitations — this agent classifies only, never sends email"
3. Step 3: Try to add Helpdesk integration → it's not in the list. [DEMO POINT: controlled integrations]
4. Step 4: Fill in config — Gmail Label: "Inbound Leads", threshold: 75
5. Step 6: Test run → show polling → output appears
6. Step 7: Activate

## Act 3: Run + Results (2 min)
1. My Agents tab → find new agent → "Run Now"
2. Navigate to execution detail → show live polling spinner
3. Execution completes → show output: "3 hot leads found"
4. "The entire flow: frontend → our backend → n8n → callback → result"

## Act 4: Email Approval Flow (1 min)
1. Find Email Draft Responder agent → Run Now
2. Execution detail → show draft with Approve/Reject buttons
3. "Agents never auto-send. Human approval is built into the workflow."
4. Click Approve → status changes

## Act 5: Operations (1 min)
1. Navigate to Notifications → show existing alerts
2. Analytics page → "91% success rate, $0.85 total cost over the past week"
3. Dashboard → "Ops team monitors health here without touching n8n"

## Closing
"This proves the product model: controlled agents, real automation engine,
human-in-the-loop where needed, full audit trail. Ready to scale."
```

## Day 15: Verification + Recording

### 6. Full verification — 20 success criteria checklist
Run through every criterion from DEMO_2WEEK_PLAN.md §5:

| # | Criterion | How to Verify | Status |
|---|-----------|---------------|--------|
| 1 | `docker compose up` starts all services | `docker compose ps` → 4 running | ☐ |
| 2 | Frontend loads at localhost:5173 | Open browser | ☐ |
| 3 | User can register and log in | Go through auth flow | ☐ |
| 4 | Templates come from backend (not hardcoded) | Network tab → GET /api/agent-templates | ☐ |
| 5 | User creates agent from template | Go through wizard | ☐ |
| 6 | Disallowed integration cannot be selected | Try in Step 3 | ☐ |
| 7 | Missing required config → validation error | Leave field blank | ☐ |
| 8 | Run Now creates execution record | Check DB / UI | ☐ |
| 9 | Backend calls correct n8n workflow | Check backend logs | ☐ |
| 10 | n8n processes and callbacks backend | n8n execution log | ☐ |
| 11 | Backend updates execution status | Execution detail page | ☐ |
| 12 | Frontend shows execution result | Output viewer | ☐ |
| 13 | Email Draft shows Approve/Reject | Run email-draft-responder | ☐ |
| 14 | Failed execution creates notification | Simulate failure, check /notifications | ☐ |
| 15 | Retry creates new execution | Retry button on failed | ☐ |
| 16 | Analytics updates after each execution | Run agent, check /analytics | ☐ |
| 17 | Real integration runs via n8n | Slack with real token (if available) | ☐ |
| 18 | Speed test runs 50 executions | `npm run speed-test -- --count 50` | ☐ |
| 19 | README guides setup in <30 min | Follow cold | ☐ |
| 20 | Demo script covers full walkthrough | Review DEMO_SCRIPT.md | ☐ |

### 7. Clean setup test
```bash
docker compose down -v          # destroy everything including volumes
docker compose up --build       # rebuild from scratch
# Then: seed, n8n import, verify criteria 1-4
```

This validates the demo works for a first-time setup — critical if recording on a different machine.

### 8. Recording checklist
- [ ] Browser zoom: 110% (readable on large screen)
- [ ] Docker running, all services healthy before recording
- [ ] Demo data seeded, n8n workflows active
- [ ] Follow DEMO_SCRIPT.md exactly — record in one take if possible
- [ ] Backup: record 2 takes, keep better one

## Done Criteria
- [ ] All 20 success criteria pass on presenter's machine
- [ ] `docker compose down -v && docker compose up --build` works clean
- [ ] README.md guides a cold setup in under 30 minutes
- [ ] DEMO_SCRIPT.md is rehearsed — presenter can deliver without reading word-for-word
- [ ] Speed test 50 executions completes with >90% success rate
- [ ] Recording completed

## Final Notes
- Buffer days May 27–30 reserved for critical bug fixes only
- No new features after this phase — scope is locked
- n8n commercial licensing: flagged as required legal review before any production SaaS use
