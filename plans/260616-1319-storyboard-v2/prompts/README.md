# ChatGPT Storyboard Prompts — File Index

## Active (v4 — ChatGPT Project mode, 2026-06-17)

This is the **current** workflow. Use these two files.

| File | Where it goes | When |
|---|---|---|
| [`chatgpt-project-instructions.md`](./chatgpt-project-instructions.md) | Paste into ChatGPT Project → Instructions panel | Once per Project setup |
| [`per-dish-message.txt`](./per-dish-message.txt) | Send template as message in Project chat | One per dish (2× / week) |

ChatGPT replies with exactly **two `\`\`\`json` fenced blocks**: `storyboard.json` + `metadata.json`.

The n8n parser at [`../../260616-1936-youtube-automation/n8n-snippets/parse-chatgpt-output.js`](../../260616-1936-youtube-automation/n8n-snippets/parse-chatgpt-output.js) extracts + validates + emits structured data for the rest of the n8n workflow.

### Daily workflow (all in one ChatGPT Project chat)

```
1. Open ChatGPT Project "VN Cooking Storyboards"

2. MESSAGE 1 — Send dish brief from per-dish-message.txt template (4-5 lines)
   ↓ ChatGPT replies with two ```json blocks (storyboard + metadata)
   ↓ Copy each block, save as:
      inbox/<YYYYMMDD>-<dish-slug>/storyboard.json
      inbox/<YYYYMMDD>-<dish-slug>/metadata.json
   ↓ Eyeball check: 9-14 panels, sum 45-60s, outro CTA, hashtags×3

3. (optional) Edit message — "Đổi panel 7 sang 6s..."
   ↓ ChatGPT re-emits both JSON blocks with edits applied
   ↓ Overwrite saved files

4. MESSAGE 2 — Send "generate panels" (or "tạo ảnh", "OK render")
   ↓ ChatGPT iterates panels 1..N, for each:
       prints header "PANEL NN — save as panel-NN.png"
       generates image with exact imagePrompt from storyboard.json
   ↓ Download each image, rename to match header
   ↓ Drop all into inbox/<YYYYMMDD>-<dish-slug>/panels/

5. (optional) Image regen — "Regen panel 5" or "Tạo lại panel 11, thêm khói nhiều hơn"
   ↓ ChatGPT regens only that one image
   ↓ Replace the file

6. Done. n8n cron Tue + Fri 9am Asia/Bangkok:
       reads inbox/*/storyboard.json + metadata.json + panels/*.png
       → validates via parse-chatgpt-output.js (Mode A)
       → renders via run-storyboard-v2.ts
       → uploads YouTube private
       → emails Studio review link
```

Total per dish: ~10-15 minutes (mostly waiting for ChatGPT image gen).

## Deprecated (kept for reference, do not use for new work)

| File | Reason |
|---|---|
| `chatgpt-storyboard-v2.md` | Original v2 monolith — pre-automation |
| `chatgpt-storyboard-v3-automation.md` | v3 monolith — too long for ChatGPT Project Instructions |
| `chatgpt-storyboard-v3-phase1-creative.txt` | v3 split — required 2 manual paste rounds per dish |
| `chatgpt-storyboard-v3-phase2-structured.txt` | v3 split — same reason |

The v3 files were patched 2026-06-17 with duration cap (45-60s) + outro CTA rules before being deprecated, so if you ever fall back to them the constraints are intact.

## Constraints summary (v4 enforces all)

- `panels.length ∈ [9, 14]`
- `panel.durationSec ∈ {4, 6, 8}` (Veo 3.1 lite hard constraint)
- `sum(durationSec) ∈ [45, 60]` (YouTube Shorts cap)
- `panels[0].kind === "intro"`, `panels[last].kind === "outro"`
- Outro: `line2 === "ĐĂNG KÝ KÊNH 🔔"`, narration ends with subscribe CTA, `durationSec ∈ {6, 8}`
- `metadata.hashtags.length === 3`
- `metadata.descriptionVi` contains CTA paragraph `"👉 Bấm đăng ký kênh..."`
- `dishSlug` matches `/^[a-z0-9-]+$/`

All enforced at three layers:
1. **ChatGPT Project Instructions** — model self-verifies before output
2. **n8n parser** (`parse-chatgpt-output.js`) — rejects non-compliant payload with structured `errors[]`
3. **(future) `scripts/process-inbox.ts` Zod validator** — final gate before render (phase 02 of YouTube automation plan)

## n8n workflow shape (high-level)

```
[Cron Tue+Fri 9am]
    ↓
[Read Folder: inbox/*/chatgpt-reply.md]  (or Webhook input)
    ↓
[Code: parse-chatgpt-output.js]
    ↓
[IF: $json.ok]
    ├─ true → [Write storyboard.json] → [Write metadata.json] → [Run render-storyboard-v2] → [Upload YouTube private] → [Email Studio link]
    └─ false → [Email "ChatGPT reply rejected" with errors[]] → STOP
```

## Why ChatGPT Project (vs single long prompt)

| Dimension | v3 long prompt | v4 Project mode |
|---|---|---|
| Setup cost | 0 (paste each time) | 30s one-time |
| Per-dish work | Paste 5KB prompt + edit dish vars | Type 5-line message |
| Drift risk | Low (full context every time) | Medium (Project remembers but may compress) — mitigated by self-verify checklist |
| Output shape | 9 markdown sections + JSON + YAML | 2 JSON blocks only — clean parse |
| YAML parsing in n8n | Needs js-yaml (not built-in) | Native JSON.parse |
| Variation requests | Re-paste full prompt | Reply in same thread "đổi panel 7..." |
| ChatGPT context fit | Tight on long prompts | Generous — chat history available for follow-ups |
