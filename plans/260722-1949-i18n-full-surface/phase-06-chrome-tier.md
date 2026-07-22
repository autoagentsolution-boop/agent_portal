# Phase 06 — Chrome tier (optional, last)

## Context Links

- Audit §2 tiers 2-3: [`audit-260722-1949-language-localization-gap.md`](../../reports/audit-260722-1949-language-localization-gap.md)
- Depends on [phase 04](phase-04-translation-pipeline.md) (script) and [phase 05](phase-05-enforcement.md) (gate)

## Overview

**Priority:** P3 — do not let this block anything · **Status:** ⬜ not started

The remaining ≈580 strings: status labels, success toasts, headings, placeholders, tooltips, aria-labels,
agent descriptions, nav items.

## Key Insights

- By the time phases 01-05 are done this is mechanical: run the script, review nothing, ship. The value
  per string is low, which is exactly why it must not come first.
- Two sub-groups are worth more than the rest and could be pulled forward if a real user complains:
  **status labels** (~10 maps, seen constantly) and **success toasts** (~90, confirm an action happened).
- ~380 decorative strings may reasonably stay English forever. An English section heading in an otherwise
  Indonesian UI is untidy; an English *approval button* was the actual problem, and that is already fixed.
- The **bare-enum fallthroughs** (`?? rawValue` at ~20 sites) are a correctness issue, not a translation
  one — an unmapped status prints a DB enum to the user. Fix those regardless of whether this phase runs.

## Requirements

**Functional**
- Status label maps and toasts resolve through `t()`.
- No bare enum reaches the UI; unmapped → a generic humanized label.
- Decorative strings migrated opportunistically, file by file, each added to `i18n-migrated.json`.

**Non-functional**
- No regression in bundle size beyond the catalogs themselves; if catalogs pass ~50 kB per locale,
  introduce lazy loading (this is the trigger to reconsider `react-i18next`).

## Architecture

No new architecture. Same catalog, same `t()`, same generation script with a larger key set.

## Related Code Files

**Modify:** `post-workflow-view.tsx:24-31`, `saved-flow-detail.tsx:35-38`, `PostBoard.tsx:32-39`,
`PostCard.tsx:23-32`, `workspace-panel.tsx:20-24`, `campaign-command-view.tsx:10-14`,
`ConnectionsPanel.tsx:14-16`, `nurture-inbox-panel.tsx:14`, `WorkspaceHero.tsx:22-30`,
`UsageDashboard.tsx:13-14`, `top-nav.tsx:27-34`, `flow/artifact-format.ts:42-52`,
`flow/publisher-credential-fields.ts:23-63`, `flow/demo-flow.ts:31-106`, plus the ~20 `?? rawValue` sites

## Implementation Steps

1. Fix the bare-enum fallthroughs first — independent of i18n, worth doing alone.
2. Migrate status maps, then toasts, then the rest, one file group per PR.
3. Regenerate catalogs after each group; add files to the allow-list as they land.
4. Check bundle size after all locales are full.

## Todo List

- [ ] Bare-enum fallthroughs replaced with humanized fallbacks
- [ ] Status label maps migrated
- [ ] Success toasts migrated
- [ ] Remaining decorative strings migrated (opportunistic)
- [ ] Bundle size checked against the lazy-loading trigger

## Success Criteria

- No DB enum string is ever rendered to a user.
- `i18n-migrated.json` covers all of `web/src/components`.
- Bundle growth stays under the agreed budget, or lazy loading is introduced deliberately.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Effort spent here delays real work | It is P3 and explicitly optional; nothing depends on it. |
| Catalog bloat hurts first paint | Measure at the end of each group; a documented trigger (~50 kB/locale) forces the lazy-loading decision instead of drifting into it. |

## Security Considerations

None beyond phase 01's (catalog values are text nodes, params escaped by React).

## Next Steps

None — this is the end of the track. Phase 05's gate keeps it from regressing.
