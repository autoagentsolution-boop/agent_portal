import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

type Props = {
  durationInFrames: number;
  size: number;
  stroke: number;
  color: string;
  trackColor: string;
  label?: string;
  labelColor?: string;
};

export const CountdownRing: React.FC<Props> = ({
  durationInFrames,
  size,
  stroke,
  color,
  trackColor,
  label,
  labelColor,
}) => {
  const frame = useCurrentFrame();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = interpolate(frame, [0, durationInFrames], [0, circumference], {
    extrapolateRight: 'clamp',
  });
  const secondsLeft = Math.max(0, Math.ceil((durationInFrames - frame) / 30));

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: labelColor ?? color,
          fontSize: size * 0.45,
          fontWeight: 800,
        }}
      >
        {label ?? secondsLeft}
      </div>
    </div>
  );
};
