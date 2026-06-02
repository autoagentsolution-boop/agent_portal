import React from 'react';
import { AbsoluteFill, Audio, Img, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { fontStack, themes } from '../quiz/styles.ts';
import type { ComicPanel as PanelData } from './types.ts';

const resolveSrc = (p: string): string =>
  p.startsWith('http') || p.startsWith('data:') ? p : staticFile(p);

type Props = { panel: PanelData; variant: 'light' | 'dark' };

export const ComicPanelSequence: React.FC<Props> = ({ panel, variant }) => {
  const frame = useCurrentFrame();
  const theme = themes[variant];
  const imgScale = interpolate(frame, [0, 30], [1.05, 1], { extrapolateRight: 'clamp' });
  const captionOpacity = interpolate(frame, [20, 40], [0, 1], { extrapolateRight: 'clamp' });
  const captionY = interpolate(frame, [20, 40], [30, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <Img
          src={resolveSrc(panel.imagePath)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${imgScale})`,
          }}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          background: 'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.85) 100%)',
          pointerEvents: 'none',
        }}
      />

      <AbsoluteFill
        style={{
          padding: 80,
          justifyContent: 'flex-end',
          fontFamily: fontStack,
        }}
      >
        <div
          style={{
            opacity: captionOpacity,
            transform: `translateY(${captionY}px)`,
            color: '#fff',
            fontSize: 60,
            fontWeight: 800,
            lineHeight: 1.2,
            textShadow: '0 4px 24px rgba(0,0,0,0.85)',
          }}
        >
          {panel.caption}
        </div>
      </AbsoluteFill>

      {panel.captionAudioPath && (
        <Sequence from={0} durationInFrames={135}>
          <Audio src={resolveSrc(panel.captionAudioPath)} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
