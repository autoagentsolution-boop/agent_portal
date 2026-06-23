# Marketing + Lead-Gen Pipeline — Setup

Sheet-driven multi-platform poster + inbound form lead capture. Independent of the video farm
(shares only the Postgres instance + n8n). Plan: `plans/260623-1508-marketing-leadgen-pipeline/`.

## Workflows

| File | Loop | Trigger | Purpose |
|------|------|---------|---------|
| `n8n-workflows/mkt-post-scheduler.json` | A (posting) | cron `*/20 * * * *` | read calendar → claim → post → write-back |
| `n8n-workflows/mkt-lead-capture.json` | B (leads) | webhook `POST /webhook/mkt-lead` | form → validate → leads tab + Gmail |
| `n8n-workflows/mkt-meta-token-refresh.json` | — | cron Sun 03:00 | refresh FB Page + Threads long-lived tokens |

> **Phase 1 status:** the FB/Threads **publish** step in `mkt-post-scheduler` is a placeholder Code node
> (`Platform fan-out (adapters)`). The full loop — advisory lock, claim, idempotency, validation,
> write-back, audit, unlock — is real and testable now. Wire the real HTTP publish subgraphs (per
> `plans/.../phase-05-platform-adapter-spec.md`) once `MKT_*` Meta creds exist (see below).

## 1. Import

```bash
# Windows Git Bash: prevent path mangling of the n8n API route
MSYS_NO_PATHCONV=1 n8n import:workflow --input=n8n-workflows/mkt-post-scheduler.json
MSYS_NO_PATHCONV=1 n8n import:workflow --input=n8n-workflows/mkt-lead-capture.json
MSYS_NO_PATHCONV=1 n8n import:workflow --input=n8n-workflows/mkt-meta-token-refresh.json
```

Or import via the n8n UI (Workflows → Import from File). All three import **inactive**; activate after creds are bound.

## 2. Environment variables

Fill the `Marketing + Lead-Gen Pipeline` block in `.env` (see `.env.example`). Never commit `.env`.
The workflow JSON contains **zero** secret literals — all tokens resolve via `{{$env.*}}` or the n8n
credential vault.

## 3. n8n credentials (create in UI, names must match the JSON)

| Credential name | Type | Scopes |
|-----------------|------|--------|
| Marketing Google Sheets | googleSheetsOAuth2Api | spreadsheets (read+write) |
| Marketing Google Drive | googleDriveOAuth2Api | drive.readonly (download assets) |
| Marketing Gmail (Sales) | gmailOAuth2 | gmail.send |
| Videofarm Postgres | postgres | (reused, already exists) |

Meta tokens (FB Page, Threads) are stored as n8n credentials too; capture their credential IDs into
`MKT_FB_CREDENTIAL_ID` / `MKT_THREADS_CREDENTIAL_ID` so the weekly refresh can PATCH them.

## 4. Google Sheet (control plane)

Create one spreadsheet, ID → `MKT_SHEET_ID`. Two tabs:

**`calendar`** — headers (row 1, exact): `id, product, angle, copyVi, copyEn, driveFolderId, platforms,
scheduledAt, status, postUrl, postedAt, error`. Set `status` data-validation to
`ready,posting,posted,partial,error`. Authors write `scheduledAt` in **Asia/Bangkok**.

**`leads`** — headers: `receivedAt, name, email, phone, message, sourceProduct, sourcePlatform, rawPayload`.

Share the spreadsheet with the Google account behind the n8n OAuth creds.

## 5. Google Drive (asset store)

```
marketing-creative/
  <id>/                  ← calendar.driveFolderId points here
    hero.png             ← REQUIRED (missing → row goes to status=error, no post)
    slides/01.png …      ← OPTIONAL; absent/empty → hero-only post, carousel skipped
```

Zero-pad slide filenames for deterministic carousel order. Share `marketing-creative/` with the n8n Google account.

> **Threads caveat:** Threads publishing needs **public image URLs**, not binary upload. Before wiring the
> Threads adapter, set the Drive assets (or a mirror) to "anyone with link", or serve them via the
> render-service static host. FB Page uses binary upload and has no such requirement.

## 6. Lead form (Google Form + Apps Script glue)

Google Form has no native webhook — a bound Apps Script forwards submissions to the n8n webhook.

1. Create the Form; questions map to `name, email, phone, message`.
2. Use a **prefilled link** in post CTAs to carry attribution:
   `https://docs.google.com/forms/d/<id>/viewform?usp=pp_url&entry.<productField>=<id>&entry.<platformField>=<fb|threads>`
3. Form → ⋮ → **Apps Script**, paste, set Script Properties `WEBHOOK_URL` + `WEBHOOK_SECRET`, then add an
   **installable** `onFormSubmit` trigger (simple triggers lack `UrlFetchApp` external-request scope):

```javascript
function onLeadFormSubmit(e) {
  const props = PropertiesService.getScriptProperties();
  const fields = {};
  e.response.getItemResponses().forEach(r => {
    fields[r.getItem().getTitle().toLowerCase()] = r.getResponse();
  });
  const payload = {
    name: fields.name || '', email: fields.email || '',
    phone: fields.phone || '', message: fields.message || '',
    product: e.namedValues?.product || '', platform: e.namedValues?.platform || ''
  };
  UrlFetchApp.fetch(props.getProperty('WEBHOOK_URL'), {
    method: 'post', contentType: 'application/json',
    headers: { 'X-Webhook-Secret': props.getProperty('WEBHOOK_SECRET') },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
}
```

> **Maintenance note:** this script lives in the Form's bound project (Google, **not** in this repo). If the
> Form is recreated, re-add the script + installable trigger. `WEBHOOK_SECRET` must equal
> `MKT_LEAD_WEBHOOK_SECRET` in `.env`.

## 7. Meta OAuth (FB Page + Threads)

Reuses the `fb-token-refresh.json` pattern (exchange long-lived token weekly, PATCH the n8n credential).

- **FB Page type matters:** classic Page vs new Pages-experience use different Graph endpoints/tokens. Verify
  in Meta Business Suite before wiring — the multi-photo `attached_media` flow assumes a **classic Page**.
- **Threads** needs a Threads profile linked to the same Meta app with `threads_basic` +
  `threads_content_publish`. Separate token from the FB Page token. Leave the `MKT_THREADS_*` vars blank until
  the account exists — the refresh workflow skips Threads when unset.

## 8. Operations

- **Monitoring:** rows stuck in `status=posting` > 30 min = crashed mid-run → manually reset to `ready`.
  Audit trail in Postgres `run_log` (`step='upload'`, `detail.event='mkt_post'`).
- **Idempotency:** `pg_try_advisory_lock(hashtext('mkt-post-scheduler'))` guards overlapping cron ticks
  (no reliance on n8n concurrency settings). Session-scoped → a crash auto-frees the lock.
- **Partial failure:** `status=partial` is terminal. Inspect `error` col, fix, manually re-arm to `ready`.
  Phase 1 does **not** auto-retry only-failed platforms (would double-post the succeeded one).
- **Debugging a failed post:** check the execution in n8n → the `error` column JSON names which platform
  failed and why.
- **Rate:** 1 post / 20 min = 72/day ceiling. Threads 250/day, FB generous — both far above ceiling.

## 9. Phase 2 (design only — not built)

Replace manual ChatGPT creative with Gemini auto-gen + Google Slides API + a review gate
(`status=review` → human approves → post). See `plans/.../phase-07-phase2-autogen-design.md`. The Phase 1
manual period is deliberately a "golden prompt" collection phase — validated ChatGPT prompts become the
Gemini templates.
