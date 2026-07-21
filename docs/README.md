# Documentation Index

Entry point for `docs/`. Everything listed here is current unless marked otherwise.
Point-in-time session handoffs live in [`archive/`](archive/) and are kept for history only —
**do not** treat them as current state.

## Start here

| If you are… | Read |
|---|---|
| New to the system | [`product/01-architecture-techstack-layers.md`](product/01-architecture-techstack-layers.md) → [`product/04`](product/04-capabilities-and-human-in-the-loop.md) → [`product/05`](product/05-agent-nodes-architecture.md) |
| Looking for what the product does | [`../FEATURES.md`](../FEATURES.md), then [`feature-map.md`](feature-map.md) |
| Assessing risk / compliance | [`product/02-logic-gates-rules-guardrails.md`](product/02-logic-gates-rules-guardrails.md) → [`product/04`](product/04-capabilities-and-human-in-the-loop.md) |
| Planning the next quarter | [`product/06-technical-debt-and-improvements.md`](product/06-technical-debt-and-improvements.md) → [`product/08`](product/08-making-agent-nodes-real-subagents.md) |
| Getting a dev env up | [`runbook-cold-start.md`](runbook-cold-start.md), [`troubleshooting.md`](troubleshooting.md) |

## Product documentation — `product/`

The full-codebase scan (2026-07-18). Has its own index with reading orders, autonomy semantics,
and a confidence table: **[`product/README.md`](product/README.md)**.

Two cautions that are easy to miss:

- **Docs 07 and 08 must be read together.** 07 asks *"can Atria invent and spawn agents at
  runtime?"* (largely no). 08 asks *"can the 18 agents we already have be upgraded in place?"*
  Different questions, different answers — read apart they sound contradictory.
- **Doc 08's headline recommendation is retracted** by a measurement banner at the top of the file.
  Read the banner before acting on Part 4.

## Where the rule-mandated docs actually live

`.claude/rules/documentation-management.md` names four documents. Two exist under those exact
names; two are satisfied by files with different names. No duplicates were created — this table is
the mapping.

| Name in the rules | Actual location | Status |
|---|---|---|
| `docs/development-roadmap.md` | [`development-roadmap.md`](development-roadmap.md) | Exists — **stale**, last substantive edit 2026-07-08 |
| `docs/project-changelog.md` | [`project-changelog.md`](project-changelog.md) | Exists, current |
| `docs/system-architecture.md` | [`product/01-architecture-techstack-layers.md`](product/01-architecture-techstack-layers.md) | Different name, same role |
| `docs/code-standards.md` | *No equivalent.* Standards live in [`../.claude/rules/development-rules.md`](../.claude/rules/development-rules.md) | Genuine gap |

## Operational docs

**Runbooks** — [cold start](runbook-cold-start.md) · [cooking pipeline](runbook-cooking-pipeline.md) · [quiz pipeline](runbook-quiz-pipeline.md) · [troubleshooting](troubleshooting.md)

**Setup & connections** — [OAuth](oauth-setup.md) · [connections owner setup](connections-owner-setup.md) · [n8n workflows](n8n-workflow-setup.md)

**Marketing / publishing** — [access tokens](marketing-access-token-setup-guide.md) · [social token deployment](marketing-social-token-deployment.md) · [platform onboarding](marketing-platform-onboarding-guide.md) · [pipeline setup](marketing-pipeline-setup.md) · [form + cal.com leads](marketing-form-calcom-lead-setup.md) · [test preflight](marketing-test-preflight-checklist.md) · [media constraints](publishing-media-constraints.md)

**Demos** — [Atria demo script](atria-demo-script.md) · [campaign-intelligence e2e](atria-campaign-intelligence-e2e.md)

**Journals** — [`journals/`](journals/), written on notable failures/setbacks.

## Plans — `../plans/`

54 timestamped plan directories, named `{YYMMDD}-{HHMM}-{slug}`, newest last when sorted.
Each holds a `plan.md` overview plus `phase-XX-*.md` files. Agent reports land in
[`../plans/reports/`](../plans/reports/).

Plans are **historical records of intent**, not current-state documentation. A completed plan
describes what was decided at that time; the code and `docs/product/` describe what is true now.
Where they disagree, the code wins.

## Conventions

- New docs go in `docs/`; new plans in `plans/{date}-{slug}/`. Nothing markdown outside those two.
- Session-handoff notes are **archived, not deleted** — but write them into a plan directory, not
  `docs/`, so `docs/` stays current-state only.
- Line-number references in `product/` are point-in-time pointers for re-location. They drift.
