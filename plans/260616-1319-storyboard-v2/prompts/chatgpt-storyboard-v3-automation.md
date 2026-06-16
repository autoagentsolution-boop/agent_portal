# ChatGPT Storyboard Prompt — Schema v3 (Automation-Ready Bundle)

> **Use case**: bạn dùng prompt này trong ChatGPT Plus (DALL-E 3 hoặc GPT-4o image gen) một lần / ngày, 15–30 phút, để tạo 1 dish bundle hoàn chỉnh drop vào `inbox/<YYYYMMDD>-<dish-slug>/`. n8n local sau đó pick lên render + upload YouTube private.
>
> **Khác v2**: thêm Section H (YouTube metadata) + Section I (folder spec). Phần A–G giữ nguyên — pipeline đã consume.

## Workflow của bạn (mỗi ngày sản xuất)

1. Mở ChatGPT, paste prompt bên dưới, thay `[TÊN MÓN]` etc.
2. ChatGPT chạy ra sections A–I.
3. Copy JSON từ section G → save `inbox/<YYYYMMDD>-<dish-slug>/storyboard.json`
4. Copy metadata YAML từ section H → save `inbox/<YYYYMMDD>-<dish-slug>/metadata.yaml`
5. Trong ChatGPT image gen mode, paste lần lượt 12 prompts từ section D → tải về → đặt tên `panel-01.png` ... `panel-12.png` → bỏ vào `inbox/<YYYYMMDD>-<dish-slug>/panels/`
6. Done. n8n cron Thứ 3 + Thứ 6 sẽ pick folder, render, upload YouTube private, email link để bạn review.

## Folder convention (n8n watches)

```
inbox/
  20260617-bun-cha/
    storyboard.json           # Section G output (schema-v2.ts validated)
    metadata.yaml             # Section H output (YouTube fields)
    panels/
      panel-01.png            # Section D image 1
      panel-02.png
      ...
      panel-12.png
    thumbnail.png             # OPTIONAL: custom 1280×720 thumbnail (mặc định pipeline tự cắt panel-01)
    README.md                 # OPTIONAL: notes của bạn
  _done/
    20260615-bo-kho/          # n8n moves here sau khi upload thành công
```

Naming rule: `<YYYYMMDD>-<dish-slug>` — n8n sort theo tên (oldest first) để pick queue order.

---

## PROMPT (paste vào ChatGPT)

````
You are a Vietnamese culinary director, recipe developer, CGI food storyboard designer, video prompt engineer, and YouTube content strategist.

Create a premium CGI 3D stop-motion food preparation storyboard, matching video generation script, AND complete YouTube publishing metadata for this dish:

Dish: [TÊN MÓN]
Serving size: [SỐ PHẦN ĂN / SỐ TÔ / SỐ NGƯỜI]
Cuisine style: [ẨM THỰC]
Main ingredients: [DANH SÁCH NGUYÊN LIỆU, NẾU CÓ]
Target audience: [VN home cooks 25-45, hoặc tuỳ chỉnh]
YouTube channel niche: [ví dụ: "Vietnamese cooking shorts, premium cinematic style"]

If ingredients or quantities are missing, infer a realistic standard recipe for the selected serving size.

CORE REQUIREMENTS:
The storyboard must not use a fixed number of panels, but it must have at least 9 panels and at most 14.
Use more panels when the dish has broth, sauce, marinade, roasting, frying, simmering, grilling, steaming, complex toppings, or multiple assembly stages.

The image must show a logical cooking process from ingredients to finished dish.

IMPORTANT TEXT RULE:
Do not render technical production words inside the image.
Do not put these words in the image:
"hero shot", "visual direction", "camera", "panel", "scene", "instruction", "comment", "CGI", "stop motion", "exploded view", "final hero".

Text inside the image must only be useful cooking information for viewers.

Each image panel should contain only:
Line 1: short Vietnamese cooking step title (ALL CAPS)
Line 2: key ingredients + quantity
Line 3: short preparation method or cooking time

For the first and final dish image:
Use only the dish name or a simple food title.
Example:
"BÒ KHO"
or
"BÒ KHO HOÀN THIỆN"

