import React from 'react';
import { AbsoluteFill, Audio, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { fontStack, themes } from '../quiz/styles.ts';
import { ComicPanelSequence } from './ComicPanel.tsx';
import { INTRO_FRAMES, OUTRO_FRAMES, PANEL_FRAMES, type NewsComicProps } from './types.ts';

const resolveSrc = (p: string): string =>
  p.startsWith('http') || p.startsWith('data:') ? p : staticFile(p);

const Intro: React.FC<{ title: string; variant: 'light' | 'dark' }> = ({ title, variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = themes[variant];
  const titleScale = spring({ frame, fps, config: { damping: 12, stiffness: 100 } });
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
      <div style={{ fontSize: 56, color: theme.muted, marginBottom: 16, fontWeight: 700 }}>
        Tin nóng tóm tắt 30s
      </div>
      <div
        style={{
          transform: `scale(${titleScale})`,
          fontSize: 92,
          fontWeight: 900,
          color: theme.primary,
          lineHeight: 1.15,
        }}
      >
        {title}
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ channelName?: string; variant: 'light' | 'dark' }> = ({ channelName, variant }) => {
  const theme = themes[variant];
  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        color: theme.primary,
        fontFamily: fontStack,
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        fontSize: 80,
        fontWeight: 900,
        gap: 24,
      }}
    >
      <div>Follow để xem tin mỗi ngày!</div>
      {channelName && <div style={{ color: theme.text, fontSize: 56 }}>@{channelName}</div>}
    </AbsoluteFill>
  );
};

export const NewsComic: React.FC<NewsComicProps> = ({ title, channelName, panels, variant, bgMusicPath }) => {
  const theme = themes[variant];
  const music = bgMusicPath ? resolveSrc(bgMusicPath) : undefined;
  const outroStart = INTRO_FRAMES + panels.length * PANEL_FRAMES;

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      {music && <Audio src={music} volume={0.18} />}

      <Sequence from={0} durationInFrames={INTRO_FRAMES} name="Intro">
        <Intro title={title} variant={variant} />
      </Sequence>

      {panels.map((p, i) => (
        <Sequence
          key={p.panel}
          from={INTRO_FRAMES + i * PANEL_FRAMES}
          durationInFrames={PANEL_FRAMES}
          name={`Panel${p.panel}`}
        >
          <ComicPanelSequence panel={p} variant={variant} />
        </Sequence>
      ))}

      <Sequence from={outroStart} durationInFrames={OUTRO_FRAMES} name="Outro">
        <Outro channelName={channelName} variant={variant} />
      </Sequence>
    </AbsoluteFill>
  );
};
