# Wall Greeting & Comments Capture: Platform API Feasibility Report

**Date:** 2026-07-13  
**Scope:** X (Twitter), Threads, Facebook, Instagram, LinkedIn  
**Analyst Note:** This report prioritizes official API docs over tutorials. All research dated 2026 Q2/Q3.

---

## PART A: WALL GREETING — POST CONTENT ON ANOTHER USER'S PROFILE/TIMELINE

**Verdict: Nearly all platforms prohibit this via API.** Modern social platforms restrict wall-posting to Pages (not personal profiles) or offer no direct wall-post support. Workarounds exist (reply/mention), but are constrained.

---

### X (Twitter/Premium)

**Direct Wall Post:** NO

**Official Restriction:**  
- Cannot programmatically post to another user's profile. X does not expose a "user timeline write" endpoint.

**Person-Directed Greeting Alternatives:**

1. **Reply to a Public Tweet** (Official API)
   - `POST /2/tweets` with `reply_settings` set to respond to an existing post
   - **Constraint (NEW March 2026):** Programmatic replies now restricted unless original author @mentions you first OR quotes your post. Applies to Free/Basic/Pro/Pay-Per-Use tiers. **Enterprise is exempt.**
   - Means: Cannot auto-reply to random posts; only to posts where they've already engaged with you.
   - Endpoint: https://docs.x.com/x-api/posts/create-manage-tweets

2. **@Mention in Reply** (Official API)
   - Post a reply that includes their @handle.
   - **Constraint (NEW March 2026):** Cannot @mention users in **standalone posts**, only in replies to conversations where they're already participants.
   - Still allows "Hey @username, thanks for…" in a reply thread.
   - Endpoint: POST /2/tweets (in reply mode)

3. **Quote Tweet** (Official API)
   - Quote their post with your message.
   - No programmatic restriction noted for quotes.
   - Endpoint: POST /2/tweets with `quote_tweet_id`

**Auth/Scopes Required:**
- OAuth 1.0a User Context or OAuth 2.0 Authorization Code with PKCE
- `tweet.write` scope
- Access tier: Pay-Per-Use ($0.015/post, $0.20 if URL included; capped 2M reads/month). Enterprise: $42K+/month.

**Data Available on Replier:** username, user_id, created_at, text. No email/phone exposed.

**Verdict: YELLOW** — Can reply + mention if they've already interacted with you; cannot cold-start a wall greeting via API. Post to them requires prior engagement or quote-tweet.

