# Phase 05 — Campaign-Level Grant (approve calendar once → all run)

**Priority:** CORE. **Status:** planned. **Depends on:** Phase 04 + autonomy-hardening Phase 01 (grant seam).
**Goal:** One double-confirm on the calendar authorizes ALL N posts to run autonomously; each still
guardrailed + audited + notified (never a blanket unsafe blast).

## What's new
1. **Campaign grant** — extend the per-run grant to a whole campaign: `POST /campaigns/:id/grant-autonomy`
   `{ confirmationToken, scheduleConfirmed }` (same backend-enforced 2-step HMAC, keyed on campaignId) →
   bulk-set every materialized post's instance run to `approvalMode='atria'` + `scheduleConfirmed=true`
   in ONE audited action. One review, whole month runs.
2. **Per-post guardrails UNCHANGED** — each run still passes the autonomy-hardening boundary re-read +
   policy: a post whose platform went unconnected / media missing / over-budget HOLDS + notifies for THAT
   post only; siblings proceed. The grant authorizes the flow; guardrails still gate each external write.
3. **Upfront cost gate** — surface the whole-calendar estimated credits/USD at grant time; the grant
   confirmation shows "N posts, dates, est. X credits (~$Y)" so a user never accidentally authorizes an
   expensive month (esp. video). Optional hard ceiling per campaign (reuse `ATRIA_AUTONOMY_COST_CEILING`).
4. **Campaign status + notify** — a rollup of the campaign's posts (planned/running/held/posted/failed)
   via SSE (`events/bus`) + a per-post completion notify.

## Related code files
Modify: `api/campaigns-router.ts` (grant + status rollup + estimate), `db/repos/workflow-run-repo.ts`
(bulk grantAutonomy over a campaign's runs), `api/autonomy-grant-token.ts` (campaign-scoped token),
`db/repos/campaign-repo.ts` (status rollup). Read: autonomy-hardening phase-01, `workflow-executor.ts`.

## Steps
1. Campaign-scoped grant token + `POST /campaigns/:id/grant-autonomy` (2-step handshake).
2. Bulk set approvalMode/scheduleConfirmed across the campaign's runs (audited).
3. Whole-calendar cost estimate at grant; per-campaign ceiling.
4. Campaign status rollup + per-post completion notify.
5. Verify: grant N posts → all flip atria+scheduleConfirmed with an audit row; a guardrail-fail post
   HOLDS while siblings proceed; no double-publish; ungranted campaign posts still park (no autonomy leak).

## Acceptance
- One grant authorizes N posts in a single audited action; each guardrail-gated per post; cost shown up
  front. A single bad post holds+notifies without blocking the campaign. Byte-identical when not granted.

## Next → Phase 06 makes Atria PROPOSE the campaign proactively.
