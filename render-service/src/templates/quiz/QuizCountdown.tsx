import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { QuizIntro } from './QuizIntro.tsx';
import { QuizOutro } from './QuizOutro.tsx';
import { QuizQuestion } from './QuizQuestion.tsx';
import { themes } from './styles.ts';
import {
  INTRO_FRAMES,
  OUTRO_FRAMES,
  QUESTION_FRAMES,
  type QuizProps,
} from './types.ts';

const bgMusicSrc = (p?: string): string | undefined => {
  if (!p) return undefined;
  return p.startsWith('http') || p.startsWith('data:') ? p : staticFile(p);
};

export const QuizCountdown: React.FC<QuizProps> = ({
  title,
  channelName,
  questions,
  variant,
  bgMusicPath,
}) => {
  const theme = themes[variant];
  const music = bgMusicSrc(bgMusicPath);
  const outroStart = INTRO_FRAMES + questions.length * QUESTION_FRAMES;

  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      {music && <Audio src={music} volume={0.18} />}

      <Sequence from={0} durationInFrames={INTRO_FRAMES} name="Intro">
        <QuizIntro title={title} variant={variant} />
      </Sequence>

      {questions.map((q, i) => (
        <Sequence
          key={q.id}
          from={INTRO_FRAMES + i * QUESTION_FRAMES}
          durationInFrames={QUESTION_FRAMES}
          name={`Q${i + 1}`}
        >
          <QuizQuestion question={q} index={i} total={questions.length} variant={variant} />
        </Sequence>
      ))}

      <Sequence from={outroStart} durationInFrames={OUTRO_FRAMES} name="Outro">
        <QuizOutro channelName={channelName} variant={variant} />
      </Sequence>
    </AbsoluteFill>
  );
};
