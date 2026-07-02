# Phase 05 — Storage as a Connection (item 4)

**Priority:** LOW (UI shell only this round)
**Status:** pending

## User decision
UI shell + wire to existing local storage. NO Google Drive OAuth this round (follow-up).

## Context
Images/videos are written to local storage (`local:<path>` heroFile refs, served via `/media/images`). The brief has a free-text "Drive folder ID" field (brief1.png). User wants storage to appear as a Connection (like FB/IG) so it's a first-class, setup-able thing.

## Requirements
1. Connections page shows a **Storage** entry alongside social platforms.
2. It reflects the currently-used local storage (status: connected/local by default).
3. No new secrets/OAuth. Just make the existing local storage visible + selectable as the media destination.

## Design (KISS — shell, not integration)
- Connections UI is driven by `connector-registry.ts` (CONNECTORS) + social platform enum. Storage is NOT a SocialPlatform — do NOT overload that enum (it feeds the publish resolver).
- Add a SEPARATE, lightweight storage-connection concept:
  - Option A (recommended): a static "Storage" card in the Connections page, hardcoded to show "Local storage — active" with a disabled/coming-soon "Connect Google Drive" affordance. Zero backend. Pure shell matching the user ask.
  - Option B: a minimal `storage_targets` notion in DB. Overkill for "UI shell" — defer.
- Wire "existing local storage": the card states media currently saves locally and is served at `/media`. If a Drive folder field exists on the brief, note it maps here in future. No behavior change to the pipeline.

## Related code files
- READ Connections page component (grep `Connections` in web/src/components)
- READ `MKTAgent/src/connectors/registry/connector-registry.ts` — do NOT add storage to SocialPlatform CONNECTORS
- MODIFY Connections page — add Storage section (static card, local=active, Drive=coming soon)
- READ where `/media/images` is served — confirm local path for the card's copy

## Todo
- [ ] Locate Connections page + how cards render
- [ ] Add Storage section (local active + Drive coming-soon, disabled)
- [ ] Copy explains media saves locally, served at /media
- [ ] web build clean
- [ ] Manual check: Connections shows Storage, doesn't break social connect flow

## Success criteria
- Connections page has a Storage entry showing local storage active.
- Social connect/publish resolver untouched (SocialPlatform enum unchanged).
- No new secrets.

## Risks
- Temptation to overbuild. HOLD THE LINE: shell only. Drive OAuth is a separate future phase.
- If the campaign brief's "Drive folder ID" field implies existing Drive wiring, verify it's currently inert before claiming local-only. (grep driveFolderId usage — copygen/publish.)
