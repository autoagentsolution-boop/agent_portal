# Phase 09 — Multi-Voice Routing

## Context Links
- Plan: [plan.md](plan.md)
- Previous: [phase-08](phase-08-life-hacks-pipeline.md)
- Edge TTS voices VN: https://github.com/rany2/edge-tts (search "vi-VN")
- Google Cloud TTS VN: https://cloud.google.com/text-to-speech/docs/voices

## Overview
- **Priority:** Medium (variety reduce spam-flag risk + viewer fatigue)
- **Status:** pending
- **Effort:** 1 day
- **Brief:** Mở rộng `/tts/edge` thành `/tts` generic router. Add Google Cloud TTS provider. Voice selection logic: role-based (narrator/character A/character B/host) + pipeline-aware default mapping.

## Key Insights
- 16 voices total (9 Edge + 7 GCloud) → đủ variety cho 90 video/tháng
- Voice selection rule-based, không cần ML — JSON config
- GCloud TTS cost ~$4/1M chars, 1 video ~1500 chars → $0.006/video → ~$0.5/mo at 90 video/mo
- Edge TTS free but no API SLA — primary uses GCloud, Edge fallback

## Requirements

### Functional
- `POST /tts` body: `{ text, voiceId, jobId, role?: 'narrator'|'character_a'|'character_b'|'host' }`
- Provider abstraction: `voiceId` prefix routes — `edge:vi-VN-HoaiMyNeural`, `gcloud:vi-VN-Wavenet-A`
- Voice pool config:
  ```json
  voices.json
  {
    "narrators": ["gcloud:vi-VN-Neural2-A", "edge:vi-VN-HoaiMyNeural", "gcloud:vi-VN-Neural2-D"],
    "host_male": ["edge:vi-VN-NamMinhNeural", "gcloud:vi-VN-Wavenet-B"],
    "host_female": ["edge:vi-VN-HoaiMyNeural", "gcloud:vi-VN-Wavenet-A"],
    "character_a": ["edge:vi-VN-NamMinhNeural"],
    "character_b": ["gcloud:vi-VN-Neural2-D"]
  }
  ```
- Selection: per `(jobId, role)` deterministic via `hash(jobId + role) % pool.length` → 1 video luôn có voice consistent per role, nhưng video sau khác
- Cache: hash(provider + voice + text) trong `asset` table
- Quiz pipeline: host = rotating voice / question reader & answer reader có thể khác (2 roles)
- News-comic pipeline: narrator only (1 role)
- Life hacks pipeline: host = rotating, optional "expert quote" role thứ 2

### Non-functional
- TTS failover: GCloud 5xx → fallback Edge auto retry
- Audio normalization: ffmpeg post-process `-filter:a loudnorm` để consistent volume across voices

## Architecture

```
n8n: HTTP /tts { text, role, jobId }
                  ↓
render-service /tts router:
  - resolve voiceId from voices.json + hash(jobId+role)
  - hash(voiceId+text) → check asset cache
  - hit: return path
  - miss:
      - prefix === 'gcloud' → google.tts.synthesize()
      - prefix === 'edge'   → subprocess edge-tts
      - on 5xx gcloud, fallback to edge same voice gender
  - ffmpeg normalize loudness
  - save mp3, INSERT asset
  - return { audioPath, voiceUsed, provider }
```

## Related Code Files
- **Modify:** `render-service/src/server.ts` rename `/tts/edge` → `/tts`, deprecate old route
- **Create:** `render-service/src/tts/router.ts` (provider abstraction)
- **Create:** `render-service/src/tts/edge.ts` (existing logic, refactor)
- **Create:** `render-service/src/tts/gcloud.ts` (new)
- **Create:** `render-service/src/tts/voices.json` (config)
- **Create:** `render-service/src/audio/normalize.ts` (ffmpeg wrapper)
- **Modify:** All 3 n8n workflows — switch from `/tts/edge` to `/tts` with `role` param

