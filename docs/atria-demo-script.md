# Atria Demo Script — Rehearsable One-Pager

**Target:** 7–9 minutes. **Audience:** Buyer demo. **Branch:** `pivot/video-content-farm`.

---

## Pre-Demo Setup (run BEFORE starting)

- **Backend:** `npm run dev` from `MKTAgent/` → `http://localhost:7100/health` responds
- **Web:** `cd web && npm run dev` → `http://localhost:5173` loads
- **Database:** Docker Postgres on `:5433` running (or `docker-compose up -d` from repo root)
- **Logged in:** Browser session open, signed in as `auto.agent.solution@gmail.com` (or `mkt_session` cookie injected)
- **Cron enabled:** `ENABLE_AUTONOMY_CRON=1` in `.env` (autonomy sweep every 2 min)
- **Safe posture:** Demo connections in DRY-RUN (no real social posts); only manual *live publish* on a real account if explicitly intended
- **TTS pre-warm:** (Optional) run one `/voice/tts` call ahead to cache latency (~5s first call)

---

## The Demo — 12 Steps (speak + click)

| # | Spoken Beat | Click Path | Time |
|---|-------------|-----------|------|
| **1** | "This is Atria, the Command Center. It's a live graph showing every AI agent working on your content." | Land on `/`; hover the neural graph; click the **Atria core** (center node) | 0:20 |
| **2** | "Let me ask Atria to plan a campaign in natural language — just like talking to a strategist." | In command bar type *"Tạo chiến dịch cho khoá học AI automation, đăng Facebook + Instagram"* → press **➤** | 0:40 |
| **3** | "Atria asks clarifying questions — in prose, not forms. I'll answer in free text." | Read the **Prose clarify** bubble; type an answer (e.g. "khoá học 5 tuần, bắt đầu tháng 8") → **Send** | 0:30 |
| **4** | "Here's the plan. Notice the **credit forecast** — this is exactly what Atria will spend. Let me save it as a flow." | On **PlanCard**: point to **credit forecast** number; click **Save** (confirm name) | 0:30 |
| **5** | "Now I'll set up the first campaign and run the content generation. Watch the workflow DAG light up as Atria works." | Click **Set up first campaign**; open the workspace drawer; click a post's workflow → click **▶ Execute** | 1:20 |
| **6** | "See the nodes coming alive on the graph? That's real-time — Atria is generating your content right now." | Switch to **Command Center**; watch the Atria core **"conducting"** (pulsing) while agents run (`use-agent-activity` SSE) | 0:20 |
| **7** | "The content is generated. If you want to refine it, you can ask Atria to adjust the tone in one word." | Back to post workflow; click the **concept node**; click **✨ Refine with AI**; type *"warmer tone"* → **Refine** | 0:40 |
| **8** | "Autonomy grants let you tell Atria: 'Prepare this post, but wait for me before publishing.' Two-step confirmation for safety." | Click a second **planned** post → click **⚡ Chuẩn bị** → read the **forecast** → click **Xác nhận** | 0:40 |
| **9** | "Notice the banner: 'Atria đang chuẩn bị…' It will run the full pipeline and **stop at review** — it never publishes without you." | Observe the **"preparing"** banner on the granted post; note the text "sẽ dừng ở bước review" | 0:20 |
| **10** | "You can also schedule posts. Set a time, and the scheduler publishes automatically when it's due." | On the first post's publisher gate, set **schedule** to ~3 min future → click **📅 Approve + schedule**; open **Scheduled** tab | 0:40 |
| **11** | "Finally, Impact. This is what you've actually achieved — measured spend, posts published, and audience reach. Atria reads it aloud." | Open **Impact** (`📈`); point to **Measured** vs **Estimated** sections; click the **🔊 speaker** next to "Impact" heading | 0:40 |
| **12** | (Optional) "And voice works on every reply — one at a time, so it doesn't get chaotic." | (If time) Back to chat; click 🔊 on an Atria bubble; note one-at-a-time playback + instant repeat (cached) | 0:20 |

**Total elapsed:** ~7–9 minutes (adjust Step 5 latency if media gen is slow).

---

## Safety Notes — Read Before Presenting

- **Manual publish is real.** At Step 10, scheduling/approving with a REAL connected account WILL publish to that platform when due. Keep demo accounts in DRY-RUN (safe/simulated) unless a live post is explicitly intended.
- **Autonomy is safe.** The granted run (Step 8) executes via the autonomy cron and **parks at the publisher gate** — it does NOT auto-publish. Only human approval at the gate triggers the final publish (Step 10 behavior). This is the hard-wired safety.
- **No burst posts.** Never fire multiple rapid real posts (Meta 24–48h ban risk). The scheduler naturally limits to 1 post/min by design.
- **TTS latency.** First `/voice/tts` call (~5s) is slower; repeats of the same text are cached (instant). Pre-warm before presenting if time-sensitive.
- **Text-only posts work.** A post with NO media (text only) publishes fine to all platforms. No special handling needed.

---

## If Something Goes Wrong

- **"Node won't light up"** → Refresh Command Center page; ensure `/events` SSE is open in DevTools Network tab.
- **"Autonomy not advancing"** → Check `ENABLE_AUTONOMY_CRON=1`; or manually call `runAutonomyOnce()` in server console.
- **"Video too slow"** → Skip Steps 5–6 media gen; use a pre-generated post or set a storyboard-only plan.
- **"Connection gate blocks"** → Expected if platform not connected. Click "🔌 Manage connections" and paste a safe token (or leave DRY).

---

## Post-Demo Cleanup

- **Delete test posts** (if any real posts fired): mark as drafted or delete from Scheduled.
- **Disable autonomy cron** (optional): `ENABLE_AUTONOMY_CRON=0` if you don't want it auto-running after the demo.
- **Clear cookies** if using a shared browser/session.