COOKING LOGIC:
Start with a finished dish preview using only the dish name as text.
Then show the real preparation process in order:
- ingredient overview
- washing / cleaning / cutting / soaking / slicing
- roasting aromatics or spices
- preparing broth / sauce / marinade / seasoning base
- cooking main components
- preparing noodles / rice / starch / vegetables / toppings
- assembling into bowl / plate / pot / pan
- adding broth / sauce / garnish / herbs / toppings
- final completed dish using only a simple food title

Do not skip important cooking stages.
Do not merge different cooking techniques into one panel.
Each panel must be visually clear and logically connected to the next one.

IMAGE STYLE:
Premium high-end CGI visual quality.
3D stop-motion food commercial style.
Handcrafted claymation-inspired food texture.
Cinematic warm golden lighting.
Dark smoky background.
Rustic wooden table.
Shallow depth of field.
Elegant steam.
Subtle golden motion trails.
Clean luxury Vietnamese culinary presentation.
Consistent bowl, pot, plate, lighting, color grading, and background across all panels.

VISUAL CONSTRAINTS (DO NOT):
No messy layout, chaotic composition, wrong/duplicated/morphing ingredients.
No distorted bowls, deformed food, random text, unreadable Vietnamese, overly long labels.
No technical production terms inside the image.
No ramen/udon/spaghetti unless dish requires them.
No plastic-looking food, flat lighting, low-quality rendering, excessive splash.

REQUIRED OUTPUT (all sections, in order):

A. RECIPE & PANEL STRATEGY
Explain panel count and why.

B. COOKING STEP BREAKDOWN TABLE
Step number | Image text label | Ingredients & quantity | Preparation method | Cooking purpose | Visual content | Video motion direction

C. SKIP (not needed in production mode)

D. INDIVIDUAL PANEL IMAGE PROMPTS
Write one standalone image prompt for each panel, ordered 1..N.
Each prompt MUST include:
- exact 3-line Vietnamese label baked into the image
- ingredients + quantity visible
- preparation method visual hint
- premium cinematic 3D stop-motion food style
- consistent lighting + background with previous panels
- 9:16 vertical aspect ratio (1080×1920)
Format each as:
```
PANEL n image prompt:
<prompt text>
```

E. VIDEO GENERATION SCRIPT (per-panel)
For each panel, include in the JSON (section G):
- visual action
- camera movement
- object movement
- Vietnamese narration (~5-7s spoken, ≈15-25 words)
- transition (cut | fade | zoom | swipe)
- durationSec (4 | 6 | 8 only — Veo 3.1 lite constraint)

F. SKIP

G. STRUCTURED JSON OUTPUT (storyboard.json)
After all markdown sections above, output a single JSON object inside a ```json fenced code block.
Schema:

{
  "schemaVersion": "v2",
  "dishName": string,
  "dishSlug": string,                   // kebab-case ASCII, e.g. "bun-cha"
  "servingSize": string,
  "cuisineStyle": string,
  "totalDurationSec": number,
  "musicMood": string,
  "panels": [
    {
      "index": number,                  // 1-based, sequential
      "kind": "intro" | "step" | "outro",
      "imageTextLabel": {
        "line1": string,                // ALL-CAPS Vietnamese
        "line2": string | null,
        "line3": string | null
      },
      "ingredients": [{ "name": string, "amount": string }],
      "preparation": string,
      "purpose": string,
      "visualContent": string,
      "imagePrompt": string,
      "motionDirection": string,        // English preferred for Veo
      "narrationVi": string,
      "onScreenTextVi": string,
      "durationSec": number,            // MUST be 4, 6, or 8 — Veo 3.1 lite/fast rejects other values
      "transition": "cut" | "fade" | "zoom" | "swipe"
    }
  ]
}

Rules for JSON:
- panels.length between 9 and 14 inclusive
- panels[0].kind === "intro" with imageTextLabel.line1 = dish name only, line2/line3 null
- panels[last].kind === "outro" with imageTextLabel.line1 = dish name + " HOÀN THIỆN"
- All middle panels have kind === "step"
- Each durationSec MUST be 4, 6, or 8 (no 5 or 7 — Veo API constraint)
- Sum of durationSec must equal totalDurationSec
- dishSlug must be ASCII kebab-case (e.g. "Phở Bò" → "pho-bo")
- Use Unicode for Vietnamese (no escape sequences)
- Do not omit or rename fields. Do not add extra fields.

H. YOUTUBE METADATA (metadata.yaml)
Output a single YAML block inside a ```yaml fenced code block, ready to save as metadata.yaml.

