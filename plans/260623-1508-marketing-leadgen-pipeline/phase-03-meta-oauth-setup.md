# Phase 03 — Meta OAuth: FB Page + Threads

**Context:** [plan.md](plan.md) · reuses `docs/oauth-setup.md` §2 + `n8n-workflows/fb-token-refresh.json`.
**Priority:** P1 (blocks P02 posting). **Status:** pending.
**Workflow file:** `n8n-workflows/mkt-meta-token-refresh.json` (clone of fb-token-refresh, marketing creds).

## Overview
Two Meta tokens, SAME Meta app, DIFFERENT products/scopes:
1. **FB Page token** — publish image posts to a Page feed.
2. **Threads token** — publish to a Threads profile (separate user-id + scopes).
Both long-lived, both auto-refreshed weekly by cloning the existing refresh job.

## FB Page setup (reuse `docs/oauth-setup.md` §2 verbatim)
- App type Business; products: Pages API.
- Scopes: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
  (Drop `pages_manage_engagement` — not needed for posting-only.)
- Exchange short→long user token → fetch Page token via `/me/accounts` (steps unchanged from existing doc).
- **NEW env (marketing-namespaced, do NOT reuse video-farm FB vars):**
  ```dotenv
  MKT_FB_PAGE_ID=
  MKT_FB_PAGE_ACCESS_TOKEN=
  ```

## Threads setup (NEW — not in existing docs)
- In the SAME Meta app: add **Threads API** product (`developers.facebook.com` → Use cases → Threads).
- Scopes: `threads_basic`, `threads_content_publish`.
- OAuth flow returns a Threads user token + the Threads user-id (distinct from FB Page id).
- Long-lived exchange uses the Threads endpoint:
  `GET https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=...&access_token=...`
  (note `graph.threads.net`, NOT `graph.facebook.com`; grant_type `th_exchange_token`).
- **NEW env:**
  ```dotenv
  MKT_THREADS_USER_ID=
  MKT_THREADS_ACCESS_TOKEN=
  ```

## Token refresh job (clone fb-token-refresh)
Scouted pattern (`fb-token-refresh.json`): cron → preflight env check → exchange → parse (never log value) →
PATCH n8n credential via internal API → log. Clone TWICE-in-one-workflow (FB branch + Threads branch) or two
workflows. Recommend ONE `mkt-meta-token-refresh.json` with two parallel branches.

| Token | Refresh endpoint | grant_type | Expiry |
|-------|------------------|-----------|--------|
| FB Page | `graph.facebook.com/v18.0/oauth/access_token` | `fb_exchange_token` | 60 days |
| Threads | `graph.threads.net/access_token` | `th_exchange_token` | 60 days |

- Reuse the credential-PATCH node pattern (`fb-token-refresh.json:57-69`) for EACH credential id.
- **NEW env for refresh:**
  ```dotenv
  MKT_FB_APP_ID=
  MKT_FB_APP_SECRET=
  MKT_FB_CREDENTIAL_ID=        # n8n credential id holding the FB Page token
  MKT_THREADS_CREDENTIAL_ID=   # n8n credential id holding the Threads token
  # N8N_API_KEY reused (already in .env.example:72)
  ```
- Cron: weekly (Sunday 03:00, same as existing) — well inside 60-day window.

## Related Code Files
- **Create:** `n8n-workflows/mkt-meta-token-refresh.json`
- **Read for pattern:** `n8n-workflows/fb-token-refresh.json` (clone), `docs/oauth-setup.md` §2,§5
- **Append:** `.env.example` marketing block (owned by P06), `docs/marketing-pipeline-setup.md`

## Implementation Steps
1. One-time manual: create app products, grant scopes, mint both long-lived tokens (FB + Threads).
2. In n8n create two credentials (Meta-style HTTP header or generic) holding each token; record their ids.
3. Clone fb-token-refresh → two branches (FB + Threads endpoints/grant_types); swap env var names to `MKT_*`.
4. Smoke each token: FB `GET /{page_id}?fields=name`; Threads `GET /{user_id}?fields=username`.
5. Run refresh workflow manually once → confirm both credentials PATCHed, token VALUE never appears in logs.

## Success Criteria
- [ ] FB Page + Threads tokens both validate via GET smoke.
- [ ] Refresh workflow rotates both tokens; logs show only token LENGTH/expiry, never value.
- [ ] Marketing creds namespaced `MKT_*` — zero collision with video-farm FB vars.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| Token value leaked in logs | L×H | reuse "Parse new token (no value logged)" node verbatim (`fb-token-refresh.json:50`) |
| 60-day expiry missed if refresh job inactive | M×H | weekly cron + P06 T-7day alert; refresh runs 8× before expiry |
| Threads endpoint confusion (uses facebook.com) | M×M | endpoint table above; smoke per-token catches wrong host |
| Reusing video-farm FB app hits its rate budget | L×M | separate Meta app OR separate Page; namespaced env |

## Security
- No literal tokens in JSON/sheet (repo rule). Tokens live only in n8n credential vault + `.env`.
- `N8N_API_KEY` for credential PATCH stays in `.env`, never in workflow JSON literal.

## Next Steps
Unblocks P02 fan-out. Adapter publish chains (P05) consume `MKT_FB_*` / `MKT_THREADS_*`.
