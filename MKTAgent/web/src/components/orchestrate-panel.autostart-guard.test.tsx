// Characterization: the ref-guard "fire exactly once" PATTERN that OrchestratePanel uses for
// autoStart (OrchestratePanel.tsx:271) and attach-consume (:288). SCOPE — this pins the *pattern*
// (useRef(false) flipped before the side-effect, StrictMode-safe), NOT the real OrchestratePanel:
// it renders a minimal replica because a full-panel render needs the whole api/i18n/voice tree. So
// this is a false-NEGATIVE-safe pattern pin, not a component pin — if Phase-3 extracts the guard
// into a hook, add a companion that drives the REAL effect. The replica mirrors the four guard
// conditions the real effect checks: has-seed, empty-seed parks, restore never fires, ref persists.
import { StrictMode, useEffect, useRef } from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

// Mirrors OrchestratePanel.tsx:271-282: `if (!autoStart || restore || started.current) return`,
// then trim-guard, then flip-before-side-effect, then the <3-char park.
function AutoStartOnce({
  onFire, onPark, seed, autoStart = true, restore = false,
}: { onFire: () => void; onPark?: () => void; seed: string; autoStart?: boolean; restore?: boolean }) {
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || restore || started.current) return;
    const s = seed.trim();
    if (!s) return;
    started.current = true;
    if (s.length < 3) { onPark?.(); return; } // too short to be a goal → parks in composer
    onFire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

describe('OrchestratePanel autoStart ref-guard (StrictMode-safe fire-once)', () => {
  it('fires the side-effect exactly once under StrictMode double-invoke', () => {
    let fires = 0;
    render(
      <StrictMode>
        <AutoStartOnce seed="launch a campaign" onFire={() => { fires++; }} />
      </StrictMode>,
    );
    expect(fires).toBe(1); // NOT 2 — StrictMode mounts→unmounts→remounts in dev
  });

  it('does not fire when the seed is empty (parks instead of dropping)', () => {
    let fires = 0;
    render(
      <StrictMode>
        <AutoStartOnce seed="   " onFire={() => { fires++; }} />
      </StrictMode>,
    );
    expect(fires).toBe(0);
  });

  it('parks (does not run) a seed too short to be a goal (<3 chars)', () => {
    let fires = 0; let parks = 0;
    render(<AutoStartOnce seed="hi" onFire={() => { fires++; }} onPark={() => { parks++; }} />);
    expect(fires).toBe(0);
    expect(parks).toBe(1);
  });

  it('never fires on a restore (resuming a chat must not re-send)', () => {
    let fires = 0;
    render(
      <StrictMode>
        <AutoStartOnce seed="launch a campaign" restore onFire={() => { fires++; }} />
      </StrictMode>,
    );
    expect(fires).toBe(0);
  });

  it('a re-render with the same trigger does not re-fire (ref persists across renders)', () => {
    let fires = 0;
    const { rerender } = render(<AutoStartOnce seed="go now" onFire={() => { fires++; }} />);
    rerender(<AutoStartOnce seed="go now" onFire={() => { fires++; }} />);
    rerender(<AutoStartOnce seed="go now" onFire={() => { fires++; }} />);
    expect(fires).toBe(1);
  });
});
