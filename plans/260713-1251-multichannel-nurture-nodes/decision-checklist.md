# Decision Checklist — gates before implementation

Answer these to lock build order. Each row: the decision → options → what it unblocks/blocks → my recommendation. `[ ]` = undecided.

## Provisioning gates (block real sends)

- [ ] **D1 · WhatsApp Business Account + verified number**
  - Q: Do we have a Meta Business + WABA + verified phone number, or must we provision one?
  - Options: (a) already have it → WhatsApp node can go real; (b) none → provision (days–weeks: business verification + number + template approval); (c) defer WhatsApp entirely.
  - Unblocks: WhatsApp path in Phase 01. Blocks nothing else.
  - **Rec:** if not already provisioned, **defer WhatsApp**, ship Telegram first (D5). Start provisioning in parallel — it's the long pole.

- [ ] **D2 · X API tier**
  - Q: What's our current X/Twitter API access — Free, Basic ($200/mo), Pro, or none?
  - Options: (a) Free → no reply/mention writes AND comment capture returns `[]`; (b) Basic+ → both work.
  - Unblocks: X greeting (Phase 02) **and** X comment capture (Phase 03) — one tier gates both.
  - **Rec:** confirm tier before wiring X into either phase. If Free, **flag-gate X off** in both phases (`ENABLE_X_LEAD_CAPTURE=false`, X greeting adapter returns `unsupported`) and skip until a paid tier is justified.

- [ ] **D3 · Zalo ZNS — now or defer**
  - Q: Is the audience VN-heavy enough to justify OA registration + ZNS template approval now?
  - Options: (a) yes → include Zalo in Phase 01; (b) defer behind `ENABLE_ZALO` flag.
  - Unblocks: Zalo channel in the DM node.
  - **Rec:** **defer** (flag-gated stub already planned). Revisit when VN volume is real. YAGNI.

## Product/UX gate (blocks nurture usefulness)

- [ ] **D4 · Opt-in capture UX**
  - Q: How does a lead *become* WhatsApp/Telegram-reachable in our funnel? (Telegram = they `/start` our bot; WhatsApp = explicit consent + we hold their number.)
  - Options: (a) lead-form checkbox + channel handle field; (b) Telegram deep-link CTA (`t.me/bot?start=<leadId>`) on posts/emails; (c) both.
  - Unblocks: makes captured handle-only leads (Phase 03) actionable by Phase 01. Without this, DM nodes have no compliant recipients.
  - **Rec:** **(b) Telegram deep-link first** — zero platform cost, cleanest opt-in proof, links capture→nurture end-to-end.

## Infra gate (blocks webhook upgrade only)

- [ ] **D5 · Meta comment webhooks — now or keep polling**
  - Q: Do we stand up a public callback URL + pass Meta app review for `feed`/`comments`/`mentions` fields, or keep the 30-min poller?
  - Options: (a) webhooks (real-time, free, needs public URL + app review); (b) stay on poller (works today, no infra).
  - Unblocks: real-time FB/IG/Threads capture. Poller is the no-infra fallback regardless.
  - **Rec:** **keep poller for MVP**, do webhooks as a fast-follow once a public URL exists. Not on the critical path.

## Resulting build order (if recommendations taken)
1. **Phase 01 — Telegram only** (buildable today, D5-independent) + opt-in deep-link (D4b).
2. **Phase 02 — Threads + FB/IG mention-greeting** (X held on D2); +X when tier confirmed.
3. **Phase 03 — harden Threads fetcher + handle-only lead model**; Meta webhooks as fast-follow (D5); X capture flag-gated on D2.
4. **WhatsApp + Zalo** land when D1 / D3 clear.

## Sign-off
- [ ] Decisions D1–D5 recorded → update `plan.md` phase statuses and start Phase 01.
