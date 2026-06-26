# Phase A1 — marketing-content-service Scaffold (tách folder)

**Priority:** MEDIUM · **Status:** pending · Depends: none (nền cho A3-A5)

## Context
User chốt: TÁCH folder riêng khỏi video farm để sửa không ảnh hưởng. render-service đã là HTTP service có
module tái dùng: `src/image/nano-banana.ts` (+vision-verify), `src/storyboard/` (adapter-v2/motion-v2/
schema-v2/validate), `src/tts/` (edge/gcloud/router), `src/audio/music-library`, `src/routes/`.

## Mục tiêu
Tạo `marketing-content-service/` — service riêng, copy 3 module lõi từ render-service, thu gọn bỏ phần
video-farm-specific (cooking, bo-kho, food CGI). Expose HTTP route cho n8n gọi.

## Key insights
- KHÔNG build từ 0 — copy module đã verified. Bỏ logic cooking/explode/storyboard-v2-food.
- Marketing asset ngắn/rẻ hơn video farm → thu gọn pipeline.
- Service riêng = sửa marketing không đụng video farm (đúng yêu cầu user).

## Requirements
**Functional:** service Express/Fastify expose POST /generate (asset-type: infographic|storyboard|video);
copy nano-banana image gen + vision-verify; copy tts nếu video cần narration; health/preflight route.
**Non-functional:** Dockerfile riêng; env riêng (GEMINI_API_KEY, Veo, Azure TTS keys); KHÔNG share state với
render-service.

## Architecture
```
marketing-content-service/
  src/
    image/        ← copy nano-banana.ts + vision-verify.ts (trim)
    tts/          ← copy router/edge/gcloud (chỉ nếu video cần)
    storyboard/   ← copy adapter-v2 schema (trim food-specific)
    routes/
      generate.ts ← POST /generate {assetType, productId, narrative} → URL(s)
      health.ts
    products/     ← Product Knowledge Base (phase A2)
    server.ts
  Dockerfile
  package.json
```
n8n → HTTP POST → service → gen → trả URL → Sheet.

## Related files
- CREATE: `marketing-content-service/` (toàn bộ scaffold).
- COPY-FROM: `render-service/src/image/`, `src/tts/`, `src/storyboard/` (trim).
- CREATE: Dockerfile + compose service (cùng VPS).
- CREATE: `docs/marketing-content-service.md`.

## Implementation steps
1. Scaffold `marketing-content-service/` (package.json, tsconfig, server.ts, Dockerfile).
2. Copy nano-banana.ts + vision-verify.ts → trim (bỏ cooking refs).
3. Copy tts router (giữ tối thiểu cho video narration; có thể defer tới A5).
4. Copy storyboard schema/validate → trim food-specific.
5. routes/generate.ts: skeleton dispatch theo assetType (infographic/storyboard/video) — impl ở A3-A5.
6. routes/health.ts + preflight (verify API keys).
7. Dockerfile + compose service. Build + chạy. Test health.
8. n8n: HTTP node mẫu gọi /health → verify reachable.

## Todo
- [ ] Scaffold service + server + Dockerfile
- [ ] Copy + trim image module (nano-banana + vision-verify)
- [ ] Copy + trim storyboard schema
- [ ] generate.ts dispatch skeleton
- [ ] health/preflight route
- [ ] compose + build + run
- [ ] n8n reach test
- [ ] docs/marketing-content-service.md

## Success criteria
Service chạy Docker, /health OK, /generate skeleton nhận request; n8n gọi được; KHÔNG đụng render-service.

## Risks
- Copy-drift: fix chung (nano-banana) phải sync 2 bản. Chấp nhận (user ưu tiên độc lập hơn DRY).
- API keys: GEMINI/Veo/Azure — reuse từ video farm env hay tách? → tách env riêng cho service.

## Security
- API keys trong service env (không commit). Service chỉ nhận request nội bộ (n8n), không expose public.

## Next
A2 Product Knowledge Base (input cho mọi asset gen). Rồi A3 infographic.
