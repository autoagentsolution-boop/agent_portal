# Phase 06 — Agent Credential Collection

## Overview
Priority: P0  
Status: Planned

Show required credentials/setup inputs for each agent during demo and collect them safely. Values must be masked in UI, encrypted at rest, and never leaked into git/logs.

## Requirements
- Active Flows agent detail shows required credentials/setup items.
- User can enter missing credentials from the agent detail panel.
- Secret fields are always password/masked inputs.
- Backend stores secret values encrypted using existing encryption utilities.
- UI only displays status: configured / missing / needs attention.
- Never echo secret values back to UI, logs, errors, or chat history.

## Credential Categories
- `gemini_api_key` — Concept Writer / Master Agent provider.
- `google_drive_folder_or_file_ids` — media asset references; not necessarily secret but should be treated carefully.
- `social_oauth_token` — Publisher platform tokens; already modeled by `OAuthToken`, reuse where possible.
- `video_provider_key` — future video/storyboard agents.
- `tts_music_provider_key` — future Voiceover Video agent.

## Backend Design
Prefer reuse:
- Reuse existing encrypted OAuth/token storage where platform-specific.
- Add a generic `AgentCredential` model only if current `OAuthToken` cannot represent provider credentials cleanly.

Potential Prisma model:
```prisma
model AgentCredential {
  id        String   @id @default(uuid()) @db.Uuid
  ownerId   String   @map("owner_id") @db.Uuid
  agentId   String   @map("agent_id")
  key       String
  value     String   // encrypted ciphertext
  status    String   @default("active")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@unique([ownerId, agentId, key], name: "ux_agent_credential_owner_agent_key")
  @@index([ownerId], name: "ix_agent_credential_owner")
  @@map("agent_credential")
}
```

## API Requirements
- `GET /agent/credentials/status` — return missing/configured statuses only.
- `PUT /agent/credentials/:agentId/:key` — save encrypted value.
- `DELETE /agent/credentials/:agentId/:key` — remove value.
- Never return raw decrypted values.

## Frontend Requirements
- Agent detail panel displays credential checklist.
- Missing credential row has masked input and Save button.
- Configured credential row shows `Configured • updatedAt` and Replace/Delete actions.
- Values clear from React state after successful save.

## Related Code Files
- `MKTAgent/prisma/schema.prisma`
- `MKTAgent/src/lib/crypto.ts`
- `MKTAgent/src/api/agent-router.ts`
- `MKTAgent/web/src/components/ActiveFlowsPage.tsx`
- `MKTAgent/web/src/api/client.ts`

## Success Criteria
- Reviewer can click an agent and see exactly what setup is missing.
- Entered secret is masked and saved; UI never displays it again.
- Build/typecheck pass.
- Git diff contains no credential values.

## Security Considerations
- Block accidental logging of request bodies for credential endpoints.
- Validate credential key names against allowlist.
- Encrypt before DB write.
- Do not include credential values in chat history or agent prompts unless explicitly needed and safe.
