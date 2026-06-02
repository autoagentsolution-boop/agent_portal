import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { fontStack, themes } from '../quiz/styles.ts';
import {
  COLLAPSE_FRAMES,
  FINAL_FRAMES,
  HEIGHT,
  HOLD_FRAMES,
  INTRO_FRAMES,
  STEP_REVEAL_FRAMES,
  WIDTH,
  type CookingExplosionProps,
  type CookingStep,
  type StepIngredient,
} from './types.ts';

const CENTER_X = WIDTH / 2;
const BOWL_SIZE = 560;
const BOWL_CENTER_Y = HEIGHT - 360;
const BOWL_TOP_Y = BOWL_CENTER_Y - BOWL_SIZE / 2;
const LAYERS_TOP = 240;
const LAYERS_BOTTOM = BOWL_TOP_Y - 30;

const resolveSrc = (p?: string): string | undefined => {
  if (!p) return undefined;
  return p.startsWith('http') || p.startsWith('data:') ? p : staticFile(p);
};

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

const ingredientChipSize = (count: number): number => (count === 1 ? 150 : count <= 4 ? 110 : 88);

// ---- Cinematic primitives ----

const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background: 'radial-gradient(ellipse at 50% 60%, transparent 35%, rgba(0,0,0,0.55) 80%, rgba(0,0,0,0.85) 100%)',
      pointerEvents: 'none',
    }}
  />
);

const LightRays: React.FC<{ intensity: number; color: string }> = ({ intensity, color }) => (
  <AbsoluteFill
    style={{
      background: `conic-gradient(from 90deg at 50% ${BOWL_TOP_Y}px, transparent 0deg, ${color}22 30deg, transparent 60deg, ${color}1a 100deg, transparent 130deg, ${color}22 200deg, transparent 240deg, ${color}1a 290deg, transparent 360deg)`,
      opacity: intensity * 0.6,
      mixBlendMode: 'screen',
      pointerEvents: 'none',
    }}
  />
);

