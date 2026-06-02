import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { CountdownRing } from './CountdownRing.tsx';
import { fontStack, themes } from './styles.ts';
import type { QuizQuestion as QuizQuestionType, QuizVariant } from './types.ts';

const READ_FRAMES = 30;
const COUNTDOWN_FRAMES = 150;
const REVEAL_FRAMES = 0;

type Props = {
  question: QuizQuestionType;
  index: number;
  total: number;
  variant: QuizVariant;
};

const audioSrc = (p?: string): string | undefined => {
  if (!p) return undefined;
  return p.startsWith('http') || p.startsWith('data:') ? p : staticFile(p);
};

export const QuizQuestion: React.FC<Props> = ({ question, index, total, variant }) => {
  const frame = useCurrentFrame();
  const theme = themes[variant];
  const phaseRevealStart = READ_FRAMES + COUNTDOWN_FRAMES;
  const isReveal = frame >= phaseRevealStart;

  const questionAudio = audioSrc(question.questionAudioPath);
  const revealAudio = audioSrc(question.revealAudioPath);

  const questionOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        color: theme.text,
        fontFamily: fontStack,
        padding: 80,
        gap: 32,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          color: theme.muted,
          fontSize: 40,
          fontWeight: 700,
        }}
      >
        Câu {index + 1} / {total}
      </div>

      <div
        style={{
          opacity: questionOpacity,
          fontSize: 72,
          fontWeight: 800,
          lineHeight: 1.2,
          color: theme.text,
        }}
      >
        {question.question}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          marginTop: 40,
          flex: 1,
        }}
      >
        {question.options.map((opt, i) => {
          const isCorrect = i === question.correctIndex;
          const highlight = isReveal && isCorrect;
          return (
            <div
              key={i}
              style={{
                background: highlight ? theme.correct : theme.card,
                color: highlight ? '#fff' : theme.text,
                fontSize: 52,
                fontWeight: 700,
                padding: '32px 40px',
                borderRadius: 24,
                display: 'flex',
                alignItems: 'center',
                gap: 32,
                boxShadow: highlight ? '0 0 60px rgba(34,197,94,0.45)' : '0 8px 24px rgba(0,0,0,0.12)',
                transition: 'none',
              }}
            >
              <span
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  background: highlight ? '#fff' : theme.primary,
                  color: highlight ? theme.correct : '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 900,
                  fontSize: 36,
                  flexShrink: 0,
                }}
              >
                {String.fromCharCode(65 + i)}
              </span>
              <span>{opt}</span>
            </div>
          );
        })}
      </div>

      {!isReveal && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Sequence from={READ_FRAMES} durationInFrames={COUNTDOWN_FRAMES}>
            <CountdownRing
              durationInFrames={COUNTDOWN_FRAMES}
              size={240}
              stroke={20}
              color={theme.primary}
              trackColor={theme.card}
              labelColor={theme.text}
            />
          </Sequence>
        </div>
      )}

      {questionAudio && (
        <Sequence from={0} durationInFrames={READ_FRAMES + COUNTDOWN_FRAMES}>
          <Audio src={questionAudio} />
        </Sequence>
      )}
      {revealAudio && (
        <Sequence from={phaseRevealStart} durationInFrames={REVEAL_FRAMES || 30}>
          <Audio src={revealAudio} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
