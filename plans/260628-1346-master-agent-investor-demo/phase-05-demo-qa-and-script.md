# Phase 05 — Demo QA and Script

## Overview
Priority: P0  
Status: Planned

Prepare Tuesday investor/reviewer demo.

## Requirements
- Build and typecheck pass.
- Demo script covers Master Agent → setup draft → Active Flow → post review.
- Known limitations stated clearly.
- No real social publishing unless deliberately switched to Live and confirmed.

## Commands
```bash
cd /c/Users/Vincere/Desktop/Claude/AgentPortal/MKTAgent && npm run typecheck
cd /c/Users/Vincere/Desktop/Claude/AgentPortal/MKTAgent/web && npm run build
```

## Demo Script
1. Open Master Agent page.
2. Ask: “I run an AI automation service for small business owners. Help me choose the best niche and campaign angle.”
3. MA responds naturally with reasoning/follow-up.
4. Provide concrete details: product, audience, language, platforms, video/image, schedule.
5. MA creates structured setup summary.
6. Confirm create draft.
7. Open Active Flows.
8. Show sidebar tree: flow → campaign → post.
9. Click post summary; only that post appears.
10. Generate/review/approve schedule in Safe mode.

## Known Limitations To Say Out Loud
- Chat history is DB-backed; if the running app looks stale, rebuild/restart the serving API/container before code-diving.
- Some agents are placeholders until media/design provider adapters are wired.
- Live publish is intentionally guarded.

## Success Criteria
- Demo can be completed in under 5 minutes.
- No obvious blank/fake navigation entries.
- MA feels like an AI advisor, not a static form.