// Deterministic steam particles rising from bowl
const SteamParticles: React.FC<{ frame: number; color: string; intensity: number }> = ({ frame, color, intensity }) => {
  const COUNT = 36;
  const PERIOD = 110;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: COUNT }).map((_, i) => {
        const localFrame = (frame + i * 5) % PERIOD;
        const t = localFrame / PERIOD;
        const eased = 1 - Math.pow(1 - t, 2.2);
        const driftSin = Math.sin(i * 1.7 + localFrame * 0.07);
        const xOffset = driftSin * (40 + eased * 80);
        const x = CENTER_X + xOffset + ((i % 5) - 2) * 35;
        const y = BOWL_TOP_Y - eased * 900;
        const size = 8 + eased * 22;
        const opacity = Math.sin(t * Math.PI) * 0.55 * intensity;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x - size / 2,
              top: y - size / 2,
              width: size,
              height: size,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${color}, ${color}44 70%, transparent 100%)`,
              opacity,
              filter: 'blur(2px)',
              mixBlendMode: 'screen',
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const BowlRimShine: React.FC<{ frame: number }> = ({ frame }) => {
  const angle = (frame * 1.2) % 360;
  return (
    <div
      style={{
        position: 'absolute',
        left: CENTER_X - BOWL_SIZE / 2 - 6,
        top: BOWL_CENTER_Y - BOWL_SIZE / 2 - 6,
        width: BOWL_SIZE + 12,
        height: BOWL_SIZE + 12,
        borderRadius: '50%',
        background: `conic-gradient(from ${angle}deg, transparent 0deg, rgba(255,255,255,0.85) 12deg, transparent 30deg, transparent 360deg)`,
        mixBlendMode: 'screen',
        opacity: 0.35,
        pointerEvents: 'none',
      }}
    />
  );
};

// ---- Sub-components ----

const Disc: React.FC<{
  size: number;
  color: string;
  imagePath?: string;
  label: string;
  glow?: boolean;
  pulseSeed: number;
  frame: number;
}> = ({ size, color, imagePath, label, glow, pulseSeed, frame }) => {
  const src = resolveSrc(imagePath);
  // Subtle breathing scale + counter-rotate for liveliness
  const pulse = 1 + Math.sin((frame + pulseSeed * 7) * 0.06) * 0.04;
  const tilt = Math.sin((frame + pulseSeed * 13) * 0.04) * 4;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        background: src
          ? '#1a1a1a'
          : `radial-gradient(circle at 30% 25%, ${color}, ${color}cc 55%, ${color}55 100%)`,
        boxShadow: glow
          ? `0 0 ${size * 0.95}px ${color}99, 0 0 ${size * 0.4}px ${color}, 0 14px 36px rgba(0,0,0,0.6)`
          : `0 0 ${size * 0.35}px ${color}55, 0 10px 26px rgba(0,0,0,0.55)`,
        border: '3px solid rgba(255,255,255,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontFamily: fontStack,
        fontWeight: 900,
        fontSize: size * 0.36,
        textShadow: '0 2px 8px rgba(0,0,0,0.75)',
        transform: `scale(${pulse}) rotate(${tilt}deg)`,
        transformStyle: 'preserve-3d',
      }}
    >
      {src ? (
        <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ transform: `rotate(${-tilt}deg)` }}>{label}</span>
      )}
      {/* Inner highlight gloss */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          right: 6,
          height: '40%',
          borderRadius: '50%',
          background: 'linear-gradient(to bottom, rgba(255,255,255,0.32), transparent)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

const Bowl: React.FC<{ scale: number; dishImagePath?: string; bowlColor: string; dishRevealT: number }> = ({
  scale,
  dishImagePath,
  bowlColor,
  dishRevealT,
}) => {
  const dishSrc = resolveSrc(dishImagePath);
  return (
    <div
      style={{
        position: 'absolute',
        left: CENTER_X - BOWL_SIZE / 2,
        top: BOWL_CENTER_Y - BOWL_SIZE / 2,
        width: BOWL_SIZE,
        height: BOWL_SIZE,
        borderRadius: '50%',
        overflow: 'hidden',
        transform: `scale(${scale})`,
        transformOrigin: 'center',
        background: `radial-gradient(circle at 35% 28%, ${bowlColor}, ${bowlColor}cc 65%, ${bowlColor}66 100%)`,
        boxShadow: '0 0 140px rgba(0,0,0,0.55), inset 0 14px 60px rgba(0,0,0,0.45)',
        border: '6px solid rgba(255,255,255,0.14)',
      }}
    >
      {dishSrc && (
        <Img
          src={dishSrc}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: dishRevealT,
            transition: 'none',
          }}
        />
      )}
    </div>
  );
};

const SteamRibbon: React.FC<{ progress: number; color: string }> = ({ progress, color }) => {
  // Two ribbons (soft glow + crisp core) snaking up through frame
  const pathD = `
    M ${CENTER_X} ${BOWL_TOP_Y}
    C ${CENTER_X + 220} ${BOWL_TOP_Y - 200}, ${CENTER_X - 200} ${LAYERS_BOTTOM - 200}, ${CENTER_X + 60} ${LAYERS_BOTTOM - 400}
    C ${CENTER_X + 240} ${LAYERS_BOTTOM - 600}, ${CENTER_X - 240} ${LAYERS_BOTTOM - 800}, ${CENTER_X - 40} ${LAYERS_BOTTOM - 1000}
    C ${CENTER_X + 180} ${LAYERS_TOP + 150}, ${CENTER_X - 180} ${LAYERS_TOP + 60}, ${CENTER_X} ${LAYERS_TOP - 40}
  `;
  const pathLength = 2400;
  const dashOffset = pathLength * (1 - progress);

  return (
    <svg width={WIDTH} height={HEIGHT} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <defs>
        <linearGradient id="steam-grad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.95" />
          <stop offset="100%" stopColor={color} stopOpacity="0.35" />
        </linearGradient>
        <filter id="steam-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
      </defs>
      <path
        d={pathD}
        stroke="url(#steam-grad)"
        strokeWidth={70}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={pathLength}
        strokeDashoffset={dashOffset}
        filter="url(#steam-blur)"
        opacity={0.85}
      />
      <path
        d={pathD}
        stroke="url(#steam-grad)"
        strokeWidth={32}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={pathLength}
        strokeDashoffset={dashOffset}
        opacity={0.95}
      />
    </svg>
  );
};

const StepLayer: React.FC<{
  step: CookingStep;
  layerY: number;
  layerHeight: number;
  revealT: number;     // 0..1 fade-in
  collapseT: number;   // 0..1 fall-into-bowl
  variant: 'light' | 'dark';
  frame: number;
  depthZ: number;      // CSS perspective depth offset
  depthBlur: number;   // px blur for far layers
}> = ({ step, layerY, layerHeight, revealT, collapseT, variant, frame, depthZ, depthBlur }) => {
  const theme = themes[variant];
  const slideY = interpolate(revealT, [0, 1], [-60, 0]);
  // Collapse: y interpolated toward bowl center, opacity fades
  const collapseY = interpolate(collapseT, [0, 1], [0, BOWL_CENTER_Y - layerY]);
  const collapseScale = interpolate(collapseT, [0, 1], [1, 0.3]);
  const collapseOpacity = interpolate(collapseT, [0, 0.7, 1], [1, 0.4, 0]);
  const overallOpacity = revealT * collapseOpacity;

  const ingCount = step.ingredients.length;
  const chipSize = ingredientChipSize(ingCount);
  const rightAreaLeft = 580;
  const rightAreaWidth = WIDTH - rightAreaLeft - 60;
  const spacing = rightAreaWidth / ingCount;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: layerY - layerHeight / 2 + slideY + collapseY,
        height: layerHeight,
        opacity: overallOpacity,
        transform: `translate3d(0, 0, ${depthZ}px) scale(${collapseScale})`,
        transformOrigin: `${CENTER_X}px ${BOWL_CENTER_Y - (layerY - layerHeight / 2 + slideY + collapseY)}px`,
        transformStyle: 'preserve-3d',
        filter: depthBlur > 0.1 ? `blur(${depthBlur}px)` : undefined,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '0 60px',
        pointerEvents: 'none',
      }}
    >
      {/* Number badge */}
      <div
        style={{
          width: 90,
          height: 90,
          borderRadius: '50%',
          background: theme.primary,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fontStack,
          fontWeight: 900,
          fontSize: 52,
          boxShadow: `0 0 36px ${theme.primary}aa`,
          flexShrink: 0,
        }}
      >
        {step.index}
      </div>

      {/* Title + instruction stacked */}
      <div
        style={{
          width: 360,
          color: '#fff',
          fontFamily: fontStack,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            color: theme.primary,
            fontSize: 32,
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: 1,
            textShadow: '0 2px 8px rgba(0,0,0,0.85)',
            lineHeight: 1.1,
          }}
        >
          {step.title}
        </div>
        <div
          style={{
            color: '#fff',
            fontSize: 24,
            fontWeight: 500,
            marginTop: 8,
            lineHeight: 1.25,
            textShadow: '0 2px 6px rgba(0,0,0,0.85)',
            opacity: 0.92,
          }}
        >
          {step.instruction}
        </div>
      </div>

      {/* Ingredients row */}
      <div
        style={{
          position: 'absolute',
          left: rightAreaLeft,
          width: rightAreaWidth,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
        }}
      >
        {step.ingredients.map((ing, i) => (
          <div
            key={ing.id}
            style={{
              position: 'absolute',
              left: spacing * i + spacing / 2 - chipSize / 2,
              top: `calc(50% - ${chipSize / 2}px)`,
            }}
          >
            <Disc
              size={chipSize}
              color={ing.color}
              imagePath={ing.imagePath}
              label={ing.name.slice(0, 1).toUpperCase()}
              pulseSeed={ing.id}
              frame={frame}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// ---- Vertical layout ----
const VerticalScene: React.FC<{ frame: number; props: CookingExplosionProps }> = ({ frame, props }) => {
  const stepCount = props.steps.length;
  const usableHeight = LAYERS_BOTTOM - LAYERS_TOP;
  const layerHeight = usableHeight / stepCount;

  const introT = interpolate(frame, [0, INTRO_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const bowlScale = easeOutCubic(introT) * 1.0;

  const stepsStart = INTRO_FRAMES;
  const stepsEnd = stepsStart + stepCount * STEP_REVEAL_FRAMES;
  const holdEnd = stepsEnd + HOLD_FRAMES;
  const collapseEnd = holdEnd + COLLAPSE_FRAMES;

  // Ribbon draws across step reveal + hold phases
  const ribbonStart = INTRO_FRAMES;
  const ribbonEnd = holdEnd;
  const ribbonProgress = interpolate(frame, [ribbonStart, ribbonEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Collapse phase
  const inCollapse = frame >= holdEnd && frame < collapseEnd;
  const collapseT = inCollapse
    ? easeOutCubic(interpolate(frame, [holdEnd, collapseEnd], [0, 1], { extrapolateRight: 'clamp' }))
    : frame >= collapseEnd
    ? 1
    : 0;
  // Dish reveal during last 70% of collapse + final
  const dishRevealT = interpolate(frame, [holdEnd + COLLAPSE_FRAMES * 0.3, collapseEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // CTA opacity during final phase
  const ctaOpacity = interpolate(frame, [collapseEnd, collapseEnd + 25], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const inFinal = frame >= collapseEnd;

  return (
    <>
      {/* Steam ribbon behind everything but above bg */}
      <SteamRibbon progress={ribbonProgress} color={props.steamColor} />

      {/* Step layers, reveal sequentially */}
      {!inFinal &&
        props.steps.map((step, idx) => {
          const stepRevealStart = stepsStart + idx * STEP_REVEAL_FRAMES;
          const revealLocalFrame = frame - stepRevealStart;
          const revealT = interpolate(revealLocalFrame, [0, 18], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          // layerY = bottom-up — step 1 (idx 0) closest to bowl
          const layerCenterY = LAYERS_BOTTOM - layerHeight * (idx + 0.5);
          // Depth: top layers slightly further back, bottom layers closer
          const depthZ = (idx - (stepCount - 1) / 2) * 60;
          // Far layers (top, idx high) blur slightly = cinematic shallow DOF
          const farFactor = idx / Math.max(stepCount - 1, 1); // 0..1
          const depthBlur = farFactor * 1.8;
          return (
            <StepLayer
              key={step.index}
              step={step}
              layerY={layerCenterY}
              layerHeight={layerHeight}
              revealT={revealT}
              collapseT={collapseT}
              variant={props.variant}
              frame={frame}
              depthZ={depthZ}
              depthBlur={depthBlur}
            />
          );
        })}

      {/* Bowl (always visible after intro) */}
      <Bowl
        scale={bowlScale}
        dishImagePath={props.dishImagePath}
        bowlColor={props.bowlColor}
        dishRevealT={dishRevealT}
      />

      {/* Title at top */}
      {!inFinal && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 100,
            textAlign: 'center',
            color: '#fff',
            fontFamily: fontStack,
            pointerEvents: 'none',
            opacity: introT,
          }}
        >
          <div
            style={{
              fontSize: 38,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: 'uppercase',
              color: themes[props.variant].primary,
            }}
          >
            Hành Trình
          </div>
          <div
            style={{
              fontSize: 64,
              fontWeight: 900,
              marginTop: 6,
              textShadow: '0 4px 16px rgba(0,0,0,0.85)',
            }}
          >
            {props.subtitle}
          </div>
        </div>
      )}

      {/* CTA at final */}
      {inFinal && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 200,
            textAlign: 'center',
            color: '#fff',
            fontFamily: fontStack,
            opacity: ctaOpacity,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontSize: 100,
              fontWeight: 900,
              color: themes[props.variant].primary,
              textShadow: '0 6px 24px rgba(0,0,0,0.85)',
            }}
          >
            {props.dishName}
          </div>
          <div
            style={{
              fontSize: 44,
              fontWeight: 700,
              marginTop: 16,
              textShadow: '0 4px 14px rgba(0,0,0,0.85)',
            }}
          >
            {props.tagline}
          </div>
          {props.channelName && (
            <div
              style={{
                fontSize: 38,
                marginTop: 18,
                color: themes[props.variant].muted,
                fontWeight: 700,
              }}
            >
              @{props.channelName}
            </div>
          )}
        </div>
      )}
    </>
  );
};

// ---- River layout (placeholder — falls through to vertical for v1) ----
// TODO: ingredients clustered along an S-curve path from top to bowl

// ---- Smash layout (placeholder — falls through to vertical for v1) ----
// TODO: ingredients scattered, all converge into bowl at end

export const CookingExplosion: React.FC<CookingExplosionProps> = (props) => {
  const frame = useCurrentFrame();
  const theme = themes[props.variant];

  // Background subtle pulse
  const bgPulse = (Math.sin(frame * 0.045) + 1) / 2;
  const bgGlowOpacity = interpolate(bgPulse, [0, 1], [0.12, 0.28]);

  // Camera dolly — slow forward zoom + slight rotateX for depth feel
  const totalFrames = INTRO_FRAMES + props.steps.length * STEP_REVEAL_FRAMES + HOLD_FRAMES + COLLAPSE_FRAMES + FINAL_FRAMES;
  const dollyT = frame / totalFrames;
  const cameraScale = interpolate(dollyT, [0, 1], [1, 1.08]);
  const cameraRotateX = interpolate(dollyT, [0, 1], [0, -2]);
  const cameraTranslateY = interpolate(dollyT, [0, 1], [0, -40]);

  // Steam particle intensity grows during step reveals, fades during final
  const stepsEnd = INTRO_FRAMES + props.steps.length * STEP_REVEAL_FRAMES + HOLD_FRAMES;
  const steamIntensity = interpolate(
    frame,
    [INTRO_FRAMES - 10, INTRO_FRAMES + 30, stepsEnd, stepsEnd + COLLAPSE_FRAMES + 30],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Light rays grow during reveal phase
  const lightRaysIntensity = interpolate(
    frame,
    [INTRO_FRAMES, INTRO_FRAMES + props.steps.length * STEP_REVEAL_FRAMES],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill style={{ background: theme.bg, overflow: 'hidden' }}>
      {/* Background radial pulse */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 85%, ${props.steamColor}55, transparent 50%), radial-gradient(circle at 50% 20%, ${theme.primary}22, transparent 60%)`,
          opacity: bgGlowOpacity,
        }}
      />

      {/* Cinematic light rays from bowl */}
      <LightRays intensity={lightRaysIntensity} color={props.steamColor} />

      {/* 3D camera container */}
      <AbsoluteFill
        style={{
          perspective: '1800px',
          perspectiveOrigin: '50% 60%',
          transformStyle: 'preserve-3d',
          transform: `scale(${cameraScale}) rotateX(${cameraRotateX}deg) translateY(${cameraTranslateY}px)`,
        }}
      >
        {/* TODO: switch by props.style — river / smash layouts. v1 = vertical only */}
        <VerticalScene frame={frame} props={props} />

        {/* Bowl rim shine spins above the bowl */}
        <BowlRimShine frame={frame} />
      </AbsoluteFill>

      {/* Steam particles overlay (outside camera so they always face viewer) */}
      <SteamParticles frame={frame} color={props.steamColor} intensity={steamIntensity} />

      {/* Cinematic warm color-grade overlay */}
      <AbsoluteFill
        style={{
          background: 'linear-gradient(135deg, rgba(255,140,40,0.10) 0%, transparent 40%, transparent 65%, rgba(20,10,40,0.18) 100%)',
          mixBlendMode: 'overlay',
          pointerEvents: 'none',
        }}
      />

      {/* Cinematic vignette frame */}
      <Vignette />

      {/* Audio (silent if path absent) */}
      {props.bgMusicPath && <Audio src={resolveSrc(props.bgMusicPath)!} volume={0.18} />}
      {props.narrationPath && <Audio src={resolveSrc(props.narrationPath)!} volume={1.0} />}
    </AbsoluteFill>
  );
};
