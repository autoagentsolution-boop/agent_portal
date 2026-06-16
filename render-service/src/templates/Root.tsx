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
import { NewsComic } from './news-comic/NewsComic.tsx';
import { computeNewsComicDurationInFrames, type NewsComicProps } from './news-comic/types.ts';
import { HacksList } from './hacks-list/HacksList.tsx';
import { computeHacksDurationInFrames, type HacksListProps } from './hacks-list/types.ts';
import { CookingExplosion } from './cooking-explosion/CookingExplosion.tsx';
import {
  computeCookingDurationInFrames,
  computeCookingV2DurationInFrames,
  isV2Props,
  type CookingExplosionProps,
} from './cooking-explosion/types.ts';

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

const COOKING_DEFAULT_PROPS: CookingExplosionProps = {
  dishName: 'Phở Bò',
  subtitle: 'Tạo nên tô phở bò',
  tagline: 'Tinh hoa ẩm thực Việt Nam',
  channelName: 'videofarm',
  variant: 'dark',
  style: 'vertical',
  bowlColor: '#8B4513',
  steamColor: '#FBBF24',
  steps: [
    {
      index: 1,
      title: 'Xương bò',
      instruction: 'Hầm nhiều giờ lấy vị ngọt',
      ingredients: [{ id: 1, name: 'Xương', amount: '1kg', color: '#7C2D12' }],
    },
  ],
};

const HACKS_DEFAULT_PROPS: HacksListProps = {
  topic: 'Mẹo nhà bếp',
  intro: '5 mẹo dọn nhanh!',
  outro: 'Follow để xem thêm!',
  channelName: 'videofarm',
  variant: 'dark',
  hacks: [
    {
      id: 1,
      title: 'Vỏ chanh khử mùi',
      details: 'Cho vỏ chanh vào máy xay rác chạy 30 giây để khử mùi hôi.',
      clipPath: '/files/stock/placeholder.mp4',
    },
  ],
};

const NEWS_COMIC_DEFAULT_PROPS: NewsComicProps = {
  title: 'Tin Công Nghệ Hôm Nay',
  channelName: 'videofarm',
  variant: 'dark',
  panels: [
    {
      panel: 1,
      caption: 'Một tin nóng vừa xảy ra trong ngành công nghệ...',
      imagePath: '/files/images/placeholder.png',
    },
  ],
};

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
      component={NewsComic}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={NEWS_COMIC_DEFAULT_PROPS}
      durationInFrames={computeNewsComicDurationInFrames(NEWS_COMIC_DEFAULT_PROPS.panels.length)}
      calculateMetadata={({ props }) => ({
        durationInFrames: computeNewsComicDurationInFrames(props.panels.length),
      })}
    />
    <Composition
      id="CookingExplosion"
      component={CookingExplosion}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={COOKING_DEFAULT_PROPS}
      durationInFrames={computeCookingDurationInFrames(COOKING_DEFAULT_PROPS.steps.length)}
      calculateMetadata={({ props }) => ({
        durationInFrames: isV2Props(props)
          ? computeCookingV2DurationInFrames(props.panels)
          : computeCookingDurationInFrames(props.steps.length),
      })}
    />
    <Composition
      id="HacksList"
      component={HacksList}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={HACKS_DEFAULT_PROPS}
      durationInFrames={computeHacksDurationInFrames(HACKS_DEFAULT_PROPS.hacks.length)}
      calculateMetadata={({ props }) => ({
        durationInFrames: computeHacksDurationInFrames(props.hacks.length),
      })}
    />
  </>
);
