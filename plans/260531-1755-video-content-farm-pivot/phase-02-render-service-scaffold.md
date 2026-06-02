# Phase 02 — Render Service Scaffold (Node + Remotion)

## Context Links
- Plan: [plan.md](plan.md)
- Previous: [phase-01](phase-01-postgres-schema.md)
- Remotion docs: https://www.remotion.dev/docs/

## Overview
- **Priority:** Critical (mọi pipeline cần render)
- **Status:** pending
- **Effort:** 1 day
- **Brief:** Node + Express service, expose `POST /render { template, props, jobId }`. Inside dùng Remotion CLI hoặc programmatic API render mp4. Trả về `{ videoPath }`.

## Key Insights
- **Remotion render trên CPU OK** ở volume 1-3 video/day (60-120s clip). Tốc độ ~2-5x realtime.
- **Bundle Remotion compositions vào image at build** — không bind-mount source (consistent với contract Docker cũ)
- **Job state qua Postgres** — `/render` blocking call OK ở volume này, không cần queue riêng
- Remotion `renderMedia()` programmatic API simpler hơn CLI subprocess

## Requirements

### Functional
- `POST /render` accepts `{ template: string, props: object, jobId: string }`, returns `{ videoPath: string }`
- Validate `template` against whitelist (avoid arbitrary code exec từ n8n)
- Write Postgres `run_log` per render (start/finish/error)
- Update `video_job.video_path` on success
- Serve rendered files via static route `/files/:filename` cho upload step download
- Healthcheck `GET /health`

### Non-functional
- Render timeout 5 min (longer → likely stuck, fail fast)
- Concurrent renders limit = 1 (CPU bound, serialize)
- Output dir `output/{jobId}.mp4`, mounted volume
- Logs JSON stdout for `docker logs` parseability

## Architecture

```
render-service/
├── package.json              # type=module, Node 20+
├── Dockerfile                # node:20-alpine + ffmpeg + chromium deps
├── tsconfig.json             # ESM, strict
├── src/
│   ├── server.ts             # Express bootstrap
│   ├── render.ts             # Remotion renderMedia wrapper
│   ├── templates/            # Remotion compositions (Phase 03+)
│   │   ├── Root.tsx          # registerRoot — registers all comps
│   │   └── index.tsx         # entry for Remotion CLI/programmatic
│   ├── db.ts                 # Prisma client singleton
│   ├── logger.ts             # JSON logger
│   └── queue.ts              # in-memory mutex (1 concurrent render)
├── output/                   # volume mount, mp4 outputs
└── public/                   # static assets cho compositions (fonts, bg music)
```

## API Contract

```
POST /render
Headers: X-Internal-Secret: ${RENDER_SECRET}
Body: { template: "QuizCountdown" | "NewsComic" | "HacksList",
        props: object,
        jobId: string }
Response 200: { videoPath: "/files/abc-123.mp4", durationMs: 45000 }
Response 4xx: { error: string }
Response 5xx: { error: string, retryable: boolean }
```

## Related Code Files
- **Create:** `render-service/package.json`, `Dockerfile`, `tsconfig.json`, `src/server.ts`, `src/render.ts`, `src/db.ts`, `src/logger.ts`, `src/queue.ts`, `src/templates/Root.tsx`, `src/templates/index.tsx`
- **Modify:** `docker-compose.yml` add `render-service` build context

## Implementation Steps
1. `cd render-service && npm init -y` → set `"type": "module"`
2. Install: `npm i express @remotion/renderer @remotion/cli @remotion/bundler remotion react react-dom @prisma/client zod`
3. Install dev: `npm i -D typescript @types/node @types/express tsx`
4. `tsconfig.json` ESM + JSX + strict
5. `src/templates/Root.tsx`: `<Composition id="QuizCountdown" .../>` — placeholder, real component Phase 03
6. `src/render.ts`:
   ```ts
   import { bundle } from "@remotion/bundler";
   import { renderMedia, selectComposition } from "@remotion/renderer";
   export async function render(template, props, jobId) {
     const bundled = await bundle({ entryPoint: "src/templates/index.tsx" });
     const composition = await selectComposition({ serveUrl: bundled, id: template, inputProps: props });
     const out = `output/${jobId}.mp4`;
     await renderMedia({ composition, serveUrl: bundled, codec: "h264", outputLocation: out, inputProps: props });
     return out;
   }
   ```
   (Cache `bundled` between calls to avoid re-bundle 30s every time)
7. `src/server.ts`: Express, validate body với Zod, mutex serialize, call `render()`, write logs to Postgres, return JSON
8. `Dockerfile`:
   ```
   FROM node:20-bullseye
   RUN apt-get update && apt-get install -y ffmpeg chromium-browser
   ENV CHROME_BIN=/usr/bin/chromium-browser
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci
   COPY . .
   RUN npm run build  # compile TS
   EXPOSE 7000
   CMD ["node", "dist/server.js"]
   ```
9. `docker-compose.yml`: add service, depends_on postgres, volume `./render-service/output:/app/output`
10. Smoke: `curl -X POST localhost:7000/render -H "X-Internal-Secret: $RENDER_SECRET" -d '{"template":"QuizCountdown","props":{},"jobId":"test"}'` (sẽ fail nếu template chưa có, OK — validate response shape)

## Todo List
- [ ] `render-service/` init Node ESM
- [ ] Install deps (express, remotion, prisma)
- [ ] `src/templates/Root.tsx` placeholder composition
- [ ] `src/render.ts` Remotion programmatic wrapper với bundle cache
- [ ] `src/server.ts` Express + Zod validation + mutex
- [ ] `src/db.ts` Prisma client
- [ ] `Dockerfile` (node + ffmpeg + chromium)
- [ ] Add to `docker-compose.yml`
- [ ] Smoke `/health` + dummy `/render` call
- [ ] Compile TS, check no errors

## Success Criteria
- `docker compose up render-service` healthy
- `GET /health` → 200
- `POST /render` validate input, return error gracefully if template unknown
- Postgres log row created cho mọi request

## Risk Assessment
- **Risk:** Chromium dependency bloat Docker image (~500MB) → **Accept**, không avoid được Remotion
- **Risk:** Bundle Remotion lần đầu chậm 20-30s → **Mitigation:** Bundle once at server boot, cache trong memory
- **Risk:** OOM trên 16GB RAM nếu render parallel → **Mitigation:** Mutex hard limit = 1

## Security Considerations
- `X-Internal-Secret` header check — n8n service gửi cùng secret
- Template whitelist (Zod enum) — không cho arbitrary composition id
- Static file route giới hạn ở `output/` dir, không path traversal (express built-in OK)

## Next Steps
→ Phase 03: Implement QuizCountdown composition cho thật