**Sources:**
- [X API v2 Create Tweets](https://docs.x.com/x-api/posts/create-manage-tweets)
- [X Developers Community: Reply Restrictions](https://devcommunity.x.com/t/restricting-programmatic-replies-does-this-affect-replying-to-itself/257955)
- [X API Pricing 2026](https://docs.x.com/x-api/introduction)

---

### Threads

**Direct Wall Post:** NO

**Official Restriction:**  
- Threads API allows publishing to **your own account only** or registered tester accounts during app development. No API endpoint exists to post to another user's timeline or wall.
- Official docs state: "Threads API is designed primarily for publishing to your own account."

**Person-Directed Greeting Alternatives:**

1. **Post a Reply** (Official API)
   - Create a reply to their post using `POST /{threads-user-id}/threads` with `reply_to_id` parameter.
   - **Constraint:** You can only reply to public posts where your access tokens allow engagement. No restriction explicitly stated, but reply-ability depends on platform's visibility rules (e.g., public/followers-only).
   - Endpoint: https://developers.facebook.com/docs/threads/reply-management/

2. **@Mention in Reply or Post** (Official API)
   - Threads API supports @mentions in text.
   - Webhook field: `mentions` tracks when you're mentioned.
   - As of Jan 26, 2026 update, @mentions now return `is_verified` and `profile_picture_url`.
   - **Constraint:** Only within posts your account creates; cannot @mention in someone else's context.
   - Endpoint: POST with text containing @-mentions

**Auth/Scopes Required:**
- `threads_basic`, `threads_content_publish`, `threads_read_replies`, `threads_manage_replies`
- All scopes require Meta app review.

**Data Available on Replier:** username, user_id, is_verified, profile_picture_url (as of 2026-01-26). No email/phone.

**Verdict: YELLOW** — Can reply to their post; cannot post to their wall. @Mention support in your own replies only. Good for engagement, not for direct wall greeting.

**Sources:**
- [Meta Threads API Documentation](https://developers.facebook.com/docs/threads/)
- [Threads Reply Management](https://developers.facebook.com/docs/threads/reply-management/)
- [Threads Webhooks Jan 26, 2026 Update](https://www.threads.com/@threadsapi.changelog/post/DT_hJOrDB61)

---

### Facebook

**Direct Wall Post (Personal Profile):** NO — Permanently Removed

**Official Restriction:**  
- Facebook removed the `publish_actions` permission (used for personal profile posting) in Graph API v3.0 (2018). This was a Cambridge Analytica-driven policy change that remains in force.
- Personal profiles cannot receive programmatic posts via API.

**Person-Directed Greeting Alternatives:**

1. **Comment on Their Post** (Graph API)
   - POST `/{post-id}/comments` with message.
   - Requires `pages_read_engagement` + `pages_manage_metadata` (for Page comments) or `user_managed_friend_list` (limited scope for personal).
   - **Constraint:** Can comment on public posts; cannot directly post to their wall.
   - Endpoint: https://developers.facebook.com/docs/graph-api/reference/post/comments

2. **Send Them a Private Message** (Messaging API)
   - Use Customer Chat or Messaging API if they've opted into business messages.
   - Requires prior customer relationship (they messaged your Page first).
   - Endpoint: POST /me/messages (for Page context)

3. **Tag/Mention in Your Page Post** (Graph API)
   - Post to your own Page and tag them as a mention.
   - Use the `message` field + `name_tags` parameter.
   - Example: `POST /{page-id}/feed` with `message` + `name_tags=[{id: user_id}]`
   - Endpoint: https://developers.facebook.com/docs/graph-api/reference/page/feed

**Auth/Scopes Required:**
- `pages_manage_posts` + dependencies for Page posting
- `pages_read_engagement` for reading/commenting
- Requires app review, Business Verification, and Page token.
- Current API version: v25.0 (Feb 2026)

**Data Available on Commenter:** id, name (public profile only). No email/phone.

**Verdict: RED** — Cannot post to personal walls. Commenting + tagging on your own posts are workarounds, not direct wall greeting.

**Sources:**
- [Meta Graph API Reference: User Feed](https://developers.facebook.com/docs/graph-api/reference/user/feed/)
- [Facebook API v25.0 Changelog (Feb 2026)](https://developers.facebook.com/docs/graph-api/)
- [Graph API Posting Guide](https://postproxy.dev/blog/facebook-graph-api-posting-guide/)

---

### Instagram

**Direct Wall Post (Business Account):** NO

**Official Restriction:**  
- Instagram Graph API allows posting to **your own Business or Creator account only**. No "post to another user's profile" endpoint exists.
- Personal accounts have no API access.

**Person-Directed Greeting Alternatives:**

1. **Reply to a Comment on Your Post** (Graph API)
   - POST `/{comment-id}/replies` with your reply message.
   - Only available on comments on **your own media**.
   - Endpoint: https://developers.facebook.com/docs/instagram-platform/reference/comments

2. **Direct Message (Instagram Messaging)** (Graph API)
   - POST `/me/messages` to send a DM via Instagram.
   - **Constraint:** Can only message users who've messaged you first (24h window) or opted into business messaging.
   - Endpoint: https://developers.facebook.com/docs/instagram-api/reference/ig-user/messages

3. **@Mention in Caption** (Not via API)
   - You can manually @mention when creating a post via API (text field allows @-tags in caption).
   - No programmatic "mention" action to another user's account.

**Auth/Scopes Required:**
- `instagram_business_basic` + `instagram_business_content_publish`
- `instagram_business_manage_comments`
- Requires Business or Creator account (not personal).
- Current API version: v25.0 (Feb 2026)

**Data Available on Commenter:** id, username (limited). No email/phone.

**Verdict: RED** — Cannot post to another user's profile/wall. Can reply to comments on your own posts only. DMs require prior engagement.

**Sources:**
- [Meta Instagram Platform Documentation](https://developers.facebook.com/docs/instagram-platform)
- [Instagram Graph API Comments Reference](https://developers.facebook.com/docs/instagram-platform/reference/comments)

---

## PART B: HARVEST COMMENTS/REPLIES/MENTIONS AS LEADS

**Goal:** Capture commenter/replier user IDs, handles, and metadata as lead candidates.

---

### Facebook (Reference — Existing Mechanism)

**How to Read Comments:**

- **Webhooks (Event-Driven):** Subscribe to Page webhooks for `feed` field. When someone comments, webhook sends event with `field: "feed"`, `value.item: "comment"`, `value.verb: "add"`.
- **Polling (REST):** GET `/{page-id}/feed?fields=comments` to fetch comments periodically.
- **Current Version:** Graph API v25.0 (Feb 2026). Metadata introspection (`metadata=1`) removed May 19, 2026; use Graph Explorer for discovery.

**Data per Commenter:**
- id, name, profile picture, message text
- No email/phone exposed
- Can expand to get fuller profile if they're a public user

**Verdict: GREEN** — Webhooks fully supported, minimal polling overhead. Long-established, reliable mechanism.

**Sources:**
- [Facebook Graph API Webhooks Reference: Page](https://developers.facebook.com/docs/graph-api/webhooks/reference/page/)
- [Building Real-Time Facebook Comment Listener (Feb 2026)](https://medium.com/emojot-engineering/building-a-real-time-facebook-page-comment-listener-using-webhooks-node-js-graph-api-17dad90e992e)

---

### Instagram

**How to Read Comments:**

1. **Webhooks (Event-Driven):** Subscribe to Instagram webhooks for `comments` field (comments on your media) and `mentions` field (when you're @mentioned).
   - Webhook fires when: comment added, you're @mentioned in caption or comment.
   - Payload includes: commenter user id, username, text, is_verified, profile_picture_url.
   - As of 2026, webhook returns full commenter profile info.

2. **Polling (REST):** GET `/{ig-media-id}/comments` to fetch comments for a specific post.
   - Rate limit: 750 calls/hour per Instagram professional account (2026).
   - Endpoint: https://developers.facebook.com/docs/instagram-platform/reference/comments

**Data per Commenter:**
- id, username, text, is_verified, profile_picture_url, timestamp
- No email/phone

**Webhook Setup:**
- POST HTTPS endpoint for Meta signature verification + event processing
- Subscribe via app dashboard to `comments` and `mentions` topics
- Event-driven = much lower API overhead than polling

**Verdict: GREEN** — Webhooks for comments & mentions fully supported, good data coverage. No rate-limit concerns with webhooks; polling costs 1 call per post per poll.

**Sources:**
- [Instagram Webhooks Reference](https://developers.facebook.com/docs/instagram-platform/webhooks)
- [Set Up Instagram Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-instagram/)

---

### X (Twitter)

**How to Read Mentions/Replies:**

1. **User Mention Timeline (REST Polling):** GET `/2/users/{id}/mentions` returns up to 800 most-recent mentions of your account.
   - Reverse-chronological, includes replies to your posts + @mentions in other posts.
   - Endpoint: https://docs.x.com/x-api/posts/timelines/user-mention-quickstart

2. **Filtered Stream (Real-Time):** POST to `/2/tweets/search/stream` with rules (e.g., `@yourhandle`).
   - Requires keyword/user rules to define what to capture.
   - Pushes real-time events to your webhook (you host the endpoint).
   - **Cost & Access:** Filtered stream NOT available on Free/Basic. Minimum $5K/month (Pro tier) or pay-per-use ($0.005/read).
   - **Catch:** High-velocity stream can exhaust 2M reads/month cap mid-month, triggering $0.005 overage per additional read.

**Data per Commenter:**
- author_id, username, created_at, text, public_metrics
- Expansion fields available: author details, media info, entities
- **No email/phone exposed**

**Rate Limits & Costs:**
- REST mention timeline: 300 requests/15min (Free/Basic) to higher on Pro
- Filtered stream: 50 concurrent rules on Basic; 1000+ on Pro
- Pay-per-use default for new developers (as of Feb 2026)

**Verdict: YELLOW** — Can read mentions via REST or streamed events. High cost for real-time streaming ($5K/mo minimum or significant pay-per-use overage risk). REST polling is cheaper but returns only 800 most-recent. No webhook alternative; you must poll or stream.

**Sources:**
- [X API User Mention Timeline](https://docs.x.com/x-api/posts/timelines/user-mention-quickstart)
- [X Filtered Stream (v2)](https://docs.x.com/x-api/tweets/filtered-stream/integrate/build-a-rule)
- [X API Pricing 2026](https://postproxy.dev/blog/x-api-pricing-2026/)

---

### Threads

**How to Read Replies/Mentions:**

1. **Webhooks (Event-Driven):** Subscribe to `replies` field (replies on your posts) and `mentions` field (when you're @mentioned on any public media).
   - Webhook payload includes: reply author id, username, text, is_verified, profile_picture_url.
   - As of Jan 26, 2026: webhooks now return `is_verified` and `profile_picture_url`.

2. **REST Polling:** GET `/{threads-user-id}/threads` to fetch your posts, then GET `/{post-id}/replies` to fetch replies.
   - No dedicated "mentions" endpoint; relies on keyword search or manual parsing of replies.

**Data per Replier:**
- id, username, is_verified, profile_picture_url, text, created timestamp
- No email/phone

**Webhook Setup:**
- Same as Instagram (Meta webhooks infrastructure).
- Subscribe to replies + mentions fields via app dashboard.

**Verdict: GREEN** — Webhooks for replies & mentions fully supported. Webhook data includes verification status + profile picture. Good event-driven alternative to polling.

**Sources:**
- [Threads API Webhooks](https://developers.facebook.com/docs/threads/webhooks/)
- [Threads Reply Management](https://developers.facebook.com/docs/threads/reply-management/)

---

### LinkedIn

**How to Read Comments on Organization Posts:**

1. **Community Management API (Restricted):** GET `/socialActions/{activity-urn}/comments` to fetch comments on posts your organization published.
   - **Constraint (CRITICAL):** Only works for posts **you own**. Cannot read comments on competitors' posts or other orgs' posts.
   - Requires `r_organization_social_feed` or `r_member_social_feed` permission.
   - Only enterprise/approved developers have access; highly gated.

2. **No Webhook Available:** LinkedIn does not expose comment webhooks. You must poll, and polling is only available for your own content.

**Data per Commenter:**
- actor (URN of person or organization), message text, created timestamp, likes_summary
- **No direct email/phone access.** URN is a LinkedIn-internal identifier.

**Access Restrictions:**
- Partner-gated for enterprise only.
- Marketing Developer Platform approval required.
- No public API for reading 3rd-party org comments or competitive intelligence.
- **Current:** Community Management API available to select developers only (as of 2026).

**Verdict: RED** — Restricted to your own organization's posts. Requires partner approval. No webhooks. Cannot harvest leads from comment sections of posts you don't own. Not viable for outbound lead capture from other orgs/people.

**Sources:**
- [LinkedIn Comments API (Microsoft Learn)](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api?view=li-lms-2026-06)
- [LinkedIn API 2026: Access Requirements](https://connectsafely.ai/articles/linkedin-api-complete-guide-2026)

---

## SUMMARY GRID

| Platform | **Wall Post** | **Comments/Mentions Capture** | **Method** | **Cost** | **Effort** |
|----------|---|---|---|---|---|
| **X** | YELLOW (reply only, w/ restrictions) | YELLOW (REST polling costly; filtered stream $5K+/mo) | REST or Stream | $6.50–5K+/mo | Medium–High |
| **Threads** | YELLOW (reply only) | GREEN (webhooks) | Webhooks + Polling | Free (app review) | Low |
| **Facebook** | RED (personal walls blocked; can comment/tag) | GREEN (webhooks established) | Webhooks + Polling | Free (app review) | Low |
| **Instagram** | RED (own account only; can reply) | GREEN (webhooks) | Webhooks + Polling | Free (app review) | Low |
| **LinkedIn** | N/A (no wall concept for individuals) | RED (own posts only, partner-gated) | REST Polling (partner approval) | Enterprise $/contact | High |

---

## UNRESOLVED QUESTIONS

1. **X Filtered Stream Overage Risk:** Does X provide real-time alerts when approaching the 2M reads/month cap, or do overages occur silently? What's the typical cost overage on a moderately active stream rule set?

2. **Threads Mention Webhook Lag:** Do Threads mention webhooks fire synchronously when someone @mentions you on any post (including re-posts), or only on direct replies to your content? Docs say "public media tagging" but edge case unclear.

3. **LinkedIn Comment Visibility:** If a comment URN is public via the API, can a non-enterprise developer enumerate comments via undocumented endpoints, or is access truly blocked at API layer? (Relevant for evaluating feasibility.)

4. **Instagram DM Eligibility:** Does "opted into business messaging" (DM prerequisite) trigger automatically after they comment, or only after they initiate a DM to your business account? Critical for automated follow-up flow.

5. **X Mention Restriction Enforcement:** Does the "cannot @mention in standalone posts" restriction apply only to new API calls, or retroactively to previously posted tweets? (Affects cleanup/replay logic.)

6. **Facebook Custom Audiences from Comments:** Can you export a comment-based lead list (id + name) into a Facebook Custom Audience via Graph API for retargeting, or does Meta block this flow for privacy reasons?

---

## RECOMMENDATION SUMMARY

**Feature A (Wall Greeting):**
- **Threads & Instagram:** Reply nodes only; cannot post to target's wall.
- **X:** Reply + mention nodes work if target has engaged with you first (constraint as of March 2026).
- **Facebook:** Comment on target's post or tag them in your post; no wall post.
- **LinkedIn:** No "wall" concept for individuals; no programmatic greeting option.
- **Best Practice:** Frame as "reply to recent post" or "mention in engagement context," not "wall post to cold target."

**Feature B (Lead Capture from Comments):**
- **High Priority:** Threads, Facebook, Instagram (webhooks ready; low cost).
- **Medium Priority:** X (REST polling is cheap; filtered stream prohibitively expensive for MVP).
- **Low Priority:** LinkedIn (partner-gated, own-posts-only; skip for now).
- **Data Limitation:** No email/phone via any platform API. Capture username/ID only; enrich via 3rd-party B2B data or reciprocal CRM lookups.

---

## CITED SOURCES

- [X API v2 Create Tweets](https://docs.x.com/x-api/posts/create-manage-tweets)
- [X Filtered Stream](https://docs.x.com/x-api/tweets/filtered-stream/integrate/build-a-rule)
- [Meta Threads API](https://developers.facebook.com/docs/threads/)
- [Meta Instagram Platform](https://developers.facebook.com/docs/instagram-platform)
- [Facebook Graph API Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/reference/page/)
- [LinkedIn Comments API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api?view=li-lms-2026-06)
- [X API Pricing 2026](https://postproxy.dev/blog/x-api-pricing-2026/)
