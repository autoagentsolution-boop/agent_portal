# Demo Script — Agent Operations Portal

**Duration:** ~10 minutes
**Audience:** Customer / stakeholder
**Presenter:** Engineer
**Setup checklist (do before opening the call):**

- [ ] `docker compose ps` — all 4 services healthy (postgres, n8n, backend, frontend)
- [ ] `curl -sf http://localhost:4000/api/health` returns `{status:"ok"}`
- [ ] Demo data seeded: `npm run prisma:seed && npm run prisma:demo-seed`
- [ ] All 5 n8n workflows show **Active** at http://localhost:5678
- [ ] Browser zoom 110%; only one tab open; ad-blockers disabled
- [ ] Logged in as `admin@demo.local`

---

## Opening (1 min)

> "Agent Operations Portal is a controlled environment where business teams can run
> AI automation agents — without touching the underlying workflow logic. Engineering
> defines what's possible; the business team composes and runs."

Show: http://localhost:5173 → Dashboard.

Talk through the dashboard tiles:
- **3 agents, 65 executions, 90.7% success, $0.93 spend** — last 7 days.
- "These numbers are real — every execution went through n8n."

---

## Act 1 — Template Catalog (2 min)

1. Navigate **Agents → Templates** tab.
2. "Templates are defined by engineering. Users browse them; they cannot edit workflow logic."
3. Click **Gmail Lead Classifier** card. Highlight:
   - **Required integrations:** Gmail (cannot remove)
   - **Optional integrations:** Slack, Google Sheets
   - **Cost level:** low
   - **Approval required:** no
4. Switch to **Email Draft Responder** — `approval_required: true`. "Some workflows can never auto-execute. Human approval is enforced server-side."

**Demo point:** the template list comes from `GET /api/agent-templates` (open DevTools Network tab to prove). Nothing is hardcoded in the frontend.

---

## Act 2 — Create Agent Wizard (3 min)

1. From the Gmail Lead Classifier card → **Create Agent**.
2. **Step 2 (Limitations):** "This agent classifies inbound leads only — it never sends email." Acknowledge limitation, continue.
3. **Step 3 (Integrations):** Show the integration picker.
   - Required (Gmail) is locked-on.
   - Try to add **Helpdesk** → it's not in the list. **Demo point:** controlled integrations enforced server-side.
4. **Step 4 (Configuration):** Fill in:
   - Gmail Label: `Inbound Leads`
   - Lead Score Threshold: `75`
   - Notify Slack: ✓
5. **Step 5 (Trigger):** Manual.
6. **Step 6 (Test Run):** Click **Run Test**.
   - Show polling spinner, then output panel populates.
   - "End-to-end: frontend → our backend → n8n webhook → callback → result. Same path as production runs."
7. **Step 7 (Activate):** Confirm. Agent now appears in **My Agents** with status `running`.

---

## Act 3 — Run + Live Polling (2 min)

1. Navigate **Agents → My Agents**. Pick **Sales Lead Pipeline**.
2. Click **Run Now**. Execution detail page opens.
3. Status flips: `queued → running → success` (live polling, 500ms interval).
4. Open the output viewer:
   - "3 hot leads identified out of 14 processed."
   - Drill into one lead — show classification, score, recommendation.
5. **Demo point:** every state transition is server-driven; the UI just polls. No client-side fakery.

---

## Act 4 — Approval Flow (1 min)

1. Navigate to **Email Draft Responder** (or run one if needed).
2. Open execution detail — output shows a **Draft** with **Approve / Reject** buttons.
3. "Agents that touch outbound channels never auto-send. The workflow halts; a human releases it."
4. Click **Approve** → status transitions; audit log captures the actor.

---

## Act 5 — Operations View (1 min)

1. **Notifications**: 3 unread error notifications from seeded failures. "Each failed execution surfaces here automatically — type, severity, link to the run."
2. **Analytics**:
   - Success rate by template (bar)
   - Daily run counts (timeline)
   - Token + cost trend
   - "All from the same execution table — no duplicate sources of truth."
3. **Dashboard**: "Ops team monitors health here without touching n8n."

---

## Closing (30s)

> "Three things the platform proves:
> 1. **Controlled** — engineering owns templates and integrations; business owns config.
> 2. **Real** — every run hits a real workflow engine; not a UI mock.
> 3. **Auditable** — execution table, notifications, audit log, all server-truth.
>
> Ready to discuss what we'd need to take this from local demo to a hosted product."

---

## Speed Test (Optional, post-demo)

If asked about scale:

```bash
cd backend && npm run speed-test -- --template gmail-lead-classifier --count 50
```

Observed locally on the demo machine:
- p50 ≈ 45ms, p95 ≈ 260ms
- ~108 executions/min single-threaded
- 100% success rate against active workflows

Caveat: throughput is gated by n8n single-instance worker; horizontal scaling is the production path.

---

## If Something Breaks Mid-Demo

| Symptom                                | Recovery                                                     |
|----------------------------------------|--------------------------------------------------------------|
| Run stuck in `queued`                  | Check n8n is up + workflow is **Active**                     |
| `n8n trigger failed: 404`              | Workflow inactive or webhook path mismatch                   |
| Approve button does nothing            | Check backend logs for `/api/executions/:id/approve` errors  |
| Frontend won't load                    | `docker compose logs frontend` — likely Vite still starting  |
| Login refuses                          | Re-run `prisma:seed` — idempotent, restores credential       |

Have a second terminal pre-warmed with `docker compose logs -f backend`.
