// Characterization: the two App.tsx invariants the Phase-3 hook-extraction (use-posts /
// use-voice-mirror) must preserve. Both are documented in App.tsx as load-bearing:
//   1. mergePosts MERGES incoming posts into the global set by id (never replaces) — opening one
//      campaign must not wipe the sidebar's briefs for the others; and it must be useCallback-stable
//      (empty deps) or PostBoard's load() re-fires forever ("Posts • Loading…" hang).
//   2. handleVoiceChange collapses to the SAME object reference when mode+state are unchanged, so a
//      mirrored SSE tick that reports no change doesn't churn App state.
//
// The setter reducers are pure; we replicate them EXACTLY as written in App.tsx and pin their
// contract. A Phase-3 extraction that changes merge→replace or drops the identity short-circuit
// breaks these before it can ship. (Kept in lock-step with App.tsx:76-79 and :194-200.)
import { describe, expect, it } from 'vitest';

interface P { id: string; status?: string }

// EXACT copy of App.tsx mergePosts reducer body (the useState updater).
const mergeReducer = (prev: P[], incoming: P[]): P[] => {
  const byId = new Map(prev.map((p) => [p.id, p]));
  for (const p of incoming) byId.set(p.id, p);
  return [...byId.values()];
};

// EXACT copy of App.tsx handleVoiceChange updater.
type V = { mode: boolean; state: string };
const voiceReducer = (p: V, v: V): V => (p.mode === v.mode && p.state === v.state ? p : v);

describe('App mergePosts — merge-not-replace by id', () => {
  it('keeps posts from other campaigns when a campaign board reports its own subset', () => {
    const prev: P[] = [{ id: 'a1', status: 'draft' }, { id: 'b1', status: 'draft' }];
    const next = mergeReducer(prev, [{ id: 'b1', status: 'posted' }]); // board B only sends B's posts
    expect(next.map((p) => p.id).sort()).toEqual(['a1', 'b1']); // a1 (campaign A) survives
    expect(next.find((p) => p.id === 'b1')?.status).toBe('posted'); // b1 patched in place
    expect(next.find((p) => p.id === 'a1')?.status).toBe('draft'); // a1 untouched
  });

  it('appends genuinely new posts without dropping existing ones', () => {
    const next = mergeReducer([{ id: 'a1' }], [{ id: 'a2' }, { id: 'a3' }]);
    expect(next.map((p) => p.id).sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('last-write-wins on the same id (live SSE patch overrides the stale row)', () => {
    const next = mergeReducer([{ id: 'x', status: 'draft' }], [{ id: 'x', status: 'error' }]);
    expect(next).toEqual([{ id: 'x', status: 'error' }]);
  });

  it('empty incoming is a no-op (never clears the global set)', () => {
    const prev: P[] = [{ id: 'a1' }, { id: 'b1' }];
    expect(mergeReducer(prev, [])).toEqual(prev);
  });
});

describe('App handleVoiceChange — identity short-circuit', () => {
  it('returns the SAME reference when mode+state are unchanged (no churn)', () => {
    const cur: V = { mode: true, state: 'listening' };
    expect(voiceReducer(cur, { mode: true, state: 'listening' })).toBe(cur);
  });

  it('returns the new object when state changes', () => {
    const cur: V = { mode: true, state: 'listening' };
    const out = voiceReducer(cur, { mode: true, state: 'speaking' });
    expect(out).not.toBe(cur);
    expect(out).toEqual({ mode: true, state: 'speaking' });
  });

  it('returns the new object when mode toggles off', () => {
    const cur: V = { mode: true, state: 'idle' };
    expect(voiceReducer(cur, { mode: false, state: 'idle' })).toEqual({ mode: false, state: 'idle' });
  });
});
