# Phase 06 — Security + Operations

**Context:** [plan.md](plan.md) · spans all phases. Scouted repo rule: never commit keyed n8n JSON
(memory `feedback_never_push_env`), env-var creds (`upload-to-platforms.json:89`).
**Priority:** P1 (finalize after P02–P05 graphs settle). **Status:** pending.
**Owns:** `docs/marketing-pipeline-setup.md`, `.env.example` marketing block.

## Credential vault (hard rules)
- ALL secrets via `{{$env.*}}` in workflow JSON. ZERO literal tokens/keys/secrets in any committed `.json`.
- Pre-commit check before pushing the three new workflows: grep for token-shaped literals (long base64,
  `EAA…` FB tokens, `xoxb`, API keys). If found → BLOCK (matches repo's never-push-keyed-JSON rule).
- Tokens live only in: n8n credential vault + local `.env` (gitignored). `.env.example` carries KEYS ONLY.

### `.env.example` marketing block (append)
```dotenv
# --- Marketing + Lead-Gen pipeline -------------------------------------------
MKT_FB_PAGE_ID=
MKT_FB_PAGE_ACCESS_TOKEN=
MKT_FB_APP_ID=
MKT_FB_APP_SECRET=
MKT_FB_CREDENTIAL_ID=
MKT_THREADS_USER_ID=
MKT_THREADS_ACCESS_TOKEN=
MKT_THREADS_CREDENTIAL_ID=
MKT_LEAD_WEBHOOK_SECRET=
MKT_SALES_EMAIL=
# N8N_API_KEY reused from video-farm block (credential PATCH on refresh)
```

## Webhook auth (Loop B)
- Form webhook is PUBLIC. Defense: header `X-Webhook-Secret` == `$env.MKT_LEAD_WEBHOOK_SECRET` (constant-time compare).
- Sent by the Google Form's bound Apps Script (secret in Script Properties — see P04). Reject malformed/unauthed
  fast (401/400) before any Sheets/Gmail call → cheap to absorb spam.
- Rotate `MKT_LEAD_WEBHOOK_SECRET` if leaked; update both Apps Script Script Properties + n8n env.

## Rate-limit awareness per platform
| Platform | Limit | Our load | Headroom |
|----------|-------|----------|----------|
| FB Page | generous app-level rate | ≤72 posts/day (1/20min) | ample |
| Threads | 250 posts/24h/profile | ≤72/day | ample |
| X (P2+) | tier-dependent | n/a | see cost flag |
| Gmail send | ~per-mailbox daily caps | 1 email/lead | fine at expected lead volume |
- One-post-per-tick (P02) keeps us structurally under every cap. Raising cadence later needs re-check.

## Token-expiry behavior
- FB Page + Threads tokens: 60-day expiry, refreshed weekly by P03's `mkt-meta-token-refresh` (8× margin).
- If refresh job inactive/fails → token eventually 401s → adapter returns `{ok:false}` → row goes `error`
  (NOT silent). Monitoring (below) surfaces it.
- **T-7day alert:** mirror `docs/oauth-setup.md:137` guidance — alert 7 days before expiry until refresh proven.
- Gmail/Sheets/Drive OAuth: n8n auto-refreshes access tokens; only break if refresh token revoked.

## Monitoring — which rows errored
- **Primary:** filter `calendar` Sheet for `status IN (error, partial)` → operator dashboard view.
- **Stuck-in-posting:** alert any row in `posting` > 30 min (crash mid-run); manual reset to `ready`.
- **Optional audit sink:** reuse Postgres `run_log` (migration `20260602120000_init`) — INSERT a row per post
  attempt `{event, id, platform, ok, error}` for queryable history beyond the Sheet.
- **Lead loop:** alert on Gmail node error (lead row still written = recoverable; Sales just didn't get email).

## Debugging a failed post (runbook)
1. Sheet row `error`/`partial` → read `error` col for which platform + message.
2. n8n → Executions tab → open the failed execution → inspect the adapter's error-branch output.
3. Common causes: token 401 (→ check refresh job), Threads image_url not public (→ check Drive share),
   missing hero.png (→ Drive), copy >500 on Threads (→ truncation node).
4. Fix root cause → set row `status` back to `ready` to retry (manual re-arm; no auto-retry by design).

## X API cost reality (P2+ flag)
- **X write requires paid tier.** Basic ≈ **$100/mo** (3k posts/mo write); Pro is far higher.
  Free tier write ~1.5k/mo but unstable/limited. → X adapter is NOT free like FB/Threads.
- Decision gate before building X adapter: is the marginal reach worth ≥$100/mo? Defer until Phase-1
  FB/Threads ROI proven. Documented so it is a conscious spend, not a surprise.

## Success Criteria
- [ ] No literal secret in any committed workflow JSON (grep clean).
- [ ] `.env.example` lists all `MKT_*` keys, values empty.
- [ ] Webhook rejects unauthed requests.
- [ ] Operator can find errored rows in one Sheet filter.
- [ ] Setup doc (`docs/marketing-pipeline-setup.md`) covers import + creds + activation + runbook.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| Secret committed in JSON | L×H | env-var-only + pre-commit grep gate (repo rule) |
| Silent token expiry | M×H | weekly refresh + T-7 alert + error-state visibility |
| Public webhook abuse | M×M | header secret + fast reject |
| Unbounded X spend | L×H | explicit decision gate before building X adapter |

## Next Steps
Write `docs/marketing-pipeline-setup.md` (mirror `docs/n8n-workflow-setup.md` structure incl. Windows
`MSYS_NO_PATHCONV=1` import gotcha). Append `.env.example`. Wire optional `run_log` audit.
