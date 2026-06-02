import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { fontStack, themes } from './styles.ts';
import type { QuizVariant } from './types.ts';

type Props = { title: string; variant: QuizVariant };

export const QuizIntro: React.FC<Props> = ({ title, variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = themes[variant];

  const titleScale = spring({ frame, fps, config: { damping: 12, stiffness: 100 } });
  const taglineOpacity = interpolate(frame, [40, 60], [0, 1], { extrapolateRight: 'clamp' });
  const taglineY = interpolate(frame, [40, 60], [40, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        color: theme.text,
        fontFamily: fontStack,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 80,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          transform: `scale(${titleScale})`,
          fontSize: 110,
          fontWeight: 900,
          color: theme.primary,
          lineHeight: 1.1,
          marginBottom: 40,
        }}
      >
        {title}
      </div>
      <div
        style={{
          opacity: taglineOpacity,
          transform: `translateY(${taglineY}px)`,
          fontSize: 56,
          fontWeight: 700,
        }}
      >
        Cùng chơi nào!
      </div>
    </AbsoluteFill>
  );
};
