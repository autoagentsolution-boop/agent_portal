#!/usr/bin/env bash
# FE characterization harness — Phase-0 agent-browser sub-phase.
# Stands up the live stack, mints a superadmin test tenant with 2 campaigns (each 1 post) + a lead +
# instruction + memory, launches headed Chromium (CDP :9333), injects the session cookie, and prints
# the refs the 4 P0 journeys drive. Journeys are documented in ../journeys.md; baselines in ./baselines/.
#
#   bash plans/260725-1600-architecture-map/characterization/scripts/launch-fe-char.sh
#
# GOTCHAS (cost real time to rediscover — keep):
#   - agent-browser `click @ref` silently NO-OPS on this app. ALWAYS eval-click:
#       agent-browser --cdp 9333 eval "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Send')?.click()"
#   - The landing composer is an <input>; the in-chat composer is a <textarea> (INPUT→TEXTAREA is a
#     characterized invariant — don't 'fix' it). Submit the landing input with `press Enter`, not a
#     Send-button click (the Send button lookup is flaky post-reload).
#   - The Chats dropdown has TWO buttons matching the chat title; the real menu item is the one whose
#     text STARTS with the 💬 emoji. Match on that prefix.
#   - Close the chat / release the mic via the top-nav "◈ Command Center" button (→ closeCcChat →
#     stopVoice), not a chat-local ✕ (there isn't one in the embed).
set -u
ROOT="C:/Users/Vincere/Desktop/Claude/AgentPortal"
BE="$ROOT/MKTAgent"
PORT=9333
UDD="C:/Users/Vincere/AppData/Local/Temp/claude/fe-char-profile"

echo "== 1. Stack check =="
for p in 5433 7100 5173; do (echo >/dev/tcp/127.0.0.1/$p) 2>/dev/null && echo "  :$p UP" || echo "  :$p DOWN  <-- start it"; done

echo "== 2. Mint superadmin test tenant (2 campaigns w/ posts, lead, instruction, memory) =="
cd "$BE" || exit 1
MINT=$(GEMINI_API_KEY="$(grep '^GEMINI_API_KEY=' .env | cut -d= -f2)" npx tsx src/scripts/seed-fe-characterization.ts 2>&1 | grep -E "USERID|COOKIE|CAMPAIGN")
echo "$MINT"
COOKIE=$(echo "$MINT" | grep '^COOKIE=' | cut -d= -f2)

echo "== 3. Launch HEADED Chromium (CDP :$PORT) =="
CHROME=$(ls -1 "C:/Users/Vincere/.agent-browser/browsers/"*/chrome.exe 2>/dev/null | head -1)
[ -z "$CHROME" ] && { echo "  chrome.exe not found under ~/.agent-browser/browsers"; exit 1; }
rm -rf "$UDD" 2>/dev/null
"$CHROME" --remote-debugging-port=$PORT --user-data-dir="$UDD" \
  --use-fake-ui-for-media-stream --no-first-run --no-default-browser-check \
  "http://localhost:5173" >/tmp/fe-char-chrome.log 2>&1 &
disown 2>/dev/null
sleep 4

echo "== 4. Inject session cookie + reload =="
agent-browser --cdp $PORT cookies set mkt_session "$COOKIE" --url "http://localhost:5173" --sameSite Lax 2>&1 | tail -1
agent-browser --cdp $PORT reload 2>&1 | tail -1
echo
echo "READY. Drive with:  agent-browser --cdp $PORT <command>  (ALWAYS eval-click)"
echo "$MINT"
echo "Cleanup:  npx tsx src/scripts/seed-fe-characterization.ts --cleanup <USERID>"
