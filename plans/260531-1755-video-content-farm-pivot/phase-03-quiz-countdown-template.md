# Phase 03 — QuizCountdown Remotion Template

## Context Links
- Plan: [plan.md](plan.md)
- Previous: [phase-02](phase-02-render-service-scaffold.md)
- Remotion compositions: https://www.remotion.dev/docs/composition

## Overview
- **Priority:** Critical (output đầu tiên người xem thấy)
- **Status:** pending
- **Effort:** 1 day
- **Brief:** Remotion composition `QuizCountdown.tsx`. Vertical 1080x1920 (Shorts/Reels). 10 câu × ~6s = 60s. Mỗi câu: question text + 4 options + 5s countdown + reveal correct answer + 1s pause.

## Key Insights
- **Vertical 9:16 mandatory** cho YT Shorts + FB Reels
- **2 template variants** (light + dark theme) tránh "same template = spam" flag từ YT/FB
- **Audio sync**: TTS audio path inject vào props, Remotion `Audio` component sync với frames
- **Captions** burned-in (people xem mute trên feed) — Remotion text overlay
- **30 FPS** (60 quá nặng cho CPU)

## Requirements

### Functional
- Input props shape:
  ```ts
  type QuizProps = {
    title: string;
    questions: Array<{
      id: number;
      question: string;
      options: [string, string, string, string];
      correctIndex: 0 | 1 | 2 | 3;
      questionAudioPath: string;   // path to TTS mp3
      revealAudioPath: string;
    }>;
    variant: 'light' | 'dark';
    bgMusicPath?: string;
  };
  ```
- Render duration tự động tính từ `questions.length × 6s + intro 3s + outro 2s`
- Intro: title + "Cùng chơi nào!"
- Per-question: question read (TTS) + options đếm ngược 5s + reveal correct (highlight green)
- Outro: "Subscribe để xem thêm!" + channel name

### Non-functional
- 1080x1920, 30 FPS, h264, ~3-5 Mbps target
- Render 60s video < 3 min trên CPU 8-core
- Tất cả font local (không CDN runtime) — fonts in `public/fonts/`

## Architecture

```
render-service/src/templates/
├── Root.tsx                          # đăng ký compositions
├── index.tsx                         # entry
├── quiz/
│   ├── QuizCountdown.tsx             # root composition
│   ├── QuizIntro.tsx                 # sequence 0-3s
│   ├── QuizQuestion.tsx              # repeated sequence per question
│   ├── QuizOutro.tsx                 # final sequence
│   ├── CountdownRing.tsx             # SVG ring countdown
│   ├── styles.ts                     # theme tokens (light/dark)
│   └── types.ts                      # QuizProps type
```

Sequences: Remotion `<Sequence from={frame} durationInFrames={frames}>`

## Related Code Files
- **Create:** Tất cả files trong `render-service/src/templates/quiz/`
- **Modify:** `render-service/src/templates/Root.tsx` đăng ký `QuizCountdown` composition
- **Assets:** `render-service/public/fonts/Inter-Bold.ttf`, sound effects in `public/sfx/` (tick.mp3, ding.mp3 — free từ freesound.org)

## Implementation Steps
1. Tạo dir `src/templates/quiz/`
2. `types.ts`: `QuizProps` + per-question type
3. `styles.ts`: 2 themes
   ```ts
   export const themes = {
     light: { bg: '#FFF8E7', primary: '#FF6B35', text: '#1a1a1a' },
     dark:  { bg: '#1a1a2e', primary: '#FFD23F', text: '#fff' }
   };
   ```
4. `QuizIntro.tsx`: title fade in + animated emoji + audio cue
5. `QuizQuestion.tsx`:
   - Frame 0-30 (1s): question text typewriter
   - Frame 30-180 (5s): options + `<CountdownRing duration={5}>` + tick SFX
   - Frame 180-210 (1s): reveal correct (color flash + ding)
6. `CountdownRing.tsx`: SVG circle với `strokeDashoffset` animate via `interpolate(frame, [0, durationFrames], [0, circumference])`
7. `QuizOutro.tsx`: CTA subscribe + outro music sting
8. `QuizCountdown.tsx`: compose intro + map questions → QuizQuestion sequences + outro
   ```tsx
   export const QuizCountdown: React.FC<QuizProps> = ({ questions, variant, ...}) => (
     <AbsoluteFill style={{ background: themes[variant].bg }}>
       <Sequence from={0} durationInFrames={90}><QuizIntro .../></Sequence>
       {questions.map((q, i) => (
         <Sequence key={q.id} from={90 + i * 180} durationInFrames={180}>
           <QuizQuestion {...q} variant={variant} />
         </Sequence>
       ))}
       <Sequence from={90 + questions.length * 180}><QuizOutro .../></Sequence>
     </AbsoluteFill>
   );
   ```
9. Register trong `Root.tsx` với `calculateMetadata` để compute duration từ props
10. Local test: `npx remotion preview` (cần X server hoặc Docker headless skip)
11. Test render: `npx remotion render QuizCountdown out.mp4 --props=fixtures/quiz-sample.json`

## Todo List
- [ ] `types.ts` định nghĩa QuizProps
- [ ] `styles.ts` 2 themes
- [ ] `QuizIntro.tsx`
- [ ] `CountdownRing.tsx` SVG animation
- [ ] `QuizQuestion.tsx` (typewriter + countdown + reveal)
- [ ] `QuizOutro.tsx` CTA
- [ ] `QuizCountdown.tsx` compose sequences
- [ ] Register composition với `calculateMetadata`
- [ ] Fixture JSON sample (`fixtures/quiz-sample.json`)
- [ ] Local render test → mp4 output
- [ ] Verify trên YT/FB Reels aspect (1080x1920)

## Success Criteria
- `npx remotion render QuizCountdown` → mp4 60s 1080x1920
- Audio đồng bộ với visual (no drift)
- Cả 2 variants render thành công
- File size < 20 MB cho 60s clip

## Risk Assessment
- **Risk:** Font rendering kém trên Linux Docker → **Mitigation:** Bundle Inter/Be Vietnam Pro local + `<font.loadFont()>` Remotion helper
- **Risk:** Audio drift sau N sequence → **Mitigation:** Dùng `useAudioData` + `audioPath` per sequence, không stream long file
- **Risk:** Tiếng Việt diacritics bị thiếu glyph → **Mitigation:** Font Be Vietnam Pro (full VN range)

## Security Considerations
- Composition props validated by Zod ở server boundary (Phase 02)
- Không exec arbitrary code trong props

## Next Steps
→ Phase 04: n8n workflow gọi `/render` với props sinh từ Gemini + Edge TTS
