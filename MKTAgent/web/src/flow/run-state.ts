import type { PostDto } from '../api/client';

// Map today's Post lifecycle to the Phase-1 flow nodes. This avoids a backend
// graph migration before demo while making the UI speak the future AgentPortal
// language: flow runs, node status, artifacts, approval gates.
export type NodeVisualState = 'pending' | 'running' | 'waiting' | 'done' | 'blocked';

export function nodeState(nodeId: string, posts: PostDto[]): NodeVisualState {
  if (posts.length === 0) return nodeId === 'concept-writer' ? 'waiting' : 'pending';
  const statuses = posts.map((p) => p.status);

  if (nodeId === 'content-research') return 'done';
  if (nodeId === 'concept-writer') {
    if (statuses.some((s) => s === 'brief' || s === 'rework')) return 'waiting';
    if (statuses.some((s) => s === 'review')) return 'done';
    return 'done';
  }
  if (nodeId === 'publisher') {
    if (statuses.some((s) => s === 'posting')) return 'running';
    if (statuses.some((s) => s === 'ready')) return 'waiting';
    if (statuses.some((s) => s === 'posted' || s === 'partial')) return 'done';
    if (statuses.some((s) => s === 'error')) return 'blocked';
  }
  return 'pending';
}

export function flowRunSummary(posts: PostDto[]) {
  const waitingReview = posts.filter((p) => p.status === 'review').length;
  const ready = posts.filter((p) => p.status === 'ready').length;
  const live = posts.filter((p) => ['posting', 'posted', 'partial'].includes(p.status)).length;
  const needsInput = posts.filter((p) => ['brief', 'rework', 'error'].includes(p.status)).length;
  return { waitingReview, ready, live, needsInput };
}
