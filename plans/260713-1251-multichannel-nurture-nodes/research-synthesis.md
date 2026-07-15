# Research Synthesis — Multi-channel Nurture Feasibility

Sources: `plans/reports/researcher-260713-1251-dm-nurture-apis.md`, `plans/reports/researcher-260713-1251-wall-post-and-comment-capture-apis.md`, plus codebase scan (2026-07-13).

## 1. DM nurture channels

| Channel | Verdict | Official API | Can DM a lead who hasn't messaged us? | Auth | Cost/limit |
|---|---|---|---|---|---|
| WhatsApp | 🟢 GREEN | Cloud API (Business Platform) | Only via approved **template (HSM)** + opt-in; free-form only in 24h window | Meta Business + WABA + phone number, permanent token | Per-message, category-priced (mkt/utility/auth) |
| Telegram | 🟡 YELLOW | Bot API | **No** — user must `/start` bot first; then unlimited | BotFather token | Free; ~30 msg/s |
| Zalo | 🟡 YELLOW | OA API + **ZNS** | ZNS templates to opted-in phones (transactional); OA free-form = followers only | OA registration, ZNS template approval | VN-market, per-ZNS pricing |
| LinkedIn DM | 🔴 RED | none public | No | — | Automation = account ban; do not build |

**Design consequence:** all three buildable channels reduce to "send a (templated) message to a contact we already have consent/prior-contact for." One abstraction: `MessagingChannel` + `DmContact` (opt-in state) + per-channel adapter. Telegram opt-in = they started the bot; WhatsApp opt-in = consent + template; Zalo opt-in = ZNS-eligible phone.

## 2. Person-directed "wall greeting"

Literal wall posting: **impossible everywhere.** Buildable reframe = post on OUR timeline that references them.

| Channel | Verdict | Buildable action | Constraint |
|---|---|---|---|
| X | 🟡 | create-tweet with @mention, or reply to their post | write tier (Basic+), Mar-2026 prior-engagement rule for replies |
| Threads | 🟡 | create post w/ @mention, reply to their thread | Threads API create/reply supported |
| Facebook | 🔴 wall / 🟡 mention | Page post tagging them, or comment on their post | no personal-wall write since 2018 |
| Instagram | 🔴 wall / 🟡 mention | @mention in caption, reply to their comment, DM in 24h window | no profile write |

**Design consequence:** a `greeting_agent` node emits a *public mention/reply* through the EXISTING social adapters, but needs **new adapter actions** (`mention`/`reply`) distinct from `publish`. Reuse tokens/connection-resolver as-is (all 4 are already `SocialPlatform`s).

## 3. Comment→lead capture (extend beyond Facebook)

**Already implemented for all 5** (`comment-poller.ts` `COMMENTABLE = ['facebook','instagram','threads','linkedin','x']`, 30-min poll). Gaps:

| Platform | Now | Verdict to improve | Action |
|---|---|---|---|
| Facebook | poll, mature | 🟢 → webhook | move to Page `feed` webhook (real-time, free) |
| Instagram | poll, mature | 🟢 → webhook | IG `comments`/`mentions` webhook |
| Threads | poll, **live-untested** | 🟢 → webhook + verify | Threads replies webhook + real-token test |
| X | poll, tier-gated | 🟡 | keep poll behind paid-tier flag; free tier returns `[]` |
| LinkedIn | poll, unverified | 🔴 | partner-gated Community Mgmt API; likely leave as best-effort |

**Hard limit:** no comment API returns email/phone — only handle/id/name. Current capture already only creates a lead when the commenter *typed* an email the keyword parser matched. Non-FB "leads" are otherwise handle-only; that's expected, not a bug.

## Unresolved questions (carried from reports)
1. Do we have a WhatsApp Business Account + verified number, or is that a prerequisite to provision? (blocks WhatsApp node)
2. Is the target audience VN-heavy enough to justify Zalo ZNS approval overhead now, or defer?
3. Current X API tier — any write/read access, or free-only? (gates both greeting + comment capture on X)
4. Acceptable opt-in capture UX (how does a lead become WhatsApp/Telegram-reachable in our funnel)?
5. Webhook migration for Meta comments — infra for public callback URL + app review scopes.
