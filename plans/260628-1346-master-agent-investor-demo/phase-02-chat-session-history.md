# Phase 02 — DB-backed Chat Session History

## Overview
Priority: P0  
Status: Blocked — compile/build pass, but runtime chat send does not respond. See `../reports/handoff-260628-1540-master-agent-chat-runtime-blocker.md`.

Store Master Agent chat history per user in Postgres, same ownership model as Campaign/Post. Do not use localStorage/session-only history for the investor demo.

## Requirements
- Chat sessions are tenant-scoped by `ownerId`.
- Sidebar Chats lists real DB sessions for the logged-in user.
- Clicking a chat restores exact messages + latest setup draft.
- New setup chat creates a new DB row on first user message.
- Chat messages are append-only records for audit/debug.
- Do not store secrets/credentials in chat messages; credential collection uses a separate encrypted credential path.

## Backend Data Shape
Add Prisma models:

```prisma
model AgentChatSession {
  id        String   @id @default(uuid()) @db.Uuid
  ownerId   String   @map("owner_id") @db.Uuid
  title     String
  draft     Json?
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  owner    User @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  messages AgentChatMessage[]

  @@index([ownerId, updatedAt(sort: Desc)], name: "ix_agent_chat_owner_updated")
  @@map("agent_chat_session")
}

model AgentChatMessage {
  id        String   @id @default(uuid()) @db.Uuid
  sessionId String   @map("session_id") @db.Uuid
  role      String
  content   String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  session AgentChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, createdAt], name: "ix_agent_chat_message_session_created")
  @@map("agent_chat_message")
}
```

## API Requirements
- `GET /agent/chats` — list sessions for user.
- `GET /agent/chats/:id` — get session + messages; enforce owner.
- `POST /agent/chats` — create session with optional first message.
- `POST /agent/chats/:id/messages` — append user message, call intake provider, append assistant response, update draft.
- `PATCH /agent/chats/:id` — update title/draft if needed.

## Frontend Requirements
- App sidebar `Chats` uses `GET /agent/chats`.
- Clicking a chat loads DB messages and draft.
- `MasterAgentIntake` becomes controlled by active DB chat state.
- New setup chat starts a new unsaved draft until first message, then creates session.

## Related Code Files
- `MKTAgent/prisma/schema.prisma`
- `MKTAgent/src/api/agent-router.ts`
- `MKTAgent/src/api/schemas.ts`
- `MKTAgent/src/agent/*`
- `MKTAgent/web/src/App.tsx`
- `MKTAgent/web/src/api/client.ts`
- `MKTAgent/web/src/components/MasterAgentIntake.tsx`

## Success Criteria
- Send a message → DB session created and visible under Chats.
- Click historical chat → messages/draft restored from DB.
- Refresh browser/login again → chat history remains.
- User A cannot access User B chat via guessed id.

## Security Considerations
- Chat content may include sensitive business info; tenant isolation required.
- Do not log full chat content in server logs.
- Do not store credential secret values in chat; route them to encrypted credential store only.
