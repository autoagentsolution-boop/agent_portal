# Master Agent Investor Demo Plan

## Status
- Planned

## Target Date
- Tuesday 2026-06-30

## Goal
Deliver a review-ready Master Agent demo that feels like ChatGPT/Claude/Gemini: natural conversation, restorable chat history, structured setup side-channel, and Active Flows management.

## Scope
1. True conversational Master Agent
   - Natural LLM response is primary.
   - Structured campaign/post draft is a side-channel.
   - No template-style response for broad customer discovery.
2. Restorable DB-backed chat history
   - Sidebar Chats restores exact messages + draft state from Postgres per user.
   - No localStorage/session-only history for the investor demo.
3. Agent credential collection
   - UI shows required credentials per agent.
   - Secret inputs are masked, encrypted at rest, and never logged.
4. Two-page UI
   - Master Agent default page.
   - Active Flows operational page.
5. Active Flows tree semantics
   - Branding/Social → Campaign → Post summary.
   - Campaign click shows campaign posts.
   - Post click shows only selected post.
6. Demo polish
   - Light/dark theme stable.
   - Safe/Live simple toggle.
   - Build/typecheck pass.

## Phases
- [Phase 01 — Conversation architecture](phase-01-conversation-architecture.md)
- [Phase 02 — Chat session history](phase-02-chat-session-history.md)
- [Phase 03 — Master Agent UI polish](phase-03-master-agent-ui-polish.md)
- [Phase 04 — Active Flows tree semantics](phase-04-active-flows-tree-semantics.md)
- [Phase 05 — Demo QA and script](phase-05-demo-qa-and-script.md)
- [Phase 06 — Agent credential collection](phase-06-agent-credentials.md)

## Key Dependencies
- Existing `/agent/intake` endpoint.
- Existing campaign/post CRUD APIs.
- Existing Gemini provider fallback path.

## Definition of Done
- User can ask broad discovery questions and get natural reasoning response.
- User can provide campaign details and get structured setup draft.
- Historical chat click restores previous conversation and setup summary.
- Active Flows sidebar tree filters working area correctly.
- `npm run typecheck` backend passes.
- `npm run build` web passes.
- Demo script exists and is rehearsable within 5 minutes.

## Risks
- Gemini JSON drift: fallback + defensive parsing required.
- UI state regression: keep implementation local and small.
- DB chat migration must be small and tenant-scoped; avoid broad auth/session changes.
- Credential collection must never expose raw values in UI responses, logs, chat messages, or git diffs.
