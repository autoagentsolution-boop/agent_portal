import React from 'react';
import { AbsoluteFill, Audio, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { fontStack, themes } from '../quiz/styles.ts';
import { HackCardSequence } from './HackCard.tsx';
import { HACK_FRAMES, INTRO_FRAMES, OUTRO_FRAMES, type HacksListProps } from './types.ts';

const resolveSrc = (p: string): string =>
  p.startsWith('http') || p.startsWith('data:') ? p : staticFile(p);

const Intro: React.FC<{ topic: string; intro: string; variant: 'light' | 'dark'; audioPath?: string }> = ({
  topic,
  intro,
  variant,
  audioPath,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = themes[variant];
  const scale = spring({ frame, fps, config: { damping: 12, stiffness: 110 } });

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        color: theme.text,
        fontFamily: fontStack,
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        padding: 80,
      }}
    >
      <div style={{ fontSize: 56, color: theme.muted, marginBottom: 24, fontWeight: 700 }}>{topic}</div>
      <div
        style={{
          transform: `scale(${scale})`,
          fontSize: 110,
          fontWeight: 900,
          color: theme.primary,
          lineHeight: 1.15,
        }}
      >
        {intro}
      </div>
      {audioPath && <Audio src={resolveSrc(audioPath)} />}
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ outro: string; channelName?: string; variant: 'light' | 'dark'; audioPath?: string }> = ({
  outro,
  channelName,
  variant,
  audioPath,
}) => {
  const theme = themes[variant];
  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        color: theme.text,
        fontFamily: fontStack,
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        gap: 24,
        padding: 80,
      }}
    >
      <div style={{ fontSize: 80, color: theme.primary, fontWeight: 900 }}>{outro}</div>
      {channelName && <div style={{ fontSize: 56, fontWeight: 700 }}>@{channelName}</div>}
      <div style={{ position: 'absolute', bottom: 60, fontSize: 32, color: theme.muted }}>
        Stock footage from Pexels
      </div>
      {audioPath && <Audio src={resolveSrc(audioPath)} />}
    </AbsoluteFill>
  );
};

export const HacksList: React.FC<HacksListProps> = ({ topic, intro, outro, channelName, hacks, variant, introAudioPath, outroAudioPath }) => {
  const theme = themes[variant];
  const outroStart = INTRO_FRAMES + hacks.length * HACK_FRAMES;

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <Sequence from={0} durationInFrames={INTRO_FRAMES} name="Intro">
        <Intro topic={topic} intro={intro} variant={variant} audioPath={introAudioPath} />
      </Sequence>

      {hacks.map((h, i) => (
        <Sequence key={h.id} from={INTRO_FRAMES + i * HACK_FRAMES} durationInFrames={HACK_FRAMES} name={`Hack${h.id}`}>
          <HackCardSequence hack={h} index={i} total={hacks.length} variant={variant} />
        </Sequence>
      ))}

      <Sequence from={outroStart} durationInFrames={OUTRO_FRAMES} name="Outro">
        <Outro outro={outro} channelName={channelName} variant={variant} audioPath={outroAudioPath} />
      </Sequence>
    </AbsoluteFill>
  );
};
