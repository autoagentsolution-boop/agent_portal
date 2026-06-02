import React from 'react';
import { AbsoluteFill, Composition } from 'remotion';

const PlaceholderComposition: React.FC<{ message: string }> = ({ message }) => (
  <AbsoluteFill style={{ background: '#111', color: '#fff', justifyContent: 'center', alignItems: 'center' }}>
    <div style={{ fontFamily: 'sans-serif', fontSize: 72 }}>{message}</div>
  </AbsoluteFill>
);

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="QuizCountdown"
      component={PlaceholderComposition}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ message: 'QuizCountdown placeholder — Phase 03' }}
    />
    <Composition
      id="NewsComic"
      component={PlaceholderComposition}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ message: 'NewsComic placeholder — Phase 07' }}
    />
    <Composition
      id="HacksList"
      component={PlaceholderComposition}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ message: 'HacksList placeholder — Phase 08' }}
    />
  </>
);
