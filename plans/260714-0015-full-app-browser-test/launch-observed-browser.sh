#!/usr/bin/env bash
# Turnkey harness for the OBSERVED full-app browser test (run from repo root: Git Bash).
# Launches a HEADED Chromium (so the user watches) with auto-granted REAL mic (so the user can actually
# speak into voice), exposes CDP, mints a seeded test tenant, and prints the cookie to inject.
# Usage:  bash plans/260714-0015-full-app-browser-test/launch-observed-browser.sh
set -u
ROOT="C:/Users/Vincere/Desktop/Claude/AgentPortal"
PORT=9333
UDD="C:/Users/Vincere/AppData/Local/Temp/claude/observed-test-profile"

echo "== 1. Env check =="
for p in 5433 7100 5173; do (echo >/dev/tcp/127.0.0.1/$p) 2>/dev/null && echo "  :$p UP" || echo "  :$p DOWN  <-- start it (see plan.md Prerequisites)"; done

echo "== 2. Mint seeded test tenant (leads: Nghiep + Lam; a workspace Instruction; a product memory) =="
cd "$ROOT/MKTAgent" || exit 1
MINT=$(npx tsx src/orchestration/verify-p6-seed-session.ts 2>&1 | grep -E "USERID|COOKIE")
echo "$MINT"
COOKIE=$(echo "$MINT" | grep COOKIE | cut -d= -f2)

echo "== 3. Launch HEADED Chromium (real mic auto-granted, CDP :$PORT) =="
CHROME=$(ls -1 "C:/Users/Vincere/.agent-browser/browsers/"*/chrome.exe 2>/dev/null | head -1)
[ -z "$CHROME" ] && { echo "  chrome.exe not found under ~/.agent-browser/browsers"; exit 1; }
rm -rf "$UDD" 2>/dev/null
# --use-fake-ui-for-media-stream = auto-Allow the mic prompt (NO --use-fake-device: keep the REAL mic so
# the user can speak). Headed by default (visible window).
"$CHROME" --remote-debugging-port=$PORT --user-data-dir="$UDD" \
  --use-fake-ui-for-media-stream --no-first-run --no-default-browser-check \
  "http://localhost:5173" >/tmp/observed-chrome.log 2>&1 &
disown 2>/dev/null
sleep 4

echo "== 4. Inject session cookie + reload =="
agent-browser --cdp $PORT cookies set mkt_session "$COOKIE" --url "http://localhost:5173" --sameSite Lax 2>&1 | tail -1
agent-browser --cdp $PORT reload 2>&1 | tail -1
echo
echo "READY. Drive with:  agent-browser --cdp $PORT <command>"
echo "COOKIE=$COOKIE"
echo "Cleanup after:  agent-browser --cdp $PORT eval 'window.close()' ; npx tsx src/orchestration/verify-p6-seed-session.ts --cleanup <USERID>"
