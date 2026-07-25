# Raw agent report — Repo-root directory audit (Agent 6)

> Raw output from the read-only explore agent. Feeds ARCHITECTURE_MAP.md §1 (Folder Guide) + §7 (Open Questions).

## The single most important finding
Repo chứa **hai project độc lập** trong một git, không chia sẻ gì runtime:

| | **Project A — Video Content Farm (DEAD/frozen)** | **Project B — AgentPortal/MKTAgent (ACTIVE)** |
|---|---|---|
| Root dirs | `render-service/`, `db/`, `scripts/`, `n8n-workflows/`, `source/`, `out/`, `output/`, `.remotion/`, `.cache/`, `ReferenceVideoType/`, `screenshot/`, root `docker-compose.yml` | `MKTAgent/` (self-contained: own `src/db`, own `prisma`, own compose) |
| DB | Postgres `videofarm` @ :5432, Prisma pkg `@videofarm/db` (root `db/`), 3 migrations | Postgres `mktagent` @ :5433, `MKTAgent/prisma/`, 50 migrations |
| Last real commit | 2026-06 → early 07 (frozen) | 2026-07-25 (active) |
| Orchestration | n8n + Remotion render microservice | in-app Master Agent (Atria) + agent DAG |

**MKTAgent imports NOTHING from Project A.** Image capability was VENDORED into `MKTAgent/src/imagegen/nano-banana.ts`. n8n officially retired (root README). → Refactor thực chất là **single-project (MKTAgent)**.

## Per-directory verdicts
- **`render-service/`** — DEAD relative to MKTAgent. Remotion video-render microservice (`@videofarm/render-service`). Vendored in, no HTTP call from MKTAgent (only comment lineage refs). Only in root compose. Last commit 2026-07-03. SAFE TO IGNORE.
- **`db/` (root)** — DEAD, NOT authoritative. `@videofarm/db`, models `Pipeline{quiz,news_comic,life_hacks,cooking_explode}`. `MKTAgent/prisma/` is authoritative (50 vs 3 migrations, different DB/port). SAFE TO IGNORE.
- **`scripts/` (root)** — DEAD. One-off cooking/video pipeline scripts (gen-cooking-images, e2e-final-stitch, build-explode-composition, backup-db.sh backs up *videofarm*). SAFE TO IGNORE.
- **`n8n-workflows/`** — DEAD, officially retired (README §History). 16 legacy JSON exports. Backend rewritten n8n→plain-TS. Keep as **business-logic reference**.
- **`RefactorIdea/`** — ACTIVE reference (docs only). `Atria-MVP-Plan.md`, `atria-command-center-v2.html` mockup, `atria-v2-source.txt`. Last commit 2026-07-06, targets Atria. RELEVANT design intent.
- **`docs/` (root)** — ACTIVE, authoritative. Last commit 2026-07-25. Key: `docs/product/*` (10 files, the architecture bible — start at `product/README.md`), `feature-map.md` (105KB commit ledger), `project-changelog.md` (90KB), `development-roadmap.md` (**STALE 2026-07-08**), `code-standards.md` (**DOES NOT EXIST** — standards live in `.claude/rules/development-rules.md`). archive/ = historical, journals/ = failure logs. Cooking/quiz runbooks = Project-A legacy; cold-start current. CENTRAL to refactor.
- **`source/`** — DEAD. Project-A asset masters (`bo-kho`, `bun-mam` = Vietnamese dishes). Only 1 storyboard JSON tracked; PNGs gitignored. SAFE TO IGNORE.
- **`out/`, `output/`, `.remotion/`, `.cache/`** — DEAD generated output, 0 tracked files (all gitignored). Deletable/regenerable.
- **`ReferenceVideoType/`, `screenshot/`, `testui/`** — local scratch, gitignored/untracked, 0 tracked. SAFE TO IGNORE.
- **Root markdown**: `README.md` ACTIVE (what-is + run + n8n-retired notice), `SETUP.md` ACTIVE (MKTAgent run walkthrough), `FEATURES.md` ACTIVE (route/endpoint inventory of Atria), `DEMO_SCRIPT.md` STALE/Project-A ("Video Content Farm M2" — current demo is `docs/atria-demo-script.md`), root `docker-compose.yml` DEAD Project-A stack.

## SAFE TO IGNORE for the MKTAgent refactor
`render-service/`, `db/` (root), `scripts/`, `n8n-workflows/` (keep as logic reference), `source/`, `out/`, `output/`, `.remotion/`, `.cache/`, `ReferenceVideoType/`, `screenshot/`, `testui/`, root `docker-compose.yml`, `DEMO_SCRIPT.md`, root loose `*.png`.

## LIVE — refactor must engage
`MKTAgent/` (whole thing), `docs/` (esp `docs/product/*`, `feature-map.md`, `project-changelog.md`), `RefactorIdea/`, root `README.md`/`SETUP.md`/`FEATURES.md`, `plans/` (54 plan dirs = historical intent; code wins where they disagree).

## Open questions (for §7)
1. Project A (render-service+db+n8n+scripts+cooking assets) — DELETE, archive-branch, or leave frozen in-tree? Bloats repo, confuses newcomers (two Prisma schemas, two composes, two DBs).
2. `n8n-workflows/` — confirm business logic fully ported → move to `docs/archive/`?
3. `docs/development-roadmap.md` stale (2026-07-08) but rule-mandated — refresh or supersede with `docs/product/09-today-actionable.md`?
4. `code-standards.md` gap — rules mandate it, doesn't exist — create canonical file?
5. Root `docker-compose.yml` n8n stack still references `videofarm` + mounts n8n-workflows — any live process (token-refresh cron) using it, or fully in MKTAgent TS?
