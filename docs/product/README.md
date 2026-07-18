# Product Documentation

Full-codebase scan of `pivot/video-content-farm`, generated 2026-07-18. Line numbers are point-in-time pointers for re-location, not permanent anchors — they drift on edit.

| # | Document | Answers |
|---|---|---|
| 01 | [Architecture, tech stack & layers](01-architecture-techstack-layers.md) | Component map, per-directory responsibility, request lifecycle, data model, cross-cutting concerns |
| 02 | [Logic, gates, rules & guardrails](02-logic-gates-rules-guardrails.md) | ~55 gates across 6 categories — who can pass each, and how it fails |
| 03 | [Hardcoded inventory & flexibility](03-hardcoded-inventory-and-flexibility.md) | What's hardcoded, what should become configurable, what deliberately should not |
| 04 | [Capabilities & human-in-the-loop](04-capabilities-and-human-in-the-loop.md) | What the product does today (LIVE vs DRY-RUN), and the decision-rights matrix: human vs Atria |
| 05 | [Agent-node architecture](05-agent-nodes-architecture.md) | Registry anatomy, node catalogue, grouping, execution model — and whether nodes are true sub-agents |
| 06 | [Technical debt & improvements](06-technical-debt-and-improvements.md) | Prioritised P0/P1/P2 debt, sequencing, what not to build — and what is deliberate design, not debt |
| 07 | [Dynamic sub-agent orchestration gap](07-dynamic-subagent-orchestration-gap.md) | Could Atria spawn agents at runtime the way a coding agent does? Gap analysis + 3 staged options |
| 08 | [Making agent nodes real sub-agents](08-making-agent-nodes-real-subagents.md) | Design brainstorm: which nodes should gain which agent capabilities, and which stay functions forever. **Its headline recommendation is dead — see the banner.** |
| 09 | [What can be done today](09-today-actionable.md) | The same-day subset: contained, verifiable, no decision required |

## Reading order

- **New to the system:** 01 → 04 → 05
- **Evaluating risk / compliance:** 02 → 04
- **Planning the next quarter:** 06 → 08 → 03
- **Answering "can Atria build its own agents?":** 05 §5 → 07 → 08

## Autonomy semantics — read this before citing docs 04/06

Frequently misread by scanners and worth stating once, plainly:

- **An autonomy grant authorizes end-to-end execution, including a real publish.** The human double-confirms one specific flow upfront. `atriaApprovalPolicy` (`approval-policy.ts:36-53`) then *verifies guardrails* at each gate — it never independently decides to publish. Guardrails fail → park + notify, never blind-publish.
- **The `schedule` gate always holds, and that is a halt mechanism, not a veto.** It exists so Atria **cannot** bypass a scheduling requirement and run immediately. A granted run resumes under its grant when the cron re-enters at the scheduled instant.
- **DRY-RUN is a test posture, not a missing capability.** It exercises the loop without spending real platform writes. Going live is a config decision.

## Confidence

Docs 01–05, 07 were produced by parallel scanning agents reading source directly. Docs 06 and 08 synthesise them plus direct measurement. Three agent claims were independently re-verified and **corrected** during synthesis:

| Claim | Correction |
|---|---|
| Superadmin path relies on client-side obscurity | Server-enforced: `/admin` behind `requireAuth, requireSuperAdmin` (`server.ts:147`), DB flag, 404 not 403 (`middleware-superadmin.ts:8-11`) — corrected in doc 03 |
| Autonomy cron DRY-RUN publish is a stub / capability gap | Deliberate test posture; separately, a grant *does* authorize real end-to-end publish — corrected in doc 04 |
| Schedule hold shows autonomy can't be trusted with scheduling | It is the wait mechanism enforcing that a schedule can't be bypassed — corrected in doc 04 |

Claims still carrying `[reported]` in doc 06 (kill-switch and rate-limiter fail-open behaviour) have **not** been independently verified and must be checked against the code before any fix is scheduled.
