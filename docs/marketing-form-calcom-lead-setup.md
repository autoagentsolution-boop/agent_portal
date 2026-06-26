# Lead Capture — Google Forms + Cal.com

Two inbound lead paths feeding the **same `leads` tab** in `MKT_SHEET_ID`, both reusing the
proven Loop B tail (read → dedupe → append → IF-not-dup → Gmail Sales). Workflows:

- `n8n-workflows/mkt-form-lead.json` — Google Form → Sheet → poll → leads. **No SMTP, no public URL.**
- `n8n-workflows/mkt-calcom-lead.json` — Cal.com `BOOKING_CREATED` webhook → leads.

Picking one: **Forms = capture info** (low friction, dev-testable now). **Cal.com = book a meeting**
(high intent, needs VPS + SMTP). Both run in parallel; `sourcePlatform` distinguishes them (`form` / `calcom`).

---

## A. Google Forms path (`mkt-form-lead`)

### Why Sheets Trigger, not a webhook
Google Forms cannot POST to an arbitrary webhook without Apps Script + a public n8n URL. Instead we let
Forms do what it does natively — write each response to a Sheet tab — and poll that tab. Zero Apps Script,
zero SMTP, works against `http://localhost:5678`.

### Setup
1. **Create the Form.** Fields (any order; the normalizer resolves by keyword, VI or EN):
   - Email (required) — Forms email-collection or a short-answer field with `email` in the title.
   - Name / Tên, Phone / SĐT, Message / Nhu cầu, Product / Sản phẩm (all optional).
2. **Link to the control-plane Sheet.** Form editor → **Responses** → Sheets icon → *Select existing
   spreadsheet* → `MKT_SHEET_ID`. Forms creates a tab (e.g. `Form Responses 1`). Optionally rename it
   `form_responses` — name doesn't matter, the **gid** does.
3. **Get the gid.** Open that tab, read `...edit#gid=<number>` from the URL.
4. **Env** (`n8n-local/.env` — the container reads that file, NOT `AgentPortal/.env`):
   ```
   MKT_FORM_RESPONSES_GID=<number>
   ```
   Then `docker compose up -d --force-recreate n8n` (a plain `docker restart` does NOT reload env_file).
5. **Credential.** The trigger needs `googleSheetsTriggerOAuth2Api` (distinct node type from the action
   `googleSheetsOAuth2Api`). In n8n create a cred named **"Marketing Google Sheets Trigger"**, same Google
   account (`auto.agent.solution@gmail.com`). The workflow references it by id `mkt-gsheets-trigger` — rebind
   to the real cred id on import (same patch pattern as the other MKT workflows).
6. **Import + activate.** Poll interval = every minute (`pollTimes` everyMinute). Activate the workflow.

### Behaviour
- New Form row → `rowAdded` fires → `Normalize form row` maps headers tolerantly → dedupe by email (30d) →
  append → Sales email (skipped on dup). Malformed/empty rows (no valid email) are dropped silently.
- **First-row caveat:** the Sheets Trigger registers a baseline on activation; rows that existed *before*
  activation never fire. Test by submitting a fresh Form response after the workflow is active.
- Latency: up to ~60s (poll interval). Fine for leads; tighten only if needed.

---

## B. Cal.com path (`mkt-calcom-lead`)

### Prereqs
- Cal.com self-hosted on the same VPS as n8n (own Postgres DB — do NOT share videofarm Postgres).
- SMTP creds for Cal.com booking emails (Gmail app password works for dev — see token deployment doc).
- Event type "DAIS Demo" with Google Meet connected.

### Webhook wiring
1. Cal.com → **Settings → Developer → Webhooks → New**.
2. Subscriber URL: `http://<n8n-host>:5678/webhook/mkt-calcom?s=<MKT_CALCOM_WEBHOOK_SECRET>`
   (self-host → private IP/host-gateway reachable from Cal.com container).
3. Event triggers: **`BOOKING_CREATED` only** (Cal.com bug #16344 makes MEETING_STARTED/ENDED flaky on self-host).
4. Env (`n8n-local/.env`): `MKT_CALCOM_WEBHOOK_SECRET=<random>` → force-recreate container.

### Why a query secret, not HMAC
Cal.com HMAC-signs the body (`x-cal-signature-256`), but the n8n task-runner sandbox
(`N8N_RUNNERS_ENABLED=true`) blocks `require('crypto')` — so the workflow can't recompute the signature.
The sandbox-safe equivalent is a shared secret in the URL query, constant-time compared (same `safeEq`
XOR trick as `mkt-lead-capture`). Cal.com preserves appended query params on delivery.

### Behaviour
- `BOOKING_CREATED` → verify `?s=` → parse attendee[0] + payload → dedupe by `calBookingUid` (survives
  Cal.com webhook retries) → append → Sales email.
- Meeting metadata (`startTime`, Meet URL, booking uid) is packed into `message` + `rawPayload`. The `leads`
  tab stays at its proven 8 columns — promote `meetingAt`/`meetUrl`/`calBookingUid`/`meetStatus` to real
  columns only when Cal.com is actually deployed (YAGNI until then).
- Non-`BOOKING_CREATED` events return 202 ignored. Bad secret → 401. Bad/missing email → 400.

---

## Shared notes
- Both append to `leads` gid `476128751` via the **"Marketing Google Sheets"** cred (`mkt-gsheets`).
- Dedupe windows: Forms = email+30d; Cal.com = booking-uid (exact) then email+30d fallback scoped to `calcom`.
- `MKT_SALES_EMAIL` notification via **"Marketing Gmail (Sales)"** cred — `onError: continueRegularOutput`
  so a Gmail hiccup never drops the lead row.
- Local test: submit a Form response (path A) or `curl -X POST '.../webhook/mkt-calcom?s=...'` with a
  sample Cal.com `BOOKING_CREATED` body (path B). Verify a `leads` row + Sales email.
