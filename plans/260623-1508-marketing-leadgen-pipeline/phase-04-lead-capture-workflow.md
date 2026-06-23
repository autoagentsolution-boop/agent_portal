# Phase 04 — Lead Capture Workflow (Loop B)

**Context:** [plan.md](plan.md) · [phase-01](phase-01-sheet-and-drive-schema.md) `leads` tab.
**Priority:** P1 (independent of A — buildable in parallel). **Status:** pending.
**Workflow file:** `n8n-workflows/mkt-lead-capture.json`.

> **MVP PIVOT 2026-06-23:** MVP lead source is **Cal.com** (see [phase-10](phase-10-meeting-booking-calcom-design.md)),
> NOT Google Form. Every lead books a call; Cal.com `BOOKING_CREATED` webhook feeds this loop. The Google-Form
> + Apps-Script wiring below is **parked** (kept for a possible later low-intent second CTA). When building:
> point the webhook at the Cal.com payload shape; the secret check + dedupe + leads-tab append + Gmail notify
> chain all stay — only the producer changes.

## Overview
Inbound only. Posts carry a CTA → **Google Form**. A bound **Apps Script** `onFormSubmit` trigger POSTs the
response to an n8n webhook → validate → append to `leads` tab + email Sales. No X/scraping read APIs touched
(ToS-clean, no read-tier cost). Chosen over Tally: keeps everything in the existing Google stack (same account
already used for Sheets/Drive/Gmail) — no third-party form vendor.

## Data Flow
- **In:** Google Form response → Apps Script maps to JSON {name,email,phone,message,sourceProduct,sourcePlatform}
  → POST to n8n webhook with `X-Webhook-Secret` header.
- **Transform:** validate → dedupe by email → normalize.
- **Out:** Sheets append (`leads`) + Gmail to Sales + 200 response to the Apps Script.

## Node Graph (n8n side — unchanged by the form-tool switch)
```
[1] Webhook (POST /webhook/mkt-lead)
       - auth: header secret check (see [2]); responseMode: lastNode
       ↓
[2] Code: auth + validate
       - require header `X-Webhook-Secret` == $env.MKT_LEAD_WEBHOOK_SECRET → else 401 (constant-time compare)
       - require email present + regex valid → else 400
       - read sourceProduct/sourcePlatform from payload (Apps Script forwards them; see attribution)
       ↓
[3] Sheets: read `leads` (email column) → dedupe
       - if email already present within last N days → mark isDup=true (still log, skip Sales email)
       ↓
[4] Sheets: append row to `leads` (receivedAt=now, name, email, phone, message, source*, rawPayload)
       ↓
[5] IF isDup == false ─▶ [6] Gmail: send to Sales
       │                     - to: $env.MKT_SALES_EMAIL
       │                     - subject: "New lead: {product} via {platform}"
       │                     - body: name/email/phone/message + sheet link
       └─ isDup == true ─▶ skip email (avoid spamming Sales on resubmits)
       ↓
[7] Respond 200 { ok: true }
```

## Form tool: Google Form + Apps Script glue (chosen)
Google Form has no native webhook, so a bound Apps Script `onFormSubmit` **installable** trigger forwards each
response to n8n. This keeps the form inside the same Google account already running Sheets/Drive/Gmail.

### Apps Script snippet (lives in the Form's bound script — Extensions → Apps Script)
```javascript
// Installable trigger: Form → onFormSubmit → POST to n8n webhook.
// Set props once: File ▸ Project Settings ▸ Script Properties: WEBHOOK_URL, WEBHOOK_SECRET.
function onLeadFormSubmit(e) {
  const props = PropertiesService.getScriptProperties();
  const items = e.response.getItemResponses();
  const byTitle = {};
  items.forEach(it => { byTitle[it.getItem().getTitle().trim().toLowerCase()] = it.getResponse(); });

  const payload = {
    name:    byTitle['name']    || '',
    email:   byTitle['email']   || '',
    phone:   byTitle['phone']   || '',
    message: byTitle['message'] || '',
    // attribution: a hidden/prefilled short-answer field carries "product|platform" from the CTA prefill link
    sourceProduct:  (byTitle['source'] || '').split('|')[0] || '',
    sourcePlatform: (byTitle['source'] || '').split('|')[1] || '',
    submittedAt: new Date().toISOString(),
  };

  UrlFetchApp.fetch(props.getProperty('WEBHOOK_URL'), {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Webhook-Secret': props.getProperty('WEBHOOK_SECRET') },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true, // never block the form; n8n errors are logged, not surfaced to respondent
  });
}
```

