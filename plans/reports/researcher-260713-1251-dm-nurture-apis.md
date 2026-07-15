# DM Nurture Agent — Platform API Feasibility Report

**Date:** 2026-07-13  
**Scope:** WhatsApp, Zalo, Telegram, LinkedIn — programmatic 1:1 messaging to arbitrary leads/customers  
**Question:** Which platforms officially support cold-contact or nurture messaging via API?

---

## Summary Table

| Platform | Official API | Arbitrary Users | Opt-In Enforced | Verdict |
|----------|--------------|-----------------|-----------------|---------|
| **WhatsApp** | Cloud API (Meta) | Template-only | YES (strict) | 🟢 GREEN |
| **Zalo** | OA API + ZNS | ZNS only w/ consent | YES (explicit) | 🟡 YELLOW |
| **Telegram** | Bot API | NO | N/A | 🔴 RED |
| **LinkedIn** | None public | NO | N/A | 🔴 RED |

---

## 1. WhatsApp Cloud API

### Official API & Product Name
**WhatsApp Cloud API** (Meta for Developers, via Facebook Business Platform)  
Docs: https://developers.facebook.com/documentation/business-messaging/whatsapp/

### Can You Message Arbitrary Users?
**Partial YES** — only via **Template Messages (MTM, formerly HSM)**.
- Outside the 24-hour customer service window, template messages are the ONLY way to reach users.
- Standard (non-template) messages can only be sent within 24hr after user initiates contact.

### Opt-In & Prior-Contact Rules

**Active Consent (Feb 2026 update):**
- Businesses MUST obtain **explicit, active consent** before sending marketing templates.
- Pre-checked boxes, implied consent from ToS, or purchase-driven assumptions do NOT qualify.
- Consent mechanism must:
  - State your **business name** explicitly.
  - Disclose messages will arrive **via WhatsApp** (not generic "notifications").
  - List message types user will receive (marketing/transactional/both).
  - Include clear **unsubscribe/STOP** path.

**Message Categories & Limits:**
- **Marketing:** cold outreach templates; Meta caps ~2 per user per 24hr.
- **Utility:** order updates, receipts, account confirmations (higher limits, no hard cap disclosed).
- **Authentication:** login codes, 2FA (no messaging limits).
- Each category has separate templates and approval workflow.

**Marketing Category Specifics:**
- Requires customer to have opted in explicitly for marketing.
- Cannot use this for "nurture" without prior relationship unless user opted in for marketing specifically.

### Authentication & Onboarding
1. **Prerequisites:** Meta Business Account + WABA (WhatsApp Business Account) registration.
2. **Credentials:** Phone number verification + WABA token.
3. **OAuth/Tokens:** Long-lived access token (no refresh token needed for Cloud API).
4. **Template Approval:** Marketing templates submitted for human review (~24–48hr turnaround); some markets reject ambiguous/promotional content.

### Pricing & Rate Limits
**Cost Model (July 2025 → present):**
- Per-**delivered** template message (not per conversation or per 24hr window).
- Varies by template category (Marketing > Utility > Authentication typically).
- Varies by recipient country (UK ~$0.005/msg, India ~$0.002/msg; exact rates in CSV rate cards).
- Non-template messages during open conversation window: **free**.

**Rate Limits:**
- ~2 marketing templates per user per 24hr (Meta-enforced soft cap).
- No published hard API rate limit; practical ceiling ~1000 msg/sec per WABA.

### Ban Risk & Enforcement
**Risk Level:** LOW (if compliant).
- Official API, widely adopted, Meta actively monitors but enforcement is compliance-based (consent, template approval, category correctness).
- Violations: sending messages without consent, using wrong category, bulk marketing, misusing templates → account restrictions/disabling.
- Recovery possible with compliance audit.

### Verdict
🟢 **GREEN**  
Official, stable, widely used. Non-trivial consent compliance required but achievable. Cold-contact nurture is possible but requires **template pre-approval** + **explicit opt-in** (not implicit). Best for marketing nurture where user has provided phone + agreed to marketing messages.

---

## 2. Zalo Official Account API + ZNS