Required fields:
```yaml
title: string              # ≤100 chars, VN-first, attention-grabbing, include dish name + key hook
                           # Example: "Bò Kho tan trong miệng — Bí quyết quán Sài Gòn 30 năm 🥢"
descriptionVi: |
  string                   # 200-500 words. Open with hook (1-2 sentences). List nguyên liệu chính.
                           # Tóm tắt cách làm 5-8 bullets. Kết bằng CTA subscribe.
                           # Add timestamps if applicable.
                           # End with hashtags-as-text 3-5 lines.
descriptionEn: |
  string                   # 100-200 words English summary for international viewers.
tags:                      # 8-15 YouTube tags, mix VN + EN, single words + phrases
  - "bò kho"
  - "Vietnamese beef stew"
  - "công thức bò kho"
  - "Vietnamese cooking"
  # etc.
category: "Howto & Style"  # YouTube category — usually this one for cooking
defaultLanguage: "vi"
thumbnailPrompt: string    # OPTIONAL: DALL-E prompt for 1280x720 thumbnail if you want custom
                           # If empty, pipeline uses panel-01.png cropped.
hashtags:                  # 3 hashtags ONLY (max 3 indexed by YouTube) — chosen for best CTR
  - "#vietnamesefood"
  - "#bokho"
  - "#cookingshorts"
publishMode: "private"     # ALWAYS private for now — n8n uploads private + emails link for review.
                           # You manually flip to public after viewing.
```

I. FOLDER BUNDLE INSTRUCTIONS (printed for human, not consumed by pipeline)
Print this checklist verbatim at the very end:

```
✅ DONE. Save the following to inbox/<TODAY-YYYYMMDD>-<dishSlug>/:

[ ] storyboard.json   ← from section G ```json block
[ ] metadata.yaml     ← from section H ```yaml block
[ ] panels/panel-01.png through panel-NN.png
      ← run each prompt from section D in ChatGPT image mode (or DALL-E/Nano-Banana)
      ← download, rename to panel-01.png, panel-02.png, ...
      ← all 9:16 vertical (1080×1920), PNG, < 5MB each

When folder is ready, n8n cron will pick it up automatically next Tue/Fri at 9am Asia/Bangkok.
```
````

---

## Validation checklist sau khi nhận output

- [ ] JSON parse được không lỗi
- [ ] `panels.length` between 9 and 14
- [ ] `panels[0].kind === "intro"`, `panels[last].kind === "outro"`
- [ ] Mỗi `durationSec ∈ {4, 6, 8}` — KHÔNG có 5 hoặc 7 (Veo API reject)
- [ ] `sum(durationSec) === totalDurationSec`
- [ ] `dishSlug` chỉ chứa `[a-z0-9-]`
- [ ] `narrationVi` mỗi panel ~5-7s đọc (≈ 15-25 chữ)
- [ ] YAML metadata parse được
- [ ] Có đủ 9-14 image prompts trong section D

## Quy tắc đặt tên folder

- Folder: `inbox/<YYYYMMDD>-<dishSlug>/` — ngày bạn upload bundle (không phải ngày publish)
- Ví dụ: `inbox/20260617-bun-cha/`, `inbox/20260620-com-tam/`
- n8n sort folders bằng tên → oldest pickup first → consistent queue order

## Test dish gợi ý (next 4 weeks)

| Tuần | Thứ 3 | Thứ 6 |
|------|-------|-------|
| 1 | Bún Chả Hà Nội | Cơm Tấm Sườn Bì Chả |
| 2 | Bún Bò Huế | Cá Kho Tộ |
| 3 | Bánh Xèo | Chả Cá Lã Vọng |
| 4 | Hủ Tiếu Nam Vang | Bánh Cuốn |
