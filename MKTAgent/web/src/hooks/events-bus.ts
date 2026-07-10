// Single shared EventSource to GET /events per tab. Every live-update hook (post.status,
// node.status) subscribes THROUGH this bus instead of each opening its own EventSource. The
// browser caps HTTP/1.1 at ~6 connections/origin; with three standing streams per tab (run +
// workspace + agent-activity) two open tabs exhaust the pool and stall every fetch(). One
// multiplexed stream fixes that — the server already fans post/node events to the whole owner.
//
// Ref-counted: the connection opens on the first subscriber and closes on the last (deferred one
// tick so an unmount+remount in the same commit — e.g. a runId swap — doesn't needlessly reconnect).
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

type Frame = Record<string, unknown>;
type Handler = (data: Frame) => void;

const handlers: Record<string, Set<Handler>> = {};
const readyHandlers = new Set<() => void>();
const errorHandlers = new Set<() => void>();
const attached = new Set<string>();
let es: EventSource | null = null;
let refs = 0;
let connected = false;

function attach(type: string): void {
  if (!es || attached.has(type)) return;
  attached.add(type);
  es.addEventListener(type, (ev) => {
    const set = handlers[type];
    if (!set || set.size === 0) return;
    let data: Frame;
    try { data = JSON.parse((ev as MessageEvent).data) as Frame; } catch { return; }
    for (const h of set) h(data);
  });
}

function ensureOpen(): void {
  if (es) return;
  connected = false;
  es = new EventSource(`${BASE}/events`, { withCredentials: true });
  es.addEventListener('ready', () => { connected = true; for (const h of readyHandlers) h(); });
  es.onerror = () => { connected = false; for (const h of errorHandlers) h(); };
  for (const type of Object.keys(handlers)) attach(type);
}

function scheduleClose(): void {
  setTimeout(() => {
    if (refs > 0 || !es) return;
    es.close();
    es = null;
    connected = false;
    attached.clear();
  }, 0);
}

export interface EventBusSubscription {
  onReady?: () => void;
  onError?: () => void;
  on?: Record<string, Handler>;
}

// Subscribe to the shared stream. Returns an unsubscribe fn (use directly as a React effect cleanup).
export function subscribeEvents(sub: EventBusSubscription): () => void {
  refs++;
  if (sub.onReady) readyHandlers.add(sub.onReady);
  if (sub.onError) errorHandlers.add(sub.onError);
  const added: Array<[string, Handler]> = [];
  if (sub.on) {
    for (const [type, h] of Object.entries(sub.on)) {
      (handlers[type] ??= new Set()).add(h);
      added.push([type, h]);
    }
  }
  ensureOpen();
  for (const [type] of added) attach(type);
  // Late subscriber joining an already-open stream never sees the one-shot `ready` — replay it.
  if (connected && sub.onReady) sub.onReady();

  return () => {
    refs--;
    if (sub.onReady) readyHandlers.delete(sub.onReady);
    if (sub.onError) errorHandlers.delete(sub.onError);
    for (const [type, h] of added) handlers[type]?.delete(h);
    if (refs <= 0) scheduleClose();
  };
}
