# n8n Code Node Snippets

## `parse-chatgpt-output.js`

Drop into an n8n **Code node** (Run Once for All Items). Parses raw ChatGPT Project reply → validated `{ storyboard, metadata }` or structured `errors[]`.

### Wiring — Folder mode (DEFAULT, user saves JSON files manually from ChatGPT chat)

```
[Cron: Tue+Fri 9:00 Asia/Bangkok]
    ↓
[Execute Command: ls inbox/*/storyboard.json | head -1]   // pick oldest unprocessed
    ↓
[Read Binary File] inbox/{slug}/storyboard.json  → parse to JSON
[Read Binary File] inbox/{slug}/metadata.json    → parse to JSON
    ↓
[Code: parse-chatgpt-output.js]   // INPUT: { storyboard, metadata } — Mode A
    ↓
[IF] {{ $json.ok }}
    ↓ true
    [Execute Command] pnpm tsx scripts/run-storyboard-v2.ts \
        --fixture inbox/{{ $json.dishSlug }}/storyboard.json \
        --images-dir inbox/{{ $json.dishSlug }}/panels \
        --out inbox/{{ $json.dishSlug }}/render.mp4
    [HTTP Request]   YouTube Data API v3 videos.insert (multipart)
    [Postgres]       INSERT INTO "VideoPublish" (...)
    [Move Folder]    inbox/{slug} → inbox/_done/{slug}
    [Gmail SMTP]     "Video uploaded private — review at studio.youtube.com/video/<id>"
    ↓ false
    [Gmail SMTP]     "Bundle rejected — fix and retry" + errors[] table
```

### Wiring — Webhook mode (FALLBACK, for testing or if user pastes raw chat)

```
[Webhook]  POST body: { "chatgptOutput": "<raw markdown>" }
    ↓
[Code: parse-chatgpt-output.js]   // INPUT: { chatgptOutput } — Mode B
    ↓
[IF] {{ $json.ok }}
    ↓ true
    [Write Binary File] inbox/{{ $json.dishSlug }}/storyboard.json
    [Write Binary File] inbox/{{ $json.dishSlug }}/metadata.json
    [Respond to Webhook] { ok: true, dishSlug, "next": "drop panels into inbox/{slug}/panels/" }
    ↓ false
    [Respond to Webhook] { ok: false, errors }
```

### When to use each mode

| Scenario | Use mode |
|---|---|
| User saves `storyboard.json` + `metadata.json` files manually from ChatGPT chat (current daily flow) | Folder mode (A) |
| User pastes raw ChatGPT reply text (testing, recovery, or hand-edited reply) | Webhook mode (B) |
| Folder is missing one of the JSON files | Folder mode fails fast on Read Binary File — fix the folder, not n8n |

Both modes route through the same `parse-chatgpt-output.js` validator. The only difference is the shape of the first item's `$json`. Validation rules (CTA, duration, panel count, hashtags, slug) are identical.

### Failure modes covered

| Error | `errors[].where` | Recovery |
|---|---|---|
| 0 or 1 fenced blocks | `parse` | Email user to re-prompt ChatGPT |
| JSON.parse fails | `storyboard.parse` / `metadata.parse` | Email with raw snippet for hand-fix |
| Schema violation | `panels[i].*` | Email with field path + expected/got |
| Outro missing CTA | `outro.*` | Email — ChatGPT drifted, re-emit |
| Duration sum off cap | `storyboard.totalDurationSec` | Email — ask for re-budget |

### Updating CTA literal

The literal subscribe sentence is hardcoded at the top:

```js
const CTA_NARRATION_SUFFIX = 'Bấm đăng ký kênh để xem thêm món Việt mỗi tuần!';
const CTA_LABEL_LINE2 = 'ĐĂNG KÝ KÊNH 🔔';
const CTA_DESCRIPTION_MARKER = '👉 Bấm đăng ký kênh';
```

If you change the CTA copy, update these constants AND the matching strings in `../../../260616-1319-storyboard-v2/prompts/chatgpt-project-instructions.md`. Keep both in sync — drift = silent CTA mismatch.
