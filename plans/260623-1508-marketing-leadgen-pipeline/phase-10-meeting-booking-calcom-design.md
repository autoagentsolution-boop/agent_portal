# Phase 10 — Meeting Booking via Cal.com (DESIGN ONLY)

**Context:** [plan.md](plan.md) · extends Loop B (lead capture). **Priority:** P2 (after Phase 1 live).
**Status:** design-only. **Decisions locked:** Cal.com self-host + Google Calendar + Google Meet +
**MVP = Cal.com ONLY** (replaces Google Form for the meeting path; every lead books a call).

> **Naming:** "calendar" elsewhere in this plan = the Google Sheet **posting** schedule tab. This phase's
> calendar = the **booking calendar** (Google Calendar free/busy). Different things — do not conflate.

## What the user wants

Lead submits → system checks availability → notifies user with the chosen time → user confirms → meeting
invite sent to the lead. This is a **booking + host-approval** flow, asynchronous (confirm happens minutes/
hours later, not within the webhook response window).

## Why Cal.com (not custom Form + Wait node)

Cal.com's **"requires confirmation"** event type natively IS this flow:
- Lead picks a **genuinely free** slot (picker shows real availability — a plain Google Form cannot).
- Booking goes **pending**; the slot is tentatively held on the host's Google Calendar.
- Host gets a Confirm/Reject notification.
- On **confirm**, Cal.com auto-creates the Google Calendar event + **Meet link** + emails the invite to the lead.

Custom Form + Wait-node would reinvent availability + confirm + Meet creation, and the Form can't see busy
slots (lead could pick an occupied time). Cal.com self-host fits the existing self-host posture.

## Architecture

```
Post CTA → Cal.com booking page (event type = "requires confirmation")
  → Lead picks free slot + fills name/email/product (Cal.com booking questions)
  → Cal.com: booking PENDING (slot held on host Google Calendar)
  → webhook BOOKING_CREATED → n8n (mkt-lead-capture, extended OR a new mkt-booking workflow):
        • append `leads` tab: status=pending_meeting, meetingAt, calBookingUid
        • Gmail to Sales/host: "Lead <name> booked <startTime>, confirm in Cal.com"
  → HOST confirms in Cal.com (1 click)  ← native, no n8n needed
        • Cal.com creates Google Calendar event + Meet link + sends invite to lead
  → (optional) webhook BOOKING_CONFIRMED → n8n: update `leads` row status=confirmed, meetUrl
  → (optional) webhook BOOKING_CANCELLED/REJECTED → n8n: status=cancelled
```

n8n does **less** than the custom path: it logs + notifies. Cal.com owns availability, confirm, Meet, invite.

## Cal.com → n8n integration

- Cal.com Settings → Webhooks → add subscriber URL = n8n webhook (`/webhook/mkt-booking`), shared secret.
- Subscribe to: `BOOKING_CREATED` (pending), `BOOKING_CONFIRMED`, `BOOKING_CANCELLED`, `BOOKING_REJECTED`.
- Payload (verify exact fields at build): `payload.uid`, `payload.startTime`, `payload.endTime`,
  `payload.attendees[].{name,email}`, `payload.responses.*` (custom questions → product/platform attribution),
  `payload.organizer`, and the Meet link under `payload.location` / `payload.videoCallData` on confirmed.
- Connect Cal.com → Google Calendar (host account) so free/busy + event creation + Meet work.

## `leads` tab — added columns (extends phase-01)

| Col | Field | Notes |
|-----|-------|-------|
| ... | (existing) | receivedAt, name, email, … |
| + | `meetingAt` | booked slot start (from BOOKING_CREATED) |
| + | `calBookingUid` | Cal.com booking id (idempotency + cross-event matching) |
| + | `meetStatus` | `pending_meeting → confirmed → cancelled` |
| + | `meetUrl` | Google Meet link (populated on BOOKING_CONFIRMED) |

## Decisions locked

1. **Cal.com ONLY for MVP** (resolved 2026-06-23). Cal.com replaces Google Form for the meeting path —
   every lead books a call via the Cal.com page (name/email/product captured as booking questions). Post CTA
   → Cal.com link. Google Form (phase-04) is NOT used in the MVP booking flow; keep it parked for a possible
   later "low-intent info capture" second CTA, not built now.
2. **Confirm UX = Cal.com native** (UI/email). Zero n8n work; native confirm already triggers Meet + invite.

## Open questions

1. **Pending-hold expiry** — Cal.com can auto-expire unconfirmed bookings; set a sensible window (e.g. 24h)
   so held slots free up if the host doesn't act. **Needs user pick at build.**

## Risks

| Risk | L×I | Mitigation |
|------|-----|------------|
| Cal.com self-host adds an ops surface | M×M | Docker, same posture as n8n; or use Cal.com cloud free tier to start |
| Double-handling: n8n + Cal.com both touch lead | L×M | Cal.com owns scheduling; n8n is read/notify only on booking events. No write-back to Cal.com. |
| Webhook payload drift across Cal.com versions | M×M | Pin Cal.com version; verify payload fields at build; log rawPayload |
| Host forgets to confirm → lead waits | M×M | Pending-hold expiry + n8n reminder if status=pending_meeting > N hours |

## Why design-only / not now
- Cal.com self-host is its own setup (Docker + Google Calendar OAuth + event-type config).
- Phase 1 posting + basic lead capture must run first; this layers booking onto a proven Loop B.
- Decision #1 (Form coexist?) should settle after seeing real lead intent in Phase 1.

## Next Steps
Build after Phase 1 live. Needs: Cal.com instance, Google Calendar connect, "requires confirmation" event
type, webhook → n8n (`mkt-booking` or extend `mkt-lead-capture`), `leads` tab column additions.
