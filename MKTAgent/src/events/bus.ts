// In-process per-tenant event bus (T5). The scheduler and copy-gen publish post
// status changes here; the SSE /events endpoint subscribes per logged-in user and
// streams only that owner's events. Single-process only — a multi-instance deploy
// would need Redis pub/sub (or sticky sessions); documented as a v1 constraint.
//
// A Map<ownerId, Set<subscriber>> (not EventEmitter) so filtering is by-owner by
// construction and there's no global maxListeners(10) ceiling on connection count.
export interface PostStatusEvent {
  type: 'post.status';
  postId: string;
  status: string;
  // Opportunistic extras so the UI can update a row without a refetch (terminal
  // states carry these; null/absent otherwise).
  campaignId?: string;
  postUrls?: Record<string, string> | null;
  error?: string | null;
  at: string; // ISO 8601
}

// Orchestration node-level status (Milestone 1). Same per-tenant fan-out as post
// status — the SSE endpoint streams both event types to the owner.
export interface NodeStatusEvent {
  type: 'node.status';
  runId: string;
  nodeId: string;
  agentId: string;
  status: string;
  error?: string | null;
  // Optimal-time publishing suggestion (Phase 02) — set on the publisher node's
  // `awaiting_approval` event so the approval UI can show the recommended window
  // BEFORE the user approves. Absent on every other event.
  timingSuggestion?: string | null;
  at: string; // ISO 8601
}

export type BusEvent = PostStatusEvent | NodeStatusEvent;

type Subscriber = (event: BusEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>();

// Register a per-owner subscriber. Returns an unsubscribe fn the caller MUST run
// on disconnect (else the Set grows unbounded — one entry per dropped SSE conn).
export const subscribe = (ownerId: string, fn: Subscriber): (() => void) => {
  let set = subscribers.get(ownerId);
  if (!set) {
    set = new Set();
    subscribers.set(ownerId, set);
  }
  set.add(fn);
  return () => {
    const s = subscribers.get(ownerId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) subscribers.delete(ownerId);
  };
};

// Fan a status change out to one owner's live subscribers. Never throws — a slow/
// broken subscriber must not break the scheduler write-back that called this.
export const publishPostStatus = (
  ownerId: string,
  event: Omit<PostStatusEvent, 'type' | 'at'> & { at?: string },
): void => {
  const set = subscribers.get(ownerId);
  if (!set || set.size === 0) return;
  const full: PostStatusEvent = {
    type: 'post.status',
    at: event.at ?? new Date().toISOString(),
    postId: event.postId,
    status: event.status,
    campaignId: event.campaignId,
    postUrls: event.postUrls ?? null,
    error: event.error ?? null,
  };
  for (const fn of set) {
    try {
      fn(full);
    } catch {
      // isolate one bad subscriber; drop the event for it only.
    }
  }
};

// Fan a node status change out to one owner's live subscribers (orchestration).
// Never throws — a broken SSE subscriber must not break the executor.
export const publishNodeStatus = (
  ownerId: string,
  event: Omit<NodeStatusEvent, 'type' | 'at'> & { at?: string },
): void => {
  const set = subscribers.get(ownerId);
  if (!set || set.size === 0) return;
  const full: NodeStatusEvent = {
    type: 'node.status',
    at: event.at ?? new Date().toISOString(),
    runId: event.runId,
    nodeId: event.nodeId,
    agentId: event.agentId,
    status: event.status,
    error: event.error ?? null,
    timingSuggestion: event.timingSuggestion ?? null,
  };
  for (const fn of set) {
    try {
      fn(full);
    } catch {
      // isolate one bad subscriber.
    }
  }
};

// Test/debug helper — current live subscriber count for an owner (0 if none).
export const subscriberCount = (ownerId: string): number =>
  subscribers.get(ownerId)?.size ?? 0;
