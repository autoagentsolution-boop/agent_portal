import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Series,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { fontStack } from '../quiz/styles.ts';
import { FPS, WIDTH, type PanelV2Render } from './types.ts';

const resolveSrc = (p: string): string => (p.startsWith('http') ? p : staticFile(p));

const FADE_FRAMES = 12;

const PanelMedia: React.FC<{ panel: PanelV2Render }> = ({ panel }) => {
  if (panel.motionPath) {
    return (
      <OffthreadVideo
        src={resolveSrc(panel.motionPath)}
        muted
        pauseWhenBuffering
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
  }
  return (
    <Img
      src={resolveSrc(panel.imagePath)}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
};

const PanelLabelOverlay: React.FC<{ panel: PanelV2Render }> = ({ panel }) => {
  // Image already has Vietnamese label baked in by ChatGPT — overlay is OPT-IN only when
  // the operator wants a secondary on-screen badge. v2.0 default: no overlay (images self-explain).
  // Keeping this hook in place so future per-panel onScreenText can show without re-rendering pipeline.
  return null;
};

const PanelScene: React.FC<{ panel: PanelV2Render; durationInFrames: number }> = ({ panel, durationInFrames }) => {
  const frame = useCurrentFrame();
  const fadeInOpacity =
    panel.transition === 'cut'
      ? 1
      : interpolate(frame, [0, FADE_FRAMES], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fadeOutOpacity = interpolate(
    frame,
    [Math.max(0, durationInFrames - FADE_FRAMES), durationInFrames],
    [1, panel.transition === 'cut' ? 1 : 0.85],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const opacity = Math.min(fadeInOpacity, fadeOutOpacity);

  return (
    <AbsoluteFill style={{ background: '#000', opacity }}>
      <AbsoluteFill>
        <PanelMedia panel={panel} />
      </AbsoluteFill>
      {panel.audioPath && <Audio src={resolveSrc(panel.audioPath)} volume={1.0} />}
      <PanelLabelOverlay panel={panel} />
    </AbsoluteFill>
  );
};

export const PanelSequence: React.FC<{ panels: PanelV2Render[] }> = ({ panels }) => {
  return (
    <Series>
      {panels.map((p) => {
        const durationInFrames = Math.round(p.durationSec * FPS);
        return (
          <Series.Sequence key={p.index} durationInFrames={durationInFrames}>
            <PanelScene panel={p} durationInFrames={durationInFrames} />
          </Series.Sequence>
        );
      })}
    </Series>
  );
};

// Debug overlay — shows panel index + label, only when REMOTION_DEBUG=1
export const PanelDebugOverlay: React.FC<{ panel: PanelV2Render }> = ({ panel }) => (
  <div
    style={{
      position: 'absolute',
      top: 16,
      left: 16,
      padding: '6px 12px',
      background: 'rgba(0,0,0,0.55)',
      color: '#fff',
      fontFamily: fontStack,
      fontSize: 22,
      fontWeight: 700,
      borderRadius: 6,
    }}
  >
    #{panel.index} · {panel.imageTextLabel.line1}
  </div>
);

export const TOTAL_WIDTH = WIDTH;