## Implementation Steps
1. Google Cloud:
   - Enable "Cloud Text-to-Speech API"
   - Create service account JSON key → mount as Docker secret OR base64 in env
   - Install `npm i @google-cloud/text-to-speech`
2. `gcloud.ts`:
   ```ts
   const client = new TextToSpeechClient({ credentials: JSON.parse(B64_KEY) });
   export async function synthesizeGCloud(text, voiceName) {
     const [resp] = await client.synthesizeSpeech({
       input: { text }, voice: { name: voiceName, languageCode: 'vi-VN' },
       audioConfig: { audioEncoding: 'MP3' }
     });
     return resp.audioContent;
   }
   ```
3. `router.ts`:
   ```ts
   import voices from './voices.json';
   export function selectVoice(jobId, role) {
     const pool = voices[role] || voices.narrators;
     const idx = hash(jobId + role) % pool.length;
     return pool[idx];
   }
   export async function ttsRoute(text, voiceId, jobId) {
     const [provider, name] = voiceId.split(':');
     const hash = sha256(provider + name + text);
     const cached = await db.asset.findUnique({ where: { hash } });
     if (cached) return cached.path;
     try {
       const audio = provider === 'gcloud'
         ? await synthesizeGCloud(text, name)
         : await synthesizeEdge(text, name);
       const path = `output/audio/${hash}.mp3`;
       await writeFile(path, audio);
       await normalize(path);
       await db.asset.create({ data: { hash, kind: 'audio', provider, path, ... }});
       return path;
     } catch (e) {
       if (provider === 'gcloud') return synthesizeEdge(text, fallbackEdgeVoice(name));
       throw e;
     }
   }
   ```
4. `normalize.ts`: spawn `ffmpeg -i in.mp3 -filter:a loudnorm -y out.mp3`
5. n8n workflow update:
   - Quiz: question reader role=`host_female`, reveal role=`narrators` (different per video)
   - News-comic: narrator role=`narrators`
   - Life hacks: host = rotating between host_male/host_female by day
6. Audit: run each pipeline 1 lần → inspect output mp4 → confirm voice variety qua spot-check 5 videos

## Todo List
- [ ] Google Cloud TTS API enabled + service account key
- [ ] `gcloud.ts` wrapper
- [ ] `router.ts` voice selection + provider abstraction
- [ ] `voices.json` config với 16 voices
- [ ] `normalize.ts` ffmpeg loudnorm
- [ ] `/tts` endpoint thay `/tts/edge`
- [ ] Update 3 n8n workflows pass `role` param
- [ ] Spot-check 5 videos: voice variety verified
- [ ] Cost tracking: GCloud TTS spend ≤ $1/mo

## Success Criteria
- 3 pipelines run, each output uses different voice per role
- Audio loudness consistent (-16 LUFS target via loudnorm)
- Fallback works: simulate GCloud 503 → falls back to Edge silently
- Cache hit: same text + voice → returns cached, no API call

## Risk Assessment
- **Risk:** GCloud service account key leak → **Mitigation:** Mount as Docker secret OR base64 env, gitignore strict, audit `.env` không commit
- **Risk:** Loudnorm 2-pass tốn 5-10s/audio → **Accept:** total ≤ 60s overhead per video, OK
- **Risk:** Edge TTS subprocess crash → **Mitigation:** spawn timeout 30s, kill + retry 1x
- **Risk:** Voice variety không thực sự noticeable → **Accept:** at least counters "same voice all videos" spam-flag heuristic

## Security Considerations
- GCloud key: base64-encoded env var hoặc `secrets/` dir gitignored
- Voice ID validation: chỉ accept voiceId match regex `^(gcloud|edge):[a-z]{2}-[A-Z]{2}-[A-Za-z0-9-]+$`

## Next Steps
→ Phase 10: Logging UI + retry hardening (operations layer)
