import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { fontStack, themes } from './styles.ts';
import type { QuizVariant } from './types.ts';

type Props = { channelName?: string; variant: QuizVariant };

export const QuizOutro: React.FC<Props> = ({ channelName, variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = themes[variant];
  const ctaScale = spring({ frame, fps, config: { damping: 10, stiffness: 120 } });
  const channelOpacity = interpolate(frame, [20, 40], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        color: theme.text,
        fontFamily: fontStack,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 32,
        padding: 80,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          transform: `scale(${ctaScale})`,
          fontSize: 96,
          fontWeight: 900,
          color: theme.primary,
        }}
      >
        Subscribe để xem thêm!
      </div>
      {channelName && (
        <div style={{ opacity: channelOpacity, fontSize: 60, fontWeight: 700 }}>
          @{channelName}
        </div>
      )}
    </AbsoluteFill>
  );
};
