# Phase 03 — Migrate the act-on tier (≈250 strings)

## Context Links

- Audit §2 tiers: [`audit-260722-1949-language-localization-gap.md`](../../reports/audit-260722-1949-language-localization-gap.md)
- Depends on: [phase 01](phase-01-locale-foundation.md), [phase 02](phase-02-api-message-envelope.md)

## Overview

**Priority:** P1 · **Status:** ⬜ not started

Migrate only the copy a user must **act on**: approve, connect, pay, retry, delete, confirm. Roughly 250
of the ≈830 strings. The rest can stay English indefinitely without harming anyone.

## Key Insights

- The tiering is the whole point. Chasing all 830 first is how this stalls; the act-on tier is where a
  wrong language costs money or blocks work.
- Four already-fixed strings prove the class: the credit-grant confirm (`Xác nhận`/`Huỷ` under an English
  `≈ 1,200 cr?`), the impact narration, and the `vi-VN` speech default. Those were bleed-stops with no
  catalog behind them — this phase gives them a real home.
- The out-of-credits toast is duplicated in **4 files** (`OrchestratePanel.tsx:318,364`,
  `post-workflow-view.tsx:103`, `saved-flow-detail.tsx:118`). Migration collapses duplicates into one key
  — the string count drops on its own.
- Native `confirm()` / `prompt()` (`App.tsx:248,262`, `LeadsPage.tsx:89`, `saved-flow-detail.tsx:141`,
  `ProductKnowledgeLibrary.tsx:84`, `PostCard.tsx:89`) cannot be styled but CAN be translated — pass
  `t()` output. Replacing them with real dialogs is a separate UX task; do not bundle it here.

## Requirements

**Functional**
- Every act-on string resolves through `t()`.
- Duplicated copy collapses to a single key.
- Server-authored act-on copy arrives as codes (phase 02) — this phase only writes their catalog entries.

**Non-functional**
- No visual regression: keys carry the *exact* current English text unless it is being fixed on purpose.
- One PR per screen group, not one giant PR — reviewable, revertable.

## Architecture

Key naming: `area.thing.state` — `credits.exhausted`, `connect.required.title`, `approve.video.cost`,
`lead.token.revoke.confirm`. Flat namespace, no nesting; the dotted string is the whole key.

Order of migration, by blast radius:

1. **Money + irreversible** — credit grant confirms, video cost gate, autonomy confirm, delete/revoke
   confirms, live-publish confirm.
2. **Blocking** — connection-required, out-of-credits, publish gate, "a step failed", approval buttons.
3. **Nurture/Leads act-on** — opt-out, "approve once more to send", intake token warnings.

## Related Code Files

**Modify (tier 1):** `workspace-panel.tsx`, `scheduled-view.tsx`, `post-workflow-view.tsx`,
`content-calendar.tsx`, `video-script-review.tsx`, `PostCard.tsx`, `App.tsx`, `LeadsPage.tsx`,
`ProductKnowledgeLibrary.tsx`, `saved-flow-detail.tsx`
**Modify (tier 2):** `OrchestratePanel.tsx`, `connection-required.tsx`, `publish-review.tsx`,
`email-panel.tsx`, `UsageDashboard.tsx`, `plan-tier-cards.tsx`, `concept-selection-gate.tsx`
**Modify (tier 3):** `nurture-inbox-panel.tsx`, `nurture-thread-timeline.tsx`, `LeadsPage.tsx`
**Also:** `web/src/components/top-nav.tsx`, `workspace-menu.tsx` — the remaining hardcoded Vietnamese
(`Tìm chat…`, `Chưa có chat nào`, `Xoá ${title}`, `Xoá workspace`, `Tải thêm`) must land in the catalog,
not be flipped to English by hand.

## Implementation Steps

1. Extract tier 1 strings into `catalog.en.ts`; replace in place; screenshot-compare each screen.
2. Collapse the 4 out-of-credits duplicates into `credits.exhausted`.
3. Translate the native `confirm()`/`prompt()` arguments through `t()`.
4. Move the 17 hardcoded Vietnamese strings into the catalog as `vi` entries **with English keys defined
   first** — they are currently the only real `vi` translations that exist; do not throw them away.
5. Write catalog entries for the phase-02 `err.*` / `notice.*` codes used by these screens.
6. Re-run the observed-browser test scripts 1-3 in `id` to confirm nothing regressed visually.

## Todo List

- [ ] Tier 1 (money + irreversible) migrated
- [ ] Tier 2 (blocking) migrated
- [ ] Tier 3 (nurture/leads) migrated
- [ ] 4 out-of-credits duplicates collapsed to one key
- [ ] 17 existing Vietnamese strings preserved as `vi` catalog entries
- [ ] Native confirm/prompt strings routed through `t()`
- [ ] Visual pass per screen group

## Success Criteria

- With `uiLanguage='id'`, a full flow — propose → approve cost → connection gate → publish → error —
  shows no English.
- With `uiLanguage='en'`, every screen is byte-identical to today except the 4 deliberate fixes.
- The act-on tier greps clean of literals (phase 05 asserts it).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Silent copy changes during extraction | Keys carry current text verbatim; any intentional rewording is a separate commit with its own line in the PR body. |
| A key is translated but its screen is never re-tested | Tie each PR to the screen group and re-run the relevant observed-test script. |
| Vietnamese strings get "cleaned up" into English and lost | Step 4 is explicit: they become `vi` catalog entries, they do not disappear. |

## Security Considerations

- Confirm dialogs for destructive actions must keep naming the object (`Delete workspace "X"?`) — the
  param must survive translation. A catalog entry that drops `{name}` turns a specific confirm into a
  vague one, which is a real safety regression.

## Next Steps

Phase 05 lands with this phase, not after it. Phase 04 can start once the key set stabilizes.
