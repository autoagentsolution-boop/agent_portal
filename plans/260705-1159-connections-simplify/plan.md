# Connections simplification — OAuth-first, non-tech friendly

## Decisions (locked with user 2026-07-05)
- **Model:** multi-tenant, **OAuth-first**. Owner configures each platform's app ONCE
  (client id/secret). End users click **Connect → Authorize** (zero fields), own account.
- **Drive:** end users have ZERO console friction (inherent to OAuth). Only the owner does a
  one-time Google console setup (register redirect + enable Drive API + `drive.file` scope,
  non-sensitive → no verification). Keep dedicated Drive connect; add owner setup hint + exact steps.
- Token-paste form = **advanced fallback**, collapsed. Trim to minimal required fields.

## Problem (current)
- Each card shows 3-4 fields (access token + app id/secret/page id/…) + TWO buttons
  ("Connect (OAuth)" and "Enter token") → overwhelming for non-tech users.
- **Latent bug:** pasted identity ids (`facebook_page_id`, `instagram_business_account_id`,
  `linkedin_author_urn`) are saved to the vault but adapters read only OAuth-meta/env → the
  token-paste path can't actually publish FB/IG/LinkedIn.
- All platform OAuth apps empty in env → no Connect works until owner sets them.

## Phases

### P1 — Adaptive OAuth-first card (the core UX win)
- BE: `connections-router` returns `oauthConfigured: boolean` per platform (wrap
  `connectProviders[p].assertConfigured` in try/catch, env-app check). Export helper from
  connect-providers.
- UI `ConnectionsPanel`: if `oauthConfigured` → **Connect** is the single primary action;
  token entry moves behind a subtle "Paste a token instead (advanced)" disclosure. If NOT
  configured → show a one-line owner hint ("set up this app to enable one-click connect") +
  the token fallback. Connected → "Reconnect" ghost + "Update token" tucked.

### P2 — Minimal fields + advanced grouping
- `publisher-credential-fields.ts`: split each platform into `required` (access token + the ONE
  identity id the adapter needs) and `advanced` (app id/secret, client id/secret). FB: token+pageId.
  IG: token+businessId. Threads: token(+userId). LinkedIn: token+authorURN. X: token only.
- `connection-credential-form.tsx`: render required first; "Advanced ▸" collapses the rest.

### P3 — Wire identity ids (make the fallback actually publish)
- Adapters (`facebook/instagram/threads/linkedin.ts`): identity id resolution becomes
  token-meta → **vault cred** (`getPublisherAppCred`) → env. Small, closes the latent bug.
  Key names aligned with the form (`facebook_page_id`, `instagram_business_account_id`,
  `threads_user_id`, `linkedin_author_urn`).

### P4 — Drive owner setup (clarity, not code)
- In-UI owner hint on the Drive card: the exact redirect URI to register + a "one-time setup"
  note. Verify the end-to-end once the owner registers it. Doc the steps.

### P5 — Owner one-time setup doc
- `docs/connections-owner-setup.md`: which env app creds per platform + each callback URI +
  Google console steps (Drive) + consent-screen "In production" note. Keep short.

## Deferred / flagged (deeper multi-tenant, NOT this pass)
- **Meta page/IG selection after OAuth:** the Meta connect stores a user token but does NOT
  capture which Page / IG business id to post to (`meta.note` placeholder). Multi-tenant FB/IG
  posting after pure OAuth still needs a page-picker step → separate ticket.
- Video → IG/Threads (lh3 thumbnail issue) — images only for now.
- LinkedIn refresh untested vs a real refresh-token-issuing tier.

## Verify
- BE typecheck + web build clean. `verify-api` green. Connections card renders adaptive vs a
  configured/unconfigured platform. Drive card shows owner hint. No live post (DRY per no-burst).
