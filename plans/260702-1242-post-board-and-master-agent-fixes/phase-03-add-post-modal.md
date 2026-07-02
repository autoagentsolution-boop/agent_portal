# Phase 03 — Add-post create-mode modal (item 3)

**Priority:** MEDIUM
**Status:** pending
**Depends on:** Phase 02 (the Master Agent path routes through the reuse logic)

## Context
User: clicking "+ New full brief" / add-post should offer **Create with Master Agent** OR **Manual input**. Manual already works; the MA path is the value-add. User clarified the actual pain is the item-2 fork bug (Phase 02) — this modal is the surface that exposes the MA create path cleanly.

## Requirements
1. Add-post entry shows a small modal: two choices.
   - **Manual input** → current brief editor (`+ New full brief` behavior, unchanged).
   - **Create with Master Agent** → opens Orchestrate chat SCOPED to this campaign (so the follow-up binds to the campaign's flow — Phase 02 logic).
2. MA-scoped create must carry campaign context (campaignId / flowId) so the conversation doesn't re-ask what the campaign already knows.

## Design
- Find the campaign board component (renders "+ New full brief" — brief1.png top-right). Likely `CampaignBoard`/`campaign-*.tsx` near PostCard.
- Add a `CreatePostModal` (reuse existing modal/dialog styles — check styles.css for `.modal`).
- MA choice: navigate to Orchestrate with a restore/seed context = `{ campaignId, flowId, product }`. OrchestratePanel already supports `restore`; may need a lightweight "seed" prop or a scoped starter message auto-filled.
- Keep it thin — no new backend for the manual path. MA path leans entirely on Phase 02.

## Related code files
- READ campaign board component (grep `New full brief`)
- READ `MKTAgent/web/src/App.tsx` — navigation between campaign board and Orchestrate
- CREATE `MKTAgent/web/src/components/create-post-modal.tsx`
- MODIFY campaign board — wire add-post → modal
- READ `MKTAgent/web/src/styles.css` — existing modal classes

## Todo
- [ ] Locate campaign board + "New full brief" handler
- [ ] CreatePostModal (Manual | Master Agent)
- [ ] Manual → existing editor unchanged
- [ ] MA → Orchestrate scoped to campaign (campaignId/flowId seed)
- [ ] web build clean
- [ ] Manual e2e: add post → modal → both paths work; MA path binds to campaign

## Success criteria
- Add-post opens the two-choice modal.
- Manual path identical to today.
- MA path opens chat pre-scoped; creating a post there lands under THIS campaign (no fork).

## Risks
- Scoping the Orchestrate chat to a campaign is new plumbing. If it balloons, ship the modal with Manual + an MA button that just deep-links to Orchestrate with a pre-filled starter naming the flow (relies on Phase 02 intent detection). Degrade gracefully.
