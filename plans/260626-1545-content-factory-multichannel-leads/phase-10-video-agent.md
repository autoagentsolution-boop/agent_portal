# Phase A5 — Video Agent + Video Posting (5 nền)

**Priority:** LOW (đắt+chậm nhất, làm cuối) · **Status:** pending · Depends: A1+A2+A4

## Context
Phần nặng nhất. 2 mảng: (1) GEN video từ storyboard, (2) POST video lên 5 nền (cơ chế khác ảnh hẳn).
Tái dùng full render-service pipeline (Veo + TTS + nhạc).

## Mục tiêu
Storyboard 5 ảnh (A4) → video clip ngắn (chuyển động + narration + nhạc) → đăng lên 5 nền (cơ chế video mỗi
nền khác).

## Key insights — GEN (verified video farm)
- render-service: Veo i2v (storyboard→motion), TTS (edge/gcloud/azure), music-library, normalize. Đã prod ở
  video farm ([[project_storyboard_v2_pivot]], [[project_youtube_auto_publish]]).
- Veo Tier 1 cap 2-5 RPM → 1-2 video/ngày. Cost ~$0.50-1.00/clip.
- Marketing clip NGẮN hơn video farm (15-30s vs 69s) → rẻ hơn.

## Key insights — POST (research, mỗi nền KHÁC ảnh)
| Nền | Cơ chế video |
|-----|-------------|
| Facebook | `/{page}/videos`. Non-resumable (file_url/multipart) ≤1GB/20min; Resumable INIT/TRANSFER/FINISH ≤1.5GB/45min |
| Instagram | Reels container `media_type=REELS` + `video_url` public → poll `status_code=FINISHED` → publish |
| Threads | `media_type=VIDEO` + `video_url` public → đợi xử lý → publish |
| LinkedIn | `/rest/videos?action=initializeUpload`. >200MB = MULTIPART_UPLOAD (chia part, thu ETag, finalize) |
| X | `/2/media/upload` chunked INIT/APPEND/FINALIZE (≤5MB/chunk) + poll STATUS → tạo tweet |

→ Video adapter build RIÊNG từng nền, KHÔNG tái dùng image adapter. Research sâu từng nền khi build.

## Requirements
**Functional:** /generate {assetType:video, productId, narrative} → storyboard (A4) → Veo i2v mỗi frame →
ghép + TTS narration + nhạc → 1 clip → URL. + post-scheduler video branch mỗi nền.
**Non-functional:** async (video gen lâu, n8n không chờ 2 phút → job queue + poll); cost cap; retry.

## Architecture
```
GEN: POST /generate {assetType:video} → storyboard 5 ảnh → Veo i2v → concat + TTS + music → clip URL
     (async: trả jobId → n8n poll status → khi xong lấy URL)
POST: post-scheduler video branch per platform (mỗi nền cơ chế riêng ở bảng trên)
     IF video asset → route theo platform → upload video (chunked/resumable/url) → publish
```

## Related files
- CREATE: `marketing-content-service/src/agents/video.ts` (gen) + job queue (async).
- REUSE: render-service Veo + tts + music + storyboard motion (trim).
- CREATE: post-scheduler video branches (5 nền) — adapter mới mỗi nền.
- MODIFY: calendar — cột `assetType` (image|video), `videoFile`.

## Implementation steps (chia 2 đợt)
**Đợt 1 — GEN:**
1. video.ts: storyboard (A4) → Veo i2v mỗi frame → motion clips.
2. Concat + TTS narration (KB tone) + music-library → 1 clip.
3. Async job: /generate trả jobId; /status/{jobId} poll; n8n chờ qua poll loop.
4. Test gen 1 clip AgentPortal 15-30s.
**Đợt 2 — POST (research từng nền trước):**
5. FB video: resumable INIT/TRANSFER/FINISH.
6. IG Reels: container media_type=REELS + video_url → poll → publish.
7. Threads video: media_type=VIDEO + video_url → publish.
8. LinkedIn video: /rest/videos initializeUpload (+ multipart nếu >200MB).
9. X video: /2/media/upload chunked INIT/APPEND/FINALIZE + poll.
10. post-scheduler: assetType=video → route per platform. e2e test.

## Todo
- [ ] video.ts gen (storyboard→Veo→concat→TTS→music)
- [ ] Async job queue + status poll
- [ ] Test gen 1 clip
- [ ] FB video adapter (resumable)
- [ ] IG Reels adapter
- [ ] Threads video adapter
- [ ] LinkedIn video adapter (multipart)
- [ ] X video adapter (chunked)
- [ ] post-scheduler video routing + e2e

## Success criteria
Narrative → clip 15-30s (chuyển động + narration + nhạc, bám brand); đăng được lên ≥3 nền video thật.

## Risks
- Veo RPM cap → throughput thấp (1-2/ngày). Marketing cadence phải phù hợp.
- Video post mỗi nền 1 cơ chế phức tạp (chunked/resumable/poll) → nhiều bug như image phase.
- Cost: $0.50-1/clip + Veo retry. Cap chặt.
- Async: n8n poll loop (Wait + loop) — phức tạp hơn image (synchronous).

## Security
- API keys (Veo/Azure) trong service env. Token post reuse các nền (đã có).

## Next
Hoàn tất content factory đầy đủ (image→infographic→storyboard→video) + post mọi định dạng 5 nền.
