# ChatGPT Storyboard Prompt — Schema v2 (JSON-enabled)

> Dùng prompt này trong ChatGPT (GPT-4 hoặc o-series) để tạo storyboard cooking video. Output gồm 2 phần: markdown cho human QA + JSON cho pipeline.

## Recommended tweaks trước khi dùng (tuỳ chọn)
- [ ] Pin section E về **Veo 3.1 Light** (hiện đang generic Veo/Kling/Runway/Pika → ra prompt yếu cho từng provider)
- [ ] `motionDirection` ngôn ngữ: giữ Việt HAY force English (Veo i2v hiểu English chính xác hơn)
- [ ] Production mode bỏ section C (grid) + F (master video) để tiết kiệm ~1500 tokens output

---

## PROMPT

```
You are a Vietnamese culinary director, recipe developer, CGI food storyboard designer, and video prompt engineer.

Create a premium CGI 3D stop-motion food preparation storyboard and a matching video generation script for this dish:

Dish: [TÊN MÓN]
Serving size: [SỐ PHẦN ĂN / SỐ TÔ / SỐ NGƯỜI]
Cuisine style: [ẨM THỰC]
Main ingredients: [DANH SÁCH NGUYÊN LIỆU, NẾU CÓ]

If ingredients or quantities are missing, infer a realistic standard recipe for the selected serving size.

CORE REQUIREMENTS:
The storyboard must not use a fixed number of panels, but it must have at least 9 panels.
Use more panels when the dish has broth, sauce, marinade, roasting, frying, simmering, grilling, steaming, complex toppings, or multiple assembly stages.

The image must show a logical cooking process from ingredients to finished dish.

IMPORTANT TEXT RULE:
Do not render technical production words inside the image.
Do not put these words in the image:
"hero shot", "visual direction", "camera", "panel", "scene", "instruction", "comment", "CGI", "stop motion", "exploded view", "final hero".

Text inside the image must only be useful cooking information for viewers.

Each image panel should contain only:
Line 1: short Vietnamese cooking step title
Line 2: key ingredients + quantity
Line 3: short preparation method or cooking time

For the first and final dish image:
Use only the dish name or a simple food title.
Do not write "hero shot".
Example:
"PHỞ BÒ"
or
"PHỞ BÒ HOÀN THIỆN"

Good label examples:
"CHẦN XƯƠNG"
"Xương bò 1.5kg"
"Chần 5 phút · Rửa sạch"

"RANG GIA VỊ"
"Quế 2 thanh · Hồi 3 cánh"
"Rang khô 2–3 phút"

"HẦM NƯỚC DÙNG"
"Xương · Hành · Gừng · Gia vị"
"Hầm 3–4 giờ"

Bad label examples:
"HERO SHOT"
"Visual direction"
"Camera orbit"
"Show ingredients"
"Final hero"
"CGI stop motion"

COOKING LOGIC:
Start with a finished dish preview using only the dish name as text.
Then show the real preparation process in order:

* ingredient overview
* washing / cleaning / cutting / soaking / slicing
* roasting aromatics or spices
* preparing broth / sauce / marinade / seasoning base
* cooking main components
* preparing noodles / rice / starch / vegetables / toppings
* assembling into bowl / plate / pot / pan
* adding broth / sauce / garnish / herbs / toppings
* final completed dish using only a simple food title

Do not skip important cooking stages.
Do not merge different cooking techniques into one panel.
Do not overload one panel with too many actions.
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
Ingredients floating, falling, jumping, or swirling naturally.
Clean luxury Vietnamese culinary presentation.
Consistent bowl, pot, plate, lighting, color grading, and background across all panels.

STORYBOARD LAYOUT:
Create a clean multi-panel storyboard.
The number of panels must be at least 9.
The layout must adapt to the selected number of panels.
Each panel must be clearly separated.
Each panel must contain only the compact Vietnamese cooking label.
Do not include technical notes, camera notes, comments, or production instructions inside the image.

VISUAL CONSTRAINTS:
No messy layout.
No chaotic composition.
No wrong ingredients.
No duplicated major ingredients.
No distorted bowls, pots, plates, or utensils.
No deformed food.
No random text.
No unreadable Vietnamese text.
No overly long labels.
No technical production terms inside the image.
No Westernized version unless requested.
No ramen, udon, spaghetti, or unrelated ingredients unless the dish requires them.
No plastic-looking food.
No flat lighting.
No low-quality rendering.
No excessive splash.
No ingredient morphing.

REQUIRED OUTPUT:

A. RECIPE & PANEL STRATEGY
Explain how many panels are needed and why.
Minimum panel count is 9.

B. COOKING STEP BREAKDOWN TABLE
Create a table with:
Step number | Image text label | Ingredients & quantity | Preparation method | Cooking purpose | Visual content | Video motion direction

C. FULL STORYBOARD IMAGE PROMPT
Write one complete image generation prompt for the full multi-panel storyboard.
The image prompt must include the exact cooking labels to appear in the image.
The image prompt must not allow technical production words to appear in the image.

D. INDIVIDUAL PANEL IMAGE PROMPTS
Write one standalone image prompt for each panel.
Each prompt must include:

* panel number
* exact Vietnamese image label
* ingredients and quantity
* preparation method
* visual composition
* premium cinematic 3D food style

E. VIDEO GENERATION SCRIPT
Write a complete scene-by-scene video script for Veo 3.1.
The video script must include:

* total video duration (seconds)
* timeline (per-scene start/end in seconds)
* visual action
* camera movement
* object movement
* Vietnamese narration (1-2 sentences per scene, 5-7 seconds spoken)
* on-screen Vietnamese text
* sound design
* transition to next scene (cut | fade | zoom | swipe)

F. MASTER VIDEO PROMPT
Write one complete video generation prompt based on the storyboard.
The video prompt can contain camera, CGI, stop-motion, clockwise orbit, and motion instructions.
These technical words are allowed in the video prompt, but not inside the generated image text.

G. STRUCTURED JSON OUTPUT
After all markdown sections above, output a single JSON object inside a ```json fenced code block.
The JSON must be valid, parseable, and use Unicode for Vietnamese (no escape sequences).
The JSON consolidates sections B, D, and E into machine-readable form for the rendering pipeline.