### Attribution via prefill
CTA link points to a Form **prefilled** URL where a hidden short-answer "source" field = `<product>|<platform>`,
e.g. `https://docs.google.com/forms/d/e/<id>/viewform?usp=pp_url&entry.<fieldId>=bunmam01|fb`.
The script splits it into `sourceProduct` / `sourcePlatform`. No respondent typing required.

### Maintenance cost (document explicitly)
- The Apps Script is a **separate artifact**, bound to the Google Form — it does NOT live in this repo.
- Redeploy: Form ▸ Extensions ▸ Apps Script ▸ paste/edit ▸ run `Triggers ▸ + Add Trigger` → function
  `onLeadFormSubmit`, event source **From form**, type **On form submit** (installable; the simple `onFormSubmit`
  has insufficient auth scope for `UrlFetchApp`).
- Secrets live in **Script Properties** (`WEBHOOK_URL`, `WEBHOOK_SECRET`), NOT hard-coded — mirrors the repo's
  no-secrets-in-source rule. Keep a copy of this snippet in `docs/marketing-pipeline-setup.md` (P06) for recovery.

## Webhook auth
- Shared secret in header `X-Webhook-Secret` validated in [2] against `$env.MKT_LEAD_WEBHOOK_SECRET`
  (constant-time compare). Apps Script sends it from Script Properties.
- Rate guard: webhook is public; reject unauthed/malformed fast (cheap). P06 covers throttle awareness.

## Related Code Files
- **Create:** `n8n-workflows/mkt-lead-capture.json`
- **External (NOT in repo):** Apps Script bound to the Google Form — snippet mirrored in
  `docs/marketing-pipeline-setup.md` for recovery; canonical copy lives in the Form's bound script project.
- **Append:** `.env.example` (P06): `MKT_LEAD_WEBHOOK_SECRET`, `MKT_SALES_EMAIL`
- **Credential:** Gmail OAuth (Sales mailbox), Google Sheets (same as Loop A)

## Implementation Steps
1. Build n8n workflow: webhook + validate/auth code node + dedupe read + append + Gmail + respond.
2. Bind Gmail OAuth on the Sales mailbox and Sheets credential.
3. Create the Google Form (fields: Name, Email, Phone, Message, hidden "source"); add bound Apps Script.
4. In Apps Script: set Script Properties `WEBHOOK_URL` + `WEBHOOK_SECRET`; add the **installable** on-form-submit
   trigger for `onLeadFormSubmit` (simple trigger lacks `UrlFetchApp` scope).
5. Build CTA prefill links per product/platform.
6. Smoke: submit test form → Apps Script POSTs → row appears in `leads`, Sales gets email, response 200.
7. Negative: missing/wrong secret → 401; bad email → 400; duplicate email → logged, no second email.

## Success Criteria
- [ ] Valid submission → `leads` row + Sales email + 200.
- [ ] Wrong/absent secret → 401, no row written.
- [ ] Invalid email → 400.
- [ ] Duplicate email within window → row logged, NO duplicate Sales email.
- [ ] Attribution (product/platform) captured from CTA link.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| Public webhook spam/abuse | M×M | header secret + fast reject + P06 throttle; sheet append is cheap |
| Gmail OAuth token expiry → Sales misses lead | M×H | row still written (source of truth); P06 alert on Gmail node error; n8n auto-refreshes Gmail OAuth |
| Sheets append race (two leads same instant) | L×L | Sheets append is atomic per row; no claim needed (append-only) |
| PII in rawPayload | M×M | Sheet access-restricted; no PII in logs; document retention in P06 |
| Apps Script trigger silently breaks (drift, quota, off-repo) | M×H | snippet mirrored in setup doc; `muteHttpExceptions` so form never blocks; periodic test submission in P06 monitoring; canonical script off-repo — version it in doc on change |
| Apps Script `UrlFetchApp` daily quota exceeded | L×M | Google free quota ~20k fetch/day — far above lead volume; one fetch per submission |

## Security
- Secret via `$env` (n8n) + Script Properties (Apps Script) — never hard-coded in form config or repo.
- Gmail + Sheets via least-scope OAuth. `rawPayload` kept in restricted Sheet only.

## Next Steps
Fully independent. Sales does manual outreach from `leads` tab. Phase 2 unchanged by this loop.
