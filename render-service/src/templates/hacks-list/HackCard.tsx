import React from 'react';
import { AbsoluteFill, Audio, Sequence, Video, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { fontStack, themes } from '../quiz/styles.ts';
import type { HackItem } from './types.ts';

const resolveSrc = (p: string): string =>
  p.startsWith('http') || p.startsWith('data:') ? p : staticFile(p);

type Props = { hack: HackItem; index: number; total: number; variant: 'light' | 'dark' };

export const HackCardSequence: React.FC<Props> = ({ hack, index, total, variant }) => {
  const frame = useCurrentFrame();
  const theme = themes[variant];
  const titleScale = interpolate(frame, [0, 20], [0.9, 1], { extrapolateRight: 'clamp' });
  const detailsOpacity = interpolate(frame, [40, 70], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <Video src={resolveSrc(hack.clipPath)} muted loop style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>

      <AbsoluteFill style={{ background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />

      <AbsoluteFill
        style={{
          padding: 80,
          fontFamily: fontStack,
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: '50%',
              background: theme.primary,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 60,
              fontWeight: 900,
              boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              transform: `scale(${titleScale})`,
            }}
          >
            #{hack.id}
          </div>
          <div style={{ color: theme.primary, fontSize: 40, fontWeight: 700 }}>
            Mẹo {index + 1} / {total}
          </div>
        </div>

        <div
          style={{
            transform: `scale(${titleScale})`,
            fontSize: 88,
            fontWeight: 900,
            lineHeight: 1.15,
            textShadow: '0 4px 24px rgba(0,0,0,0.85)',
          }}
        >
          {hack.title}
        </div>

        <div style={{ flex: 1 }} />

        <div
          style={{
            opacity: detailsOpacity,
            background: 'rgba(0,0,0,0.6)',
            borderLeft: `8px solid ${theme.primary}`,
            padding: '32px 40px',
            fontSize: 52,
            fontWeight: 600,
            lineHeight: 1.3,
            borderRadius: 16,
          }}
        >
          {hack.details}
        </div>
      </AbsoluteFill>

      {hack.narrationAudioPath && (
        <Sequence from={0} durationInFrames={360}>
          <Audio src={resolveSrc(hack.narrationAudioPath)} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