Schema:

{
  "schemaVersion": "v2",
  "dishName": string,
  "dishSlug": string,                   // kebab-case ASCII slug, e.g. "bo-kho"
  "servingSize": string,
  "cuisineStyle": string,
  "totalDurationSec": number,
  "musicMood": string,                  // for Suno music gen, e.g. "warm cinematic Vietnamese folk"
  "panels": [
    {
      "index": number,                  // 1-based, sequential
      "kind": "intro" | "step" | "outro",
      "imageTextLabel": {
        "line1": string,                // ALL-CAPS Vietnamese title, e.g. "RANG GIA VỊ"
        "line2": string | null,         // ingredients + quantity inline
        "line3": string | null          // preparation method or time
      },
      "ingredients": [
        { "name": string, "amount": string }
      ],
      "preparation": string,
      "purpose": string,
      "visualContent": string,          // scene description from table column 6
      "imagePrompt": string,            // FULL standalone prompt from section D
      "motionDirection": string,        // from table column 7, English preferred for Veo
      "narrationVi": string,            // Vietnamese voiceover, 1-2 sentences
      "onScreenTextVi": string,         // text overlay if different from imageTextLabel
      "durationSec": number,            // scene duration in seconds, typically 5-8
      "transition": "cut" | "fade" | "zoom" | "swipe"
    }
  ]
}

Rules for JSON:
- panels.length >= 9
- panels[0].kind === "intro" with imageTextLabel.line1 = dish name only, line2/line3 null
- panels[last].kind === "outro" with imageTextLabel.line1 = dish name + "HOÀN THIỆN"
- All other panels have kind === "step"
- Sum of all durationSec must equal totalDurationSec
- dishSlug must be ASCII kebab-case (e.g. "Phở Bò" → "pho-bo", "Bò Kho" → "bo-kho")
- Do not omit or rename fields. Do not add extra fields.
```

## Validation checklist sau khi nhận output

- [ ] JSON parse được không lỗi
- [ ] `panels.length >= 9`
- [ ] `panels[0].kind === "intro"`, `panels[last].kind === "outro"`
- [ ] `sum(durationSec) === totalDurationSec`
- [ ] `dishSlug` chỉ chứa `[a-z0-9-]`
- [ ] Mỗi panel có đủ: `imagePrompt`, `motionDirection`, `narrationVi`
- [ ] `narrationVi` mỗi panel ~5-7s đọc (≈ 15-25 chữ)

## Test dish gợi ý
- Phở Bò (đã có baseline schema v1 để so sánh)
- Bò Kho (đã có table B mẫu, dùng làm fixture đầu tiên)
- Bún Bò Huế (test panel >12)
- Cơm Tấm Sườn Bì Chả (test multi-component assembly)
