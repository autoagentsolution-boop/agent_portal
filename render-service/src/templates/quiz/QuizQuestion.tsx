import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { fontStack, themes } from './styles.ts';
import type { QuizQuestion as QuizQuestionType, QuizVariant } from './types.ts';

const READ_FRAMES = 30;        // 1s — question fades in / TTS reads
const COUNTDOWN_FRAMES = 90;   // 3s — viewer answers
const REVEAL_FRAMES = 60;      // 2s — correct answer highlighted, then cut
// Sum = 180 = QUESTION_FRAMES (kept identical to types.ts so timing stays in sync)

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
  const countdownProgress = interpolate(frame, [READ_FRAMES, phaseRevealStart], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const secondsLeft = Math.max(0, Math.ceil((phaseRevealStart - frame) / 30));

  const revealOpacity = interpolate(frame, [phaseRevealStart, phaseRevealStart + 10], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const revealScale = interpolate(frame, [phaseRevealStart, phaseRevealStart + 14], [0.7, 1], {
    extrapolateRight: 'clamp',
  });
  const correctScale = isReveal
    ? interpolate(frame, [phaseRevealStart, phaseRevealStart + 12], [0.96, 1.04], {
        extrapolateRight: 'clamp',
      })
    : 1;

  return (
    <AbsoluteFill
      style={{
        background: theme.bg,
        color: theme.text,
        fontFamily: fontStack,
        padding: 80,
        paddingBottom: 140,
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: theme.muted, fontSize: 40, fontWeight: 700 }}>
          Câu {index + 1} / {total}
        </div>
        {!isReveal && (
          <div style={{ fontSize: 56, fontWeight: 900, color: theme.primary, minWidth: 80, textAlign: 'right' }}>
            {secondsLeft}s
          </div>
        )}
      </div>

      <div
        style={{
          opacity: questionOpacity,
          fontSize: 68,
          fontWeight: 800,
          lineHeight: 1.2,
          color: theme.text,
        }}
      >
        {question.question}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {question.options.map((opt, i) => {
          const isCorrect = i === question.correctIndex;
          const highlight = isReveal && isCorrect;
          const dim = isReveal && !isCorrect;
          return (
            <div
              key={i}
              style={{
                background: highlight ? theme.correct : theme.card,
                color: highlight ? '#fff' : theme.text,
                opacity: dim ? 0.35 : 1,
                fontSize: 48,
                fontWeight: 700,
                padding: '26px 36px',
                borderRadius: 24,
                display: 'flex',
                alignItems: 'center',
                gap: 28,
                boxShadow: highlight
                  ? '0 0 80px rgba(34,197,94,0.55)'
                  : '0 8px 24px rgba(0,0,0,0.12)',
                transform: highlight ? `scale(${correctScale})` : 'scale(1)',
              }}
            >
              <span
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: highlight ? '#fff' : theme.primary,
                  color: highlight ? theme.correct : '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 900,
                  fontSize: 32,
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

      {isReveal && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 80,
            display: 'flex',
            justifyContent: 'center',
            opacity: revealOpacity,
            transform: `scale(${revealScale})`,
          }}
        >
          <div
            style={{
              background: theme.correct,
              color: '#fff',
              padding: '22px 56px',
              borderRadius: 999,
              fontSize: 52,
              fontWeight: 900,
              boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
              letterSpacing: 1,
            }}
          >
            Đáp án: {String.fromCharCode(65 + question.correctIndex)}
          </div>
        </div>
      )}

      {!isReveal && (
        <div
          style={{
            position: 'absolute',
            left: 80,
            right: 80,
            bottom: 70,
            height: 22,
            borderRadius: 999,
            background: theme.card,
            overflow: 'hidden',
            boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.25)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${countdownProgress * 100}%`,
              background: theme.primary,
              borderRadius: 999,
              boxShadow: `0 0 24px ${theme.primary}99`,
            }}
          />
        </div>
      )}

      {questionAudio && (
        <Sequence from={0} durationInFrames={READ_FRAMES + COUNTDOWN_FRAMES}>
          <Audio src={questionAudio} />
        </Sequence>
      )}
      {revealAudio && (
        <Sequence from={phaseRevealStart} durationInFrames={REVEAL_FRAMES}>
          <Audio src={revealAudio} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
