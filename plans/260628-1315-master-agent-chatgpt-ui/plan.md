# Master Agent ChatGPT-style UI

## Status
- In progress

## Goal
Rework Master Agent into a ChatGPT/Claude-like product shell: persistent sidebar, centered welcome/composer, chat history, and theme switch.

## Scope
- Left sidebar: New chat, Active Flows, scheduled, projects/chats placeholders.
- Master page: centered "Where should we begin?" setup composer and prompt chips.
- Conversation state: show historical messages after user submits.
- Setup summary: shown after analysis; edit fields hidden until requested.
- Theme: light/dark CSS variable switch.
- Keep Active Flows as page 2.

## Validation
- `npm --prefix MKTAgent run typecheck`
- `npm --prefix MKTAgent/web run build`
