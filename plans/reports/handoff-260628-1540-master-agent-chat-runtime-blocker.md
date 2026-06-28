# Handoff — Master Agent Chat Runtime Blocker

---
type: handoff
created: 2026-06-28 15:40 Asia/Bangkok
branch: pivot/video-content-farm
plan: plans/260628-1346-master-agent-investor-demo/plan.md
status: blocked
---

## Summary

Master Agent investor demo work is mid-flight. Compile/build pass, but user reports **Master Agent chat does not respond at runtime**. Next session should focus only on debugging runtime chat request path before doing more UI polish or credential UI.

## Current Evidence

Validation already run by user after latest code edits:

- `npm --prefix "MKTAgent" run typecheck` → PASS (`tsc --noEmit`, no errors)
- `npm --prefix "MKTAgent/web" run build` → PASS (`vite build`, 40 modules, built in 1.28s)

Tooling issue during session:

- Claude tool classifier repeatedly blocked direct `Bash`, `PowerShell`, and `Agent` calls with `cx/gpt-5.5[1m] temporarily unavailable`.
- Tester/code-reviewer subagents were not able to run.

## Files Changed / Relevant

Main changed files:

- `MKTAgent/prisma/schema.prisma`
  - Added `AgentChatSession`, `AgentChatMessage`, `AgentCredential` models.
- `MKTAgent/src/api/agent-router.ts`
  - Added DB chat endpoints and credential status/save/delete endpoints.
- `MKTAgent/src/api/schemas.ts`
  - Added chat and credential request schemas.
- `MKTAgent/web/src/api/client.ts`
  - Added chat and credential client helpers.
- `MKTAgent/web/src/App.tsx`
  - DB-backed chat sidebar state.
  - Latest fix: sidebar list rows are partial, so `loadChats()` no longer auto-selects a partial chat and preserves hydrated active session.
- `MKTAgent/web/src/components/MasterAgentIntake.tsx`
  - Controlled by selected DB chat session.
  - Creates session on first message, appends messages thereafter.
  - JSX cleanup done for reviewability.

Untracked / inspect next:

- `MKTAgent/prisma/migrations/20260628080950_agent_chat_credentials/`
  - Privacy hook blocked inspection during this session.
  - Next session should inspect/apply migration with user approval if needed.
- `render-service/pnpm-lock.yaml`, `render-service/pnpm-workspace.yaml`
  - Looks unrelated to Master Agent chat. Inspect before committing.
- `.claude/scheduled_tasks.lock`
  - Likely incidental.

## User-Reported Runtime Bug

User says: **"Hiện tại chat không phản hồi"**.

This was reported after successful typecheck/build. Therefore likely runtime/deploy/state issue, not TS compile issue.

## Highest-Probability Root Causes To Check First

1. **Server/container is stale**
   - Memory says Docker no bind-mount is a recurring gotcha.
   - If UI talks to Docker `app`, it may not include latest `agent-router.ts` / Prisma client / migration.
   - Check running process and rebuild/restart if container is serving API.

2. **DB migration not applied**
   - New endpoints write to `agent_chat_session` / `agent_chat_message`.
   - If migration not applied, `POST /agent/chats` will 500 and UI may appear to hang/no response.

3. **Prisma client not regenerated / schema mismatch**
   - Typecheck passed in current workspace, but runtime process may use old generated client/container image.

4. **Frontend request path / auth issue**
   - First chat sends `POST /agent/chats` via cookie-auth fetch.
   - Check browser network: status, response body, CORS/cookie, `/auth/me` state.

5. **Provider latency/failure path**
   - `POST /agent/chats` creates session, creates user message, calls `parseDraft()`, then appends assistant.
   - If Gemini request stalls, UI waits. Fallback should run when no key or failed response, but timeout behavior should be verified.

## Suggested Debug Path Next Session

1. Confirm API process source:
   - Is `MKTAgent` served by Docker app or host `tsx`?
   - If Docker: rebuild/restart. If host: kill stale `:7100` process and restart.

2. Check browser network for chat send:
   - Request URL: `/agent/chats` on first message, `/agent/chats/:id/messages` after.
   - Capture status/body only, no secrets.

3. Check server logs for one chat send:
   - Look for 500 from missing table / Prisma error / auth failure / CORS.

4. Apply/verify migration:
   - Inspect `MKTAgent/prisma/migrations/20260628080950_agent_chat_credentials/` with user approval.
   - Run migration deploy/dev against correct DB.

5. Smoke via API after auth/session:
   - Use existing browser session/cookie or login flow.
   - Verify `GET /agent/chats` returns data envelope.

6. Only after chat responds:
   - Run tester/code-reviewer.
   - Update plan/docs.
   - Decide whether Phase 06 credential UI is in current scope.

## Do Not Do Next

- Do not continue credential UI before chat runtime responds.
- Do not commit unrelated `render-service` files without inspection.
- Do not delete/recreate DB/cache without explicit user approval.
- Do not real-post to social platforms while debugging.

## Unresolved Questions

- Is the running API Docker or host `tsx`?
- Was migration `20260628080950_agent_chat_credentials` applied to the active DB?
- What exact network status/body does chat send return?
- Does server log show Prisma missing table, auth 401, CORS, or provider timeout?
