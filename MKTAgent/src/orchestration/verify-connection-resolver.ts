// Connection Resolver verification — pure, no DB, no LLM. Asserts the §11 gate:
// a plan with a requiresConnection agent (publisher) and target platforms returns
// missing_connection when no token, resolved when active, reconnect when stale, and
// resolved when the plan has no connection-needing agent. Exits non-zero on failure.
import { goalSpec, type GoalSpec } from './schemas/goal-spec.ts';
import { planWorkflow } from './master/workflow-planner.ts';
import type { WorkflowPlan } from './schemas/workflow-plan.ts';
import {
  resolveConnections,
  type TokenStatusLike,
  type TokenStatusReader,
} from '../connectors/runtime/connection-resolver.ts';
import type { SocialPlatform, TokenStatus } from '../../prisma/generated/prisma/client.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : '');
  }
};

const mkGoal = (platforms: string[], outputs: Partial<GoalSpec['outputs']> = {}): GoalSpec =>
  goalSpec.parse({
    outputs: { needsTextPost: true, needsPublishing: true, ...outputs },
    platforms,
    slots: { product: 'AI automation suite' },
    provider: 'test',
  });

// A publishing plan (concept_writer → publisher); publisher requiresConnection.
const publishingPlan = (goal: GoalSpec): WorkflowPlan => {
  const r = planWorkflow(goal);
  if (!r.ok) throw new Error(`fixture plan failed: ${r.error}`);
  return r.plan;
};

// Build a token-status reader from a fixed list (DB-free injection).
const reader = (rows: TokenStatusLike[]): TokenStatusReader => async () => rows;
const row = (platform: SocialPlatform, status: TokenStatus, expiresAt: Date | null = null): TokenStatusLike =>
  ({ platform, status, expiresAt });

const run = async () => {
  // 1) No token for the target platform → missing_connection + connect action.
  {
    console.log('Case 1: no token → missing_connection');
    const goal = mkGoal(['facebook']);
    const res = await resolveConnections('owner-1', goal, publishingPlan(goal), reader([]));
    check('status = missing_connection', res.status === 'missing_connection', res);
    if (res.status !== 'resolved') {
      check('one required action', res.required.length === 1, res.required);
      const a = res.required[0];
      check('type = connect_platform', a?.type === 'connect_platform', a);
      check('platform = facebook', a?.platform === 'facebook', a);
      check('connectUrl points at OAuth start', a?.connectUrl === '/connect/facebook/start', a);
      check('carries capabilities', (a?.capabilities.length ?? 0) > 0, a);
    }
  }

  // 2) Active token → resolved.
  {
    console.log('Case 2: active token → resolved');
    const goal = mkGoal(['facebook']);
    const res = await resolveConnections('owner-1', goal, publishingPlan(goal), reader([row('facebook', 'active')]));
    check('status = resolved', res.status === 'resolved', res);
  }

  // 3) needs_attention / revoked token → needs_attention + reconnect action.
  {
    console.log('Case 3: revoked token → reconnect');
    const goal = mkGoal(['facebook']);
    const res = await resolveConnections('owner-1', goal, publishingPlan(goal), reader([row('facebook', 'revoked')]));
    check('status = needs_attention', res.status === 'needs_attention', res);
    if (res.status !== 'resolved') check('type = reconnect_platform', res.required[0]?.type === 'reconnect_platform', res.required[0]);
  }

  // 4) Active but expired (status active, expiresAt in the past) → reconnect.
  {
    console.log('Case 4: expired token → reconnect');
    const goal = mkGoal(['facebook']);
    const past = new Date(Date.now() - 86_400_000);
    const res = await resolveConnections('owner-1', goal, publishingPlan(goal), reader([row('facebook', 'active', past)]));
    check('status = needs_attention', res.status === 'needs_attention', res);
  }

  // 5) Multi-platform, one missing one active → missing_connection, only the gap surfaces.
  {
    console.log('Case 5: mixed platforms → only the gap');
    const goal = mkGoal(['facebook', 'instagram']);
    const res = await resolveConnections('owner-1', goal, publishingPlan(goal), reader([row('facebook', 'active')]));
    check('status = missing_connection', res.status === 'missing_connection', res);
    if (res.status !== 'resolved') {
      check('exactly one gap (instagram)', res.required.length === 1 && res.required[0]?.platform === 'instagram', res.required);
    }
  }

  // 6) Plan with NO connection-needing agent → resolved regardless of tokens.
  {
    console.log('Case 6: no connection-needing agent → resolved');
    const goal = mkGoal(['facebook'], { needsPublishing: false });
    const r = planWorkflow(goal);
    check('fixture plan ok (no publisher)', r.ok, r);
    if (r.ok) {
      const hasPublisher = r.plan.nodes.some((n) => n.agentId === 'publisher');
      check('plan has no publisher', !hasPublisher, r.plan.nodes.map((n) => n.agentId));
      const res = await resolveConnections('owner-1', goal, r.plan, reader([]));
      check('status = resolved', res.status === 'resolved', res);
    }
  }

  // 7) No target platforms at all → resolved (nothing to publish to).
  {
    console.log('Case 7: empty platforms → resolved');
    const goal = mkGoal([]);
    const res = await resolveConnections('owner-1', goal, publishingPlan(goal), reader([]));
    check('status = resolved', res.status === 'resolved', res);
  }

  console.log(failures === 0 ? '\nPASS — all connection-resolver checks green' : `\nFAIL — ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
};

void run();
