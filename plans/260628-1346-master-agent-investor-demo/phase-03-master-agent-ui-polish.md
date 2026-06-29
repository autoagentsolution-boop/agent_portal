# Phase 03 — Master Agent UI Polish

## Overview
Priority: P0  
Status: Complete — implemented; pending fresh validation in Phase 05

Finalize ChatGPT/Claude-style Master Agent page for investor demo.

## Requirements
- Left sidebar remains stable and clean.
- Main page opens with centered welcome and composer.
- Conversation renders natural bubbles.
- Setup summary appears only when concrete setup data exists.
- Edit form hidden unless user clicks `Edit fields`.
- Light/dark toggle works and does not break contrast.

## Related Code Files
- `MKTAgent/web/src/App.tsx`
- `MKTAgent/web/src/components/MasterAgentIntake.tsx`
- `MKTAgent/web/src/styles.css`

## Implementation Steps
1. Reduce visual clutter in Master page.
2. Make assistant messages wider/readable like ChatGPT/Claude.
3. Add “thinking” state that feels natural, not technical.
4. Convert setup summary into collapsible side-channel card.
5. Ensure broad discovery does not show empty setup summary.
6. Test light/dark contrast for text and buttons.

## Success Criteria
- Investor sees familiar AI chat interface in first 5 seconds.
- Conversation feels advisory, not a hardcoded wizard.
- Setup draft is clearly a result of reasoning, not the whole interaction.

## UX Notes
- Primary CTA should be chat input, not form fields.
- User should not see many empty fields by default.
