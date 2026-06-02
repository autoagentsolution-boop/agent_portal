import React from 'react';
import { AbsoluteFill, Composition } from 'remotion';
import { QuizCountdown } from './quiz/QuizCountdown.tsx';
import {
  FPS,
  HEIGHT,
  WIDTH,
  computeDurationInFrames,
  type QuizProps,
} from './quiz/types.ts';

const PlaceholderComposition: React.FC<{ message: string }> = ({ message }) => (
  <AbsoluteFill
    style={{
      background: '#111',
      color: '#fff',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 80,
      textAlign: 'center',
    }}
  >
    <div style={{ fontFamily: 'sans-serif', fontSize: 64, lineHeight: 1.2 }}>{message}</div>
  </AbsoluteFill>
);

const QUIZ_DEFAULT_PROPS: QuizProps = {
  title: 'Quiz Vui',
  channelName: 'videofarm',
  variant: 'dark',
  questions: [
    {
      id: 1,
      question: 'Thủ đô của Việt Nam là gì?',
      options: ['Hà Nội', 'Đà Nẵng', 'TP. HCM', 'Huế'],
      correctIndex: 0,
    },
  ],
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="QuizCountdown"
      component={QuizCountdown}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={QUIZ_DEFAULT_PROPS}
      durationInFrames={computeDurationInFrames(QUIZ_DEFAULT_PROPS.questions.length)}
      calculateMetadata={({ props }) => ({
        durationInFrames: computeDurationInFrames(props.questions.length),
      })}
    />
    <Composition
      id="NewsComic"
      component={PlaceholderComposition}
      durationInFrames={150}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ message: 'NewsComic placeholder — Phase 07' }}
    />
    <Composition
      id="HacksList"
      component={PlaceholderComposition}
      durationInFrames={150}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ message: 'HacksList placeholder — Phase 08' }}
    />
  </>
);
