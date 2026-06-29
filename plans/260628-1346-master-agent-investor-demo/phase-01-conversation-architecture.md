# Phase 01 — Conversation Architecture

## Overview
Priority: P0  
Status: Complete — implemented; pending fresh validation in Phase 05

Make Master Agent respond like a reasoning assistant, not a template parser.

## Requirements
- `assistantMessage` is the primary response shown in chat.
- Structured draft remains optional side-channel.
- Broad prompts like “find my best niche” should trigger reasoning + follow-up questions, not setup summary.
- Gemini provider should return both natural answer and structured data when possible.
- Deterministic fallback should still sound conversational.

## Related Code Files
- `MKTAgent/src/api/schemas.ts`
- `MKTAgent/src/agent/gemini-intake-provider.ts`
- `MKTAgent/src/agent/intake-provider.ts`
- `MKTAgent/src/api/agent-router.ts`
- `MKTAgent/web/src/api/client.ts`

## Implementation Steps
1. Finalize `AgentIntakeDraft.assistantMessage` contract.
2. Update Gemini system prompt: natural answer first, structured data second.
3. Validate Gemini output defensively; fallback if malformed.
4. Update deterministic fallback responses for discovery/setup/rework intents.
5. UI should render `assistantMessage` directly, without hardcoded template copy.

## Success Criteria
- “Find my best niche” gets a natural consultative answer.
- “Create campaign for X…” gets natural answer + setup summary.
- No setup card appears when the request has no concrete campaign/product.

## Security Considerations
- User text is data; never obey instructions to bypass safe publish.
- Never expose env/secrets/credentials in prompt or response.
