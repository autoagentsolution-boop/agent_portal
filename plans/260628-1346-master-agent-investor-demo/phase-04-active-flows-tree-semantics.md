# Phase 04 — Active Flows Tree Semantics

## Overview
Priority: P1  
Status: Complete — implemented; pending fresh validation in Phase 05

Make Active Flows behave like a project folder tree and working area.

## Requirements
- Sidebar tree: `Active Flows → Branding/Social → Campaign → Post summary`.
- Campaign click shows only that campaign's posts.
- Post click shows only selected post.
- Agent details hidden until clicking an agent node.
- Main working area remains full width.
- No duplicate campaign tree/card in main area.

## Related Code Files
- `MKTAgent/web/src/App.tsx`
- `MKTAgent/web/src/components/ActiveFlowsPage.tsx`
- `MKTAgent/web/src/components/PostBoard.tsx`
- `MKTAgent/web/src/components/PostCard.tsx`
- `MKTAgent/web/src/styles.css`

## Implementation Steps
1. Ensure sidebar campaign tree uses real `CampaignDto.product`.
2. Generate post labels from copy first line, fallback status/id.
3. Keep selected campaign/post state in `App`.
4. `PostBoard` filters by campaign or single post.
5. Remove stale scroll-only behavior when single-post mode is active.
6. Add empty states for no campaigns/no posts.

## Success Criteria
- Sidebar behaves like project navigation.
- Click campaign/post updates main working area deterministically.
- No duplicated `Campaigns` level/card.
