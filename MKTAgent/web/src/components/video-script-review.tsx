// What the user actually approves at the video cost gate.
//
// Before 2026-07-21 the gate said "review the frames above" — video was rendered from storyboard
// frames that had already been generated, so there was something to look at. Video now renders from
// a `video_script` artifact, and the frames do not exist yet. Without this component the user is
// approving the most expensive step in the system while being shown nothing about it.
//
// Read-only on purpose: editing the script means patching the artifact and re-validating the
// duration arithmetic, which is a larger change. Showing it is the part that cannot wait.
// `imagePrompt` and `motion` are deliberately ENGLISH — they are model input, not user-facing copy.
// They are NOT rendered here: showing them produced a card that was half the user's language and
// half English. `brief` and `narration` come back in the run's language, whatever that language is,
// because buildAgentPrompt pins the language rule into the contract — so this works for Vietnamese,
// Indonesian, Korean or anything else with no per-language code here.
interface Shot {
  index: number;
  brief?: string;
  narration?: string;
  durationSec: number;
}

export interface VideoScript {
  platform?: string;
  hook?: string;
  cta?: string;
  totalDurationSec?: number;
  shots?: Shot[];
}

// Veo is priced per second of rendered clip. Kept in sync with cost/node-cost.ts `videoClipCost`.
const VEO_USD_PER_SEC = 0.05;

export function VideoScriptReview({ script }: { script: VideoScript }): JSX.Element | null {
  const shots = script.shots ?? [];
  if (!shots.length) return null;

  const totalSec = script.totalDurationSec ?? shots.reduce((n, s) => n + s.durationSec, 0);
  const estUsd = totalSec * VEO_USD_PER_SEC;

  return (
    <div className="video-script-review">
      <div className="vsr-head">
        <strong>🎬 Video script</strong>
        <span className="muted small">
          {shots.length} shot{shots.length === 1 ? '' : 's'} · {totalSec}s
          {script.platform ? ` · cut for ${script.platform}` : ''}
        </span>
      </div>

      {script.hook && (
        <p className="small vsr-line"><span className="muted">Hook (first 3s):</span> {script.hook}</p>
      )}

      <ol className="vsr-shots">
        {shots.map((s) => (
          <li key={s.index} className="vsr-shot">
            <div className="vsr-shot-head">
              <span className="vsr-num">{s.index + 1}</span>
              <span className="vsr-dur">{s.durationSec}s</span>
            </div>
            <div className="vsr-shot-body">
              {s.narration && <p className="vsr-narration">“{s.narration}”</p>}
              {s.brief && <p className="small muted">{s.brief}</p>}
            </div>
          </li>
        ))}
      </ol>

      {script.cta && (
        <p className="small vsr-line"><span className="muted">Closing CTA:</span> {script.cta}</p>
      )}

      <p className="muted small vsr-cost">
        Approving renders {shots.length} keyframe{shots.length === 1 ? '' : 's'} and {totalSec}s of
        video — roughly <strong>${estUsd.toFixed(2)}</strong> of video generation, plus the images.
        Nothing has been generated yet.
      </p>
    </div>
  );
}
