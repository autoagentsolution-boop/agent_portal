// Characterization: shared SSE bus ref-counting. Phase-3 hook-extraction (use-run-events /
// use-post-events / use-workspace-events split out of App/panels) MUST preserve these invariants:
//   - ONE EventSource for N subscribers (connection pool exhaustion is the bug this prevents).
//   - Opens on first subscriber, closes on last — but the close is deferred one tick, so an
//     unmount+remount in the same commit (a runId swap) does NOT reconnect.
//   - A late subscriber joining an already-open stream still gets the one-shot `ready`.
//   - Frames fan out to every handler registered for that event type.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static openCount = 0;
  url: string;
  withCredentials: boolean;
  closed = false;
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};
  onerror: (() => void) | null = null;

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
    FakeEventSource.openCount++;
  }
  addEventListener(type: string, cb: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  close() { this.closed = true; }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) cb({ data: JSON.stringify(data) });
  }
  emitReady() { for (const cb of this.listeners['ready'] ?? []) cb({ data: '{}' }); }
  static reset() { FakeEventSource.instances = []; FakeEventSource.openCount = 0; }
  static get live() { return FakeEventSource.instances.filter((e) => !e.closed); }
}

async function freshBus() {
  vi.resetModules();
  return import('./events-bus.ts');
}

describe('events-bus ref-counting (SSE multiplex)', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens exactly one EventSource for multiple subscribers', async () => {
    const { subscribeEvents } = await freshBus();
    const u1 = subscribeEvents({ on: { 'post.status': () => {} } });
    const u2 = subscribeEvents({ on: { 'node.status': () => {} } });
    expect(FakeEventSource.openCount).toBe(1);
    expect(FakeEventSource.live.length).toBe(1);
    u1(); u2();
  });

  it('closes on the last unsubscribe (after the deferred tick), not before', async () => {
    const { subscribeEvents } = await freshBus();
    const u1 = subscribeEvents({ on: { a: () => {} } });
    const u2 = subscribeEvents({ on: { b: () => {} } });
    u1();
    vi.runAllTimers();
    expect(FakeEventSource.live.length).toBe(1); // one subscriber remains → still open
    u2();
    expect(FakeEventSource.live.length).toBe(1); // close is deferred — not synchronous
    vi.runAllTimers();
    expect(FakeEventSource.live.length).toBe(0);
  });

  it('unmount+remount in the same commit does NOT reconnect (deferred close sees refs>0)', async () => {
    const { subscribeEvents } = await freshBus();
    const u1 = subscribeEvents({ on: { a: () => {} } });
    u1();                                            // refs → 0, schedules close
    const u2 = subscribeEvents({ on: { a: () => {} } }); // refs → 1 before the tick fires
    vi.runAllTimers();                               // scheduled close aborts (refs>0)
    expect(FakeEventSource.openCount).toBe(1);       // never opened a second stream
    expect(FakeEventSource.live.length).toBe(1);
    u2();
  });

  it('fans a frame out to every handler on the same event type', async () => {
    const { subscribeEvents } = await freshBus();
    const seen: string[] = [];
    const u1 = subscribeEvents({ on: { 'post.status': (d) => seen.push('a:' + d.status) } });
    const u2 = subscribeEvents({ on: { 'post.status': (d) => seen.push('b:' + d.status) } });
    FakeEventSource.live[0].emit('post.status', { status: 'posted' });
    expect(seen.sort()).toEqual(['a:posted', 'b:posted']);
    u1(); u2();
  });

  it('routes a frame ONLY to handlers on that event type (no cross-talk)', async () => {
    // The Phase-3 hook split (use-run-events / use-post-events / use-workspace-events) must keep
    // handlers keyed by type — a node.status frame must never reach a post.status handler.
    const { subscribeEvents } = await freshBus();
    const post: string[] = [];
    const node: string[] = [];
    const u1 = subscribeEvents({ on: { 'post.status': (d) => post.push(String(d.status)) } });
    const u2 = subscribeEvents({ on: { 'node.status': (d) => node.push(String(d.status)) } });
    FakeEventSource.live[0].emit('post.status', { status: 'posted' });
    expect(post).toEqual(['posted']);
    expect(node).toEqual([]); // node handler NOT invoked by a post frame
    u1(); u2();
  });

  it('replays the one-shot ready to a late subscriber on an already-open stream', async () => {
    const { subscribeEvents } = await freshBus();
    let earlyReady = 0;
    const u1 = subscribeEvents({ onReady: () => earlyReady++ });
    FakeEventSource.live[0].emitReady();             // stream becomes connected
    expect(earlyReady).toBe(1);
    let lateReady = 0;
    const u2 = subscribeEvents({ onReady: () => { lateReady++; } });
    expect(lateReady).toBe(1);                       // joined already-connected → replayed
    u1(); u2();
  });

  it('does NOT replay ready before the stream is connected (the connected-gate is load-bearing)', async () => {
    // Replay is guarded on `connected` (events-bus.ts:74). A subscriber joining a stream that has
    // not yet emitted `ready` must NOT get a premature onReady — else callers act before the server
    // is live. Pin the negative case so a Phase-3 refactor can't drop the guard unnoticed.
    const { subscribeEvents } = await freshBus();
    let ready = 0;
    const u = subscribeEvents({ onReady: () => ready++ }); // opens the stream, but no emitReady yet
    expect(ready).toBe(0);                                 // not connected → no replay
    FakeEventSource.live[0].emitReady();
    expect(ready).toBe(1);                                 // fires once, when the server says ready
    u();
  });

  it('carries withCredentials so the session cookie rides the stream', async () => {
    const { subscribeEvents } = await freshBus();
    const u = subscribeEvents({ on: { a: () => {} } });
    expect(FakeEventSource.live[0].withCredentials).toBe(true);
    u();
  });
});