### Official APIs
Two distinct paths:
1. **Official Account (OA) API** — direct messaging to followers.
2. **Zalo Notification Service (ZNS)** — transactional templates to opted-in users by phone number.

Docs: https://developers.zalo.me/docs (primary OA), https://www.infobip.com/docs/zalo/compliance-guidelines (ZNS compliance)

### Can You Message Arbitrary Users?

**OA API:** NO — can only message users who have **followed your Official Account** or interacted with it.
- Attempting to message non-followers results in delivery failure.
- User must find and follow your OA explicitly or receive a QR/link.

**ZNS (Notification Service):** YES, but **only for transactional messages** to users who:
- Provided their **phone number** explicitly (e.g., on a website form).
- Received **advance notice** of messaging intent and purpose.
- Have given **explicit consent** to be contacted.
- DO NOT need to follow your OA.

### Opt-In & Prior-Contact Rules

**ZNS Compliance (Zalo's version of WhatsApp templates):**
- **Consent requirement:** Customer must consent + provide phone; business must notify in advance of messaging purpose/conditions.
- **Message content restrictions:**
  - NO promotional or advertising content.
  - NO marketing messages.
  - Must be **transactional only** (order confirmations, delivery updates, appointment reminders, OTP codes).
  - Must include transaction-specific variables (order #, amount, date, etc.).
- **Message limits:** One message per transaction only.
- **Template approval:** All ZNS templates must be pre-approved by Zalo team.

**OA Messaging:**
- Followers only (no cold outreach).
- No explicit per-message approval needed (unlike ZNS).
- But OA content must comply with Zalo's advertising policies.

### Authentication & Onboarding
**OA Path:**
1. Register Official Account at https://oa.zalo.me/ (Vietnam-focused, supports some intl markets).
2. Application approval by Zalo team (1–2 weeks typical).
3. Receive OA ID + access token (1-hour validity).
4. Refresh token (3-month validity) to renew access tokens.

**ZNS Path:**
1. Partner with a ZNS provider (Infobip, 8x8, Netcore, etc.) — Zalo does not expose ZNS directly to developers.
2. Or: build partnership directly with Zalo (longer, enterprise-only path).
3. Credentials: Partner API key + ZNS template IDs.

### Pricing & Rate Limits
**OA:** Free (no per-message cost disclosed; server-side rate limits not published but empirically ~100–500 msg/sec).

**ZNS:** Varies by provider:
- Infobip/8x8 typically $0.01–0.05 per message depending on region.
- Higher for certain countries.
- Bulk discounts available.

**Rate Limits:**
- One message per transaction (ZNS hard limit).
- OA: no hard rate limit published.

### Ban Risk & Enforcement
**Risk Level:** MEDIUM (ZNS) / LOW (OA).
- Non-compliance → account suspension or blocking from the channel.
- ZNS violations: sending without consent, promotional content, mass messaging → ban.
- OA violations: spam, misleading content → OA restricted.
- Recovery: requires contacting Zalo support and compliance review.

### Verdict
🟡 **YELLOW**  
**ZNS works for transactional nurture** (order updates, appointment reminders, account notifications) with explicit prior consent. OA is for followers only — not viable for cold contact. ZNS requires template pre-approval + explicit consent + transaction binding. **Vietnam-centric** (regulatory + market); adoption outside VN is lower. No cold marketing via ZNS (by design).

---

## 3. Telegram Bot API

### Official API & Product Name
**Telegram Bot API** (open, public standard)  
Docs: https://core.telegram.org/bots/api

### Can You Message Arbitrary Users?
**NO — hard technical restriction.**
- Bots CANNOT initiate conversations.
- User must **/start** the bot first or add it to a group.
- This is enforced at API level — `sendMessage` will fail if bot has no prior message history with the user.
- By design: Telegram prioritizes user-driven opt-in over business-driven outreach.

**Alternative Path (High Risk):** MTProto / Userbot
- Use Telegram's lower-level MTProto protocol + user account (not bot) to send raw messages.
- Technically possible but **violates Telegram ToS** explicitly.
- Telegram actively detects automation: timing precision, behavioral anomalies → ban.
- Detection methods: session activity rhythm analysis, VoIP number detection, device fingerprinting.
- Ban consequences: permanent account suspension.

### Auth & Onboarding
**Bot Path (Official):**
1. Message **@BotFather** on Telegram.
2. `/newbot` → receive unique token (e.g., `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`).
3. No additional onboarding, no OAuth.

**Userbot Path (Unofficial/ToS-violating):**
- Phone number + app ID + app hash (from https://my.telegram.org/apps).
- Requires MTProto client library (Telethon, Pyrogram, etc.).
- Simple onboarding but **enforcement risk severe**.

### Pricing & Rate Limits
**Official Bot API:**
- Free tier.
- Rate limit: ~30 messages/sec per bot; exceeding → 429 (Too Many Requests).
- Soft throttling after 30/sec; hard failure if sustained.

**Userbot (if used):**
- Free but account ban risk → effective cost = **account loss**.

### Ban Risk & Enforcement
**Risk Level (Official Bot):** LOW (for opt-in use).  
**Risk Level (Userbot/MTProto):** EXTREME.

**Official Bot:**
- Safe if users /start first.
- Spamming unsolicited messages → account restricted (not banned, but limited).

**Userbot:**
- Telegram's 2026 enforcement is behavioral, not keyword-based.
- Common ban triggers: bulk cold DMs, mechanical timing, VoIP numbers, mass reports, automation-like patterns (uniform intervals, no micro-delays, no random pauses).
- Detection: Contributor Quality Score algorithm flags timing precision vs. human behavior.
- Consequence: permanent account ban (no recovery).
- Banned examples: mass-message bots, scraping automation, connection spam.

### Verdict
🔴 **RED**  
**Not viable for cold-contact nurture.** Official Bot API requires user /start first — no outbound cold-messaging capability. MTProto/userbot workaround technically possible but explicitly ToS-violating and high ban risk (permanent suspension). Use Telegram only for opt-in bot interactions (users message you first).

---

## 4. LinkedIn Messaging API

### Official API & Product Name
**No public Messaging API exists.**  
LinkedIn offers a **Pages Messaging API** for Company Pages only, but:
- Requires 4–12 week partnership onboarding with LinkedIn's business team.
- Limited to approved enterprise partners (no public availability).
- Even with Pages API, user DM automation is not exposed.

Docs (partial): https://learn.microsoft.com/en-us/linkedin/marketing/

### Can You Message Arbitrary Users?
**NO — no official public API.**

Users can only be messaged if:
- You are a direct connection (1st-degree).
- User has explicitly opted in to receive messages (rare, no bulk opt-in mechanism).
- You are using **LinkedIn Sales Navigator** (premium feature, message templates, but still requires existing connection or account tier).

**Third-Party Alternatives (High Ban Risk):**
- **ConnectSafely, Unipile, SocialAPI.ai** offer unified messaging APIs that claim LinkedIn support.
- These use **unofficial scraping or account automation** (violation of LinkedIn ToS).
- LinkedIn explicitly bans these tools; accounts using them face:
  - Detection within 48 hours (2026 enforcement update).
  - Account suspension (not warning) on first violation.
  - Permanent blacklist.

**Recent Enforcement Wave (2025–2026):**
- LinkedIn banned **23.5M bot sessions** last quarter.
- Permanently removed: Apollo.io, Seamless.ai, Evaboot, LGM, HeyReach.
- LinkedIn **sued Proxycurl (Nubela)** 2025 → their LinkedIn API shut down entirely.
- Detection mechanisms: behavioral biometrics, activity rhythm analysis, mathematical precision detection.

### Auth & Onboarding
**Official API (if approved):**
- OAuth 2.0 via LinkedIn developer app.
- Scopes: messaging-related scopes NOT publicly documented (likely restricted).
- Onboarding: requires partnership application, business justification, 4–12 week review.

**Third-Party APIs:**
- API key from provider.
- OnBoarding: sign up for service.
- **Enforcement risk:** High.

### Pricing & Rate Limits
**Official API:** No public rate limit (enterprise-only, custom SLAs).

**Third-Party APIs:** $10–100/month depending on message volume.

**Best Practice (if official not available):**
- Cold messaging cap: 30–50 first-degree new connections per day.
- Follow-up messages: 100–150 per day max.
- (These are conservative to avoid detection; LinkedIn's actual algorithm is proprietary.)

### Ban Risk & Enforcement
**Risk Level (Official API):** LOW (if approved and used correctly).  
**Risk Level (Third-Party Tools):** EXTREME.

**Third-Party Violations:**
- Using tools that automate connection requests, messaging, or profile scraping → immediate detection (48–72hr).
- Consequences: full account suspension (not temporary), ban from platform, possible legal action (LinkedIn sued Proxycurl).
- No recovery process published; appeals ignored.
- User accounts banned from third-party automation: reputation damage, loss of network.

### Verdict
🔴 **RED**  
**No viable official path.** Third-party automation tools are aggressively banned; LinkedIn enforcement is severe and rapid (first-time ban). No public messaging API. Sales Navigator is the only semi-official path but still limited to connections + requires Premium ($$$). **Not recommended for cold-contact nurture.**

---

## Architectural Recommendations for Nurture Agent Nodes

### If You Have Existing Opt-In User Base (Preferred Path)
1. **WhatsApp (primary):** Best compliance + scale. Requires prior opt-in + explicit consent for marketing.
2. **Zalo ZNS (secondary, VN-market):** For transactional (order/appointment) nurture; requires explicit consent.
3. **Telegram (tertiary, warm):** Only for users who have already /start'd bot (opt-in by action).

### If You Want Cold Outreach (Not Recommended)
- **None of these platforms officially support it.**
- WhatsApp + ZNS + Telegram all require prior user engagement.
- LinkedIn rejects it at platform level + aggressively enforces.

### Risk-Complexity Trade-Off
| Platform | Setup Effort | Compliance Burden | Ban Risk | Cold Outreach? |
|----------|--------------|-------------------|----------|----------------|
| WhatsApp | Medium | High | Low | Template-only (not cold) |
| Zalo ZNS | Medium | Very High | Medium | No (transactional) |
| Telegram | Low | None (if opt-in) | Low (opt-in) / Extreme (userbot) | No |
| LinkedIn | Very High | N/A (no API) | Extreme | No |

---

## Unresolved Questions

1. **WhatsApp template message ROI:** What conversion rates / engagement metrics should we expect for marketing templates? (Meta doesn't publish; would need pilot with actual campaigns.)
2. **Zalo OA growth loop:** Can automated interactions (e.g., chatbot follow-up to QR scan → then send ZNS) accelerate OA follower adoption? (Not tested in report scope.)
3. **Telegram for repeat customers:** If we have Telegram user IDs of repeat customers who've /start'd, can we safely send 1–2 messages per week without ban? (Likely safe but no published SLA.)
4. **LinkedIn LinkedIn Sales Navigator API:** Does Sales Navigator expose messaging API for approved partners? (Not researched; would require direct contact with LinkedIn partner team.)
5. **Zalo OA messaging during live interaction:** Can an OA send a follow-up message outside conversation window if user initiated contact recently? (Zalo docs unclear on this edge case.)

---

## Sources

- [Meta WhatsApp Cloud API Docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/)
- [Meta WhatsApp Template Overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)
- [Meta WhatsApp Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Meta WhatsApp Opt-In Guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in)
- [Infobip Zalo Compliance Guidelines](https://www.infobip.com/docs/zalo/compliance-guidelines)
- [Zalo For Developers — Official Account API](https://developers.zalo.me/docs/api/official-account-api-230)
- [Telegram Bot API Documentation](https://core.telegram.org/bots/api)
- [Telegram Bots FAQ](https://core.telegram.org/bots/faq)
- [LinkedIn Marketing API (Microsoft Learn)](https://learn.microsoft.com/en-us/linkedin/marketing/)
- [Is LinkedIn Automation Safe in 2026? (ConnectSafely)](https://connectsafely.ai/articles/is-linkedin-automation-safe-tos-scraping-guide-2026)
- [LinkedIn Scraping Bans 2026 (Nubela/Proxycurl)](https://nubela.co/blog/is-scraping-linkedin-legal-in-2026/)
- [Telegram MTProto Proxy & Ban Guide 2026 (Telega)](https://telega.to/blog/telegram-proxy-setup-guide-2026-socks5-mtproto)
