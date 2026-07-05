// Phase 5 verification — live HTTP loop against a running server (:7100). Mints a
// JWT for two throwaway tenants, exercises the orchestration lifecycle over real
// fetch: 401 no-auth, create→clarify→approve→approve-node, cross-tenant 404, GET.
// DRY-RUN: the publisher runs the live path but the materialized Post has no media
// → publish_result faithfully errors (no real social post). Cleans up after.
//
// Run: server up on :7100 (ENABLE_*_CRON unset), then `npx tsx src/orchestration/verify-api.ts`.
import { prisma } from '../db/client.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { env } from '../config/env.ts';
import { upsertToken } from '../db/repos/token-repo.ts';

const BASE = `http://localhost:${env.PORT}`;
let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
};

interface Json { status: number; body: any }
const call = async (method: string, path: string, token?: string, body?: unknown): Promise<Json> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

async function main(): Promise<void> {
  // Health gate first — fail fast with a clear message if the server isn't up.
  try {
    const h = await fetch(`${BASE}/health`);
    if (!h.ok) throw new Error(`health ${h.status}`);
  } catch (e) {
    console.error(`Server not reachable at ${BASE} — start it first (npx tsx src/server.ts). ${String(e)}`);
    process.exit(2);
  }

  const userA = await prisma.user.create({ data: { email: `api-a-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  const userB = await prisma.user.create({ data: { email: `api-b-${Date.now()}@test.local` } });
  const tokenA = signSession({ sub: userA.id, email: userA.email });
  const tokenB = signSession({ sub: userB.id, email: userB.email });

  try {
    // Auth gate.
    const noAuth = await call('POST', '/orchestration/runs', undefined, { message: 'Post about X on facebook' });
    check('401 without token', noAuth.status === 401, noAuth);

    // Vague request → awaiting_clarification (asks product). Conversational unify: the
    // run is now backed by a chat session and carries an authored assistant message.
    const vague = await call('POST', '/orchestration/runs', tokenA, { message: 'help me with marketing' });
    check('201 created (vague)', vague.status === 201, vague.status);
    check('vague → awaiting_clarification', vague.body?.data?.status === 'awaiting_clarification', vague.body?.data?.status);
    check('clarification questions present', (vague.body?.data?.questions?.length ?? 0) >= 1, vague.body?.data?.questions);
    check('run carries chatSessionId', typeof vague.body?.data?.chatSessionId === 'string', vague.body?.data?.chatSessionId);
    check('run carries assistantMessage', typeof vague.body?.data?.assistantMessage === 'string' && vague.body.data.assistantMessage.length > 1, vague.body?.data?.assistantMessage);
    const vagueRunId = vague.body?.data?.id;
    const chatId = vague.body?.data?.chatSessionId;

    // Richness gate: product + a single platform + a named output is now too thin to
    // plan — the agent must ASK first (audience/angle), not jump to a bare DAG. This is
    // the core fix. (Output named explicitly so the gate's anyOutput precondition holds
    // regardless of LLM variance.)
    const thin = await call('POST', '/orchestration/runs', tokenA, {
      message: 'Write a Facebook text post about our AI automation product',
    });
    check('thin (product+platform) → awaiting_clarification', thin.body?.data?.status === 'awaiting_clarification', thin.body?.data?.status);
    check('thin asks audience or angle', (thin.body?.data?.questions ?? []).some((q: any) => (q.slot === 'targetAudience' || q.slot === 'angle') && q.required), thin.body?.data?.questions);

    // Answer clarification on the vague run → re-plan. Reuses the same chat session.
    const clarified = await call('POST', `/orchestration/runs/${vagueRunId}/clarify`, tokenA, {
      answers: { product: 'AI automation suite', output_format: 'Text + infographic', platforms: ['facebook'], targetAudience: 'small business owners', angle: 'save operational time' },
    });
    check('clarify → planned', clarified.body?.data?.status === 'planned', clarified.body?.data?.status);
    check('plan has nodes', (clarified.body?.data?.nodes?.length ?? 0) >= 2, clarified.body?.data?.nodes?.length);
    check('clarify keeps same chat session', clarified.body?.data?.chatSessionId === chatId, clarified.body?.data?.chatSessionId);
    check('clarify carries assistantMessage', typeof clarified.body?.data?.assistantMessage === 'string', clarified.body?.data?.assistantMessage);

    // History restore: latest run for the chat session.
    const byChat = await call('GET', `/orchestration/runs/by-chat/${chatId}`, tokenA);
    check('by-chat restore → 200 latest run', byChat.status === 200 && byChat.body?.data?.id === vagueRunId, byChat.status);
    check('by-chat cross-tenant → 404', (await call('GET', `/orchestration/runs/by-chat/${chatId}`, tokenB)).status === 404);

    // Fully-specified request in one shot → planned immediately (rich = no gate).
    const complete = await call('POST', '/orchestration/runs', tokenA, {
      message: 'Post about our AI automation product on facebook, audience small business owners, angle saving operational time, with file id 1bo4diy3vlH9VmRE-78Z15ux9053-KZci',
    });
    check('rich one-shot → planned', complete.body?.data?.status === 'planned', complete.body?.data?.status);
    const runId = complete.body?.data?.id;
    const completeChat = complete.body?.data?.chatSessionId;
    const beforeNodes = complete.body?.data?.nodes?.length ?? 0;

    // CONVERSATIONAL REFINEMENT: a free-text follow-up on the same chat must MERGE
    // (add an image) — not reset and re-ask everything (the reported bug). Same run,
    // still planned, with the infographic node added.
    const refined = await call('POST', '/orchestration/runs', tokenA, { message: 'tôi muốn thêm infographic nữa', chatSessionId: completeChat });
    check('refine stays planned (no re-clarify)', refined.body?.data?.status === 'planned', refined.body?.data?.status);
    check('refine reuses same run', refined.body?.data?.id === runId, { refined: refined.body?.data?.id, runId });
    check('refine keeps the chat session', refined.body?.data?.chatSessionId === completeChat, refined.body?.data?.chatSessionId);
    check('refine added infographic node', (refined.body?.data?.nodes ?? []).some((n: any) => n.agentId === 'infographic'), refined.body?.data?.nodes?.map((n: any) => n.agentId));
    check('refine did not duplicate nodes', (refined.body?.data?.nodes?.length ?? 0) >= beforeNodes && (refined.body?.data?.nodes?.length ?? 0) <= beforeNodes + 2, { before: beforeNodes, after: refined.body?.data?.nodes?.length });

    // Cross-tenant read → 404.
    const leak = await call('GET', `/orchestration/runs/${runId}`, tokenB);
    check('cross-tenant GET → 404', leak.status === 404, leak.status);

    // SUBTRACTIVE REFINEMENT over HTTP: drop the infographic we just added. Same run,
    // still planned, infographic node gone, product/audience kept (no re-clarify).
    const subtracted = await call('POST', '/orchestration/runs', tokenA, { message: 'bỏ infographic đi', chatSessionId: completeChat });
    check('subtractive → same run', subtracted.body?.data?.id === runId, { got: subtracted.body?.data?.id, want: runId });
    check('subtractive → still planned (no re-clarify)', subtracted.body?.data?.status === 'planned', subtracted.body?.data?.status);
    check('subtractive removed infographic node', !subtracted.body?.data?.nodes?.some((n: any) => n.agentId === 'infographic'), subtracted.body?.data?.nodes?.map((n: any) => n.agentId));
    check('subtractive kept product', Boolean((subtracted.body?.data?.goal as any)?.slots?.product), (subtracted.body?.data?.goal as any)?.slots?.product);

    // SAVE (chat "Approve") → freezes the run into a Flow TEMPLATE (kind=template,
    // status=template, locked). Does NOT execute; the template is never run directly.
    const saveBad = await call('POST', `/orchestration/runs/${runId}/save`, tokenA, { name: '' });
    check('save empty name → 422', saveBad.status === 422, saveBad.status);
    const saved = await call('POST', `/orchestration/runs/${runId}/save`, tokenA, { name: 'Verify demo flow' });
    check('save → 200 kind=template', saved.status === 200 && saved.body?.data?.kind === 'template', { s: saved.status, k: saved.body?.data?.kind });
    check('save → status=template + locked', saved.body?.data?.status === 'template' && saved.body?.data?.locked === true, { st: saved.body?.data?.status, l: saved.body?.data?.locked });
    check('save sets name', saved.body?.data?.name === 'Verify demo flow', saved.body?.data?.name);
    check('save cross-tenant → 404', (await call('POST', `/orchestration/runs/${runId}/save`, tokenB, { name: 'x' })).status === 404);

    // Saved Flows list (templates only) — must include the flow we just saved.
    const savedList = await call('GET', '/orchestration/runs/saved', tokenA);
    check('GET /runs/saved 200', savedList.status === 200, savedList.status);
    check('saved list includes the template with nodeCount', savedList.body?.data?.some((r: any) => r.id === runId && r.name === 'Verify demo flow' && r.nodeCount > 0), savedList.body?.data);
    check('saved list 401 no token', (await call('GET', '/orchestration/runs/saved')).status === 401);

    // A template is a blueprint — executing it directly is refused (409). The user
    // creates a Post (which clones the template into an instance) and runs THAT.
    const execTemplate = await call('POST', `/orchestration/runs/${runId}/execute`, tokenA);
    check('execute template → 409 template_not_executable', execTemplate.status === 409 && execTemplate.body?.error === 'template_not_executable', { s: execTemplate.status, e: execTemplate.body?.error });

    // Create a campaign under the flow template, then a post → clones the template into
    // an executable instance run (post.runId). The instance is what we exercise below.
    const instCamp = await call('POST', '/campaigns', tokenA, { product: 'Instance product', flowId: runId, platforms: ['facebook'], language: 'en' });
    check('campaign under template → 201', instCamp.status === 201, instCamp.status);
    const instCampId = instCamp.body?.data?.id;
    const instPost = await call('POST', '/posts', tokenA, { campaignId: instCampId });
    check('post under flow campaign → 201 with runId (cloned instance)', instPost.status === 201 && typeof instPost.body?.data?.runId === 'string', { s: instPost.status, r: instPost.body?.data?.runId });
    const instRunId = instPost.body?.data?.runId;
    const instRun = await call('GET', `/orchestration/runs/${instRunId}`, tokenA);
    check('instance run kind=instance, planned', instRun.body?.data?.kind === 'instance' && instRun.body?.data?.status === 'planned', { k: instRun.body?.data?.kind, st: instRun.body?.data?.status });

    // ---- CONNECTION GATE (§11): publisher needs facebook, tenant A has NO token ----
    // The instance run is planned + targets facebook. /execute must STOP at the gate
    // ($0 spent, no executor, no nodes run) and return needs_connection + a connect action.
    const gatedExec = await call('POST', `/orchestration/runs/${instRunId}/execute`, tokenA);
    check('gate: execute → 200 needs_connection', gatedExec.status === 200 && gatedExec.body?.data?.status === 'needs_connection', { s: gatedExec.status, st: gatedExec.body?.data?.status });
    const reqActions = gatedExec.body?.data?.requiredActions ?? [];
    check('gate: requiredActions present', reqActions.length >= 1, reqActions);
    check('gate: action targets facebook (connect_platform)', reqActions.some((a: any) => a.platform === 'facebook' && a.type === 'connect_platform'), reqActions);
    check('gate: action carries connectUrl', reqActions.every((a: any) => typeof a.connectUrl === 'string' && a.connectUrl.includes('/connect/')), reqActions[0]);
    // Secrecy: the gate response must not leak token metadata beyond the closed DTO shape.
    const allowedKeys = ['type', 'platform', 'displayName', 'connectUrl', 'reason', 'capabilities'];
    check('gate: requiredActions expose no token/extra fields', reqActions.every((a: any) => Object.keys(a).every((k) => allowedKeys.includes(k))), reqActions[0]);
    // $0 proof: no node ran, no artifact produced while gated.
    const gatedState = await call('GET', `/orchestration/runs/${instRunId}`, tokenA);
    check('gate: 0 artifacts produced (no spend)', (gatedState.body?.data?.artifacts?.length ?? 0) === 0, gatedState.body?.data?.artifacts?.length);
    check('gate: no node left running', !gatedState.body?.data?.nodes?.some((n: any) => n.status === 'running' || n.status === 'completed'), gatedState.body?.data?.nodes?.map((n: any) => n.status));

    // Seed an ACTIVE facebook token for A (the "user connected" step) so the gate now
    // resolves and the happy path proceeds. DRY: a fake token value, never posted live.
    await upsertToken({ ownerId: userA.id, platform: 'facebook', token: 'verify-fake-fb-token', status: 'active' });

    // EXECUTE the instance (async) → must return IMMEDIATELY as running (stuck-Thinking fix).
    const t0 = Date.now();
    // autoPublish:false → force the manual publisher gate so this suite asserts the gate +
    // approve/resume path (and never publishes off a live default). Item 2 default is ON.
    const exec = await call('POST', `/orchestration/runs/${instRunId}/execute`, tokenA, { autoPublish: false });
    const execMs = Date.now() - t0;
    check('execute → 200 running', exec.status === 200 && exec.body?.data?.status === 'running', { s: exec.status, st: exec.body?.data?.status });
    check('execute returns FAST (<3s, not the 30-60s sync hang)', execMs < 3000, `${execMs}ms`);
    // Double-execute while in flight → 409 (no second detached executor).
    check('execute while in flight → 409', (await call('POST', `/orchestration/runs/${instRunId}/execute`, tokenA)).status === 409);

    // Poll for the detached executor to reach the publisher gate (needs_approval).
    let gated: any = null;
    for (let i = 0; i < 40; i++) {
      const r = await call('GET', `/orchestration/runs/${instRunId}`, tokenA);
      if (r.body?.data?.status === 'needs_approval' || r.body?.data?.status === 'failed') { gated = r.body.data; break; }
      await new Promise((res) => setTimeout(res, 500));
    }
    check('execution reached needs_approval (gate)', gated?.status === 'needs_approval', gated?.status);
    const pub = gated?.nodes?.find((n: any) => n.agentId === 'publisher');
    check('publisher node awaiting_approval', pub?.status === 'awaiting_approval', pub?.status);
    check('concept_writer completed', gated?.nodes?.find((n: any) => n.agentId === 'concept_writer')?.status === 'completed');

    // Approve the publisher node → resume (async) → poll to terminal. DRY: the live
    // publish path runs but the materialized Post has fake media → faithful error,
    // ZERO real social posts (the no-burst-posts rule). Guard on the gate being reached.
    if (pub?.nodeId) {
      const resumed = await call('POST', `/orchestration/runs/${instRunId}/approve-node/${pub.nodeId}`, tokenA);
      check('approve-node → 200 running', resumed.status === 200, resumed.status);
      let done: any = null;
      for (let i = 0; i < 40; i++) {
        const r = await call('GET', `/orchestration/runs/${instRunId}`, tokenA);
        if (r.body?.data?.status === 'completed' || r.body?.data?.status === 'failed') { done = r.body.data; break; }
        await new Promise((res) => setTimeout(res, 500));
      }
      check('resume reached terminal (completed|failed)', done?.status === 'completed' || done?.status === 'failed', done?.status);
      const pr = done?.artifacts?.find((a: any) => a.type === 'publish_result');
      check('publish_result artifact present', Boolean(pr), done?.artifacts?.map((a: any) => a.type));
    } else {
      check('publisher gate reached (skipped resume — gate not hit)', false, gated?.status);
    }

    // ---- PRODUCT KNOWLEDGE + PERSONA + language-clean image (the demo fix) ----
    // (a) A thin product over HTTP must trigger the productDetails knowledge gate.
    const thinKnow = await call('POST', '/orchestration/runs', tokenA, { message: 'tôi muốn quảng cáo sản phẩm của tôi trên facebook' });
    check('thin product → awaiting_clarification', thinKnow.body?.data?.status === 'awaiting_clarification', thinKnow.body?.data?.status);
    check('thin product asks productDetails (required)', (thinKnow.body?.data?.questions ?? []).some((q: any) => q.slot === 'productDetails' && q.required), thinKnow.body?.data?.questions?.map((q: any) => q.slot));

    // (b) A rich vi full-campaign with REAL product knowledge → planned, then executed.
    // The infographic node runs BEFORE the publisher gate, so its artifact is available
    // at needs_approval without ever approving a publish (stays DRY — 0 social posts).
    const vi = await call('POST', '/orchestration/runs', tokenA, {
      message: 'Lên chiến dịch branding bằng tiếng Việt cho thương hiệu của công ty tôi: sản phẩm là máy lọc nước thông minh chuyên cung cấp nước sạch cho gia đình, giúp tiết kiệm điện và lọc khuẩn, đối tượng là các gia đình trẻ ở thành phố, đăng facebook kèm infographic',
    });
    check('vi rich campaign → planned', vi.body?.data?.status === 'planned', { st: vi.body?.data?.status, q: vi.body?.data?.questions });
    const viRunId = vi.body?.data?.id;
    check('vi goal captured productDetails', Boolean((vi.body?.data?.goal as any)?.slots?.productDetails), (vi.body?.data?.goal as any)?.slots?.productDetails);
    check('vi goal inferred accountType=company', (vi.body?.data?.goal as any)?.slots?.accountType === 'company', (vi.body?.data?.goal as any)?.slots?.accountType);

    if (viRunId && vi.body?.data?.status === 'planned') {
      await call('POST', `/orchestration/runs/${viRunId}/execute`, tokenA, { autoPublish: false });
      let viGated: any = null;
      for (let i = 0; i < 60; i++) {
        const r = await call('GET', `/orchestration/runs/${viRunId}`, tokenA);
        const st = r.body?.data?.status;
        if (st === 'needs_approval' || st === 'failed' || st === 'completed') { viGated = r.body.data; break; }
        await new Promise((res) => setTimeout(res, 1000));
      }
      check('vi run executed to gate (not failed)', viGated?.status === 'needs_approval', { st: viGated?.status, nodes: viGated?.nodes?.map((n: any) => ({ a: n.agentId, s: n.status, e: n.error })) });
      const info = viGated?.artifacts?.find((a: any) => a.type === 'infographic_brief');
      check('infographic_brief artifact present', Boolean(info), viGated?.artifacts?.map((a: any) => a.type));
      if (info) {
        const brief = String(info.data?.visualBrief ?? '');
        const prompt = String(info.data?.imagePrompt ?? '');
        // Point-2 fix: the USER-FACING brief is Vietnamese — no English scaffolding.
        check('visualBrief has NO English scaffold (vi)', !/Marketing visual for|Positioning:|Angle:|Themes:/i.test(brief), brief);
        check('visualBrief is Vietnamese', /Hình ảnh marketing|Định vị|Góc nhìn|Sản phẩm:/i.test(brief), brief);
        // Point-3 fix: the image prompt (English, sent to the model) is grounded in real
        // product facts, not generic. "lọc nước"/"nước" knowledge must surface.
        check('imagePrompt references product facts', /lọc nước|nước|water|filter/i.test(prompt), prompt);
      }
      // concept_writer must have set Campaign.brandContext from productDetails.
      const camp = await prisma.campaign.findFirst({ where: { ownerId: userA.id }, orderBy: { createdAt: 'desc' } });
      check('Campaign.brandContext set from productDetails', Boolean(camp?.brandContext), camp?.brandContext?.slice(0, 80));
      check('Campaign.brandVoice set for company persona', Boolean(camp?.brandVoice), camp?.brandVoice);
    }

    // List runs for A.
    const list = await call('GET', '/orchestration/runs', tokenA);
    check('list returns A\'s runs', (list.body?.data?.length ?? 0) >= 2, list.body?.data?.length);
    check('list 401 for no token', (await call('GET', '/orchestration/runs')).status === 401);

    // ---- DELETE a run (Saved Flow) ----
    // Spin up a fresh planned run, then delete it: 204, gone on re-GET, cross-tenant 404.
    const delRun = await call('POST', '/orchestration/runs', tokenA, {
      message: 'Post about our AI automation product on facebook, audience SMBs, angle save time, with file id 1bo4diy3vlH9VmRE-78Z15ux9053-KZci',
    });
    const delRunId = delRun.body?.data?.id;
    check('delete: fresh run created', Boolean(delRunId), delRun.body?.data?.status);
    check('delete: cross-tenant → 404', (await call('DELETE', `/orchestration/runs/${delRunId}`, tokenB)).status === 404);
    check('delete: no token → 401', (await call('DELETE', `/orchestration/runs/${delRunId}`)).status === 401);
    const del = await call('DELETE', `/orchestration/runs/${delRunId}`, tokenA);
    check('delete: owner → 204', del.status === 204, del.status);
    check('delete: run gone (GET → 404)', (await call('GET', `/orchestration/runs/${delRunId}`, tokenA)).status === 404);
    check('delete: already-deleted → 404', (await call('DELETE', `/orchestration/runs/${delRunId}`, tokenA)).status === 404);

    // ---- Campaign ↔ Flow link (sidebar tree) ----
    // Create a flow, attach a campaign to it, verify the link, then delete the flow and
    // assert the campaign SURVIVES with flowId nulled (SetNull — content outlives flow).
    const flowForCamp = await call('POST', '/orchestration/runs', tokenA, {
      message: 'Post about our AI automation product on facebook, audience SMBs, angle save time, with file id 1bo4diy3vlH9VmRE-78Z15ux9053-KZci',
    });
    const flowCampId = flowForCamp.body?.data?.id;
    const campUnderFlow = await call('POST', '/campaigns', tokenA, { product: 'Flow-linked campaign', flowId: flowCampId });
    check('campaign create under flow → 201 with flowId', campUnderFlow.status === 201 && campUnderFlow.body?.data?.flowId === flowCampId, { s: campUnderFlow.status, f: campUnderFlow.body?.data?.flowId });
    const campUnderFlowId = campUnderFlow.body?.data?.id;
    check('campaign create under another tenant flow → 404', (await call('POST', '/campaigns', tokenB, { product: 'x', flowId: flowCampId })).status === 404);
    // List campaigns shows the flowId so the sidebar can nest it.
    const campList = await call('GET', '/campaigns', tokenA);
    check('campaign list carries flowId', campList.body?.data?.some((c: any) => c.id === campUnderFlowId && c.flowId === flowCampId), campList.body?.data?.find((c: any) => c.id === campUnderFlowId));
    // Delete the flow → campaign survives, flowId nulled (NOT cascaded away).
    check('delete flow with a campaign → 204', (await call('DELETE', `/orchestration/runs/${flowCampId}`, tokenA)).status === 204);
    const orphan = await call('GET', `/campaigns/${campUnderFlowId}`, tokenA);
    check('campaign survives flow delete (SetNull)', orphan.status === 200 && orphan.body?.data?.flowId === null, { s: orphan.status, f: orphan.body?.data?.flowId });
    // Cleanup the orphan campaign.
    await call('DELETE', `/campaigns/${campUnderFlowId}`, tokenA);

    // ---- Connections (M2-lite, read-only) ----
    check('GET /connections 401 without token', (await call('GET', '/connections')).status === 401);
    const conns = await call('GET', '/connections', tokenA);
    check('GET /connections 200 for A', conns.status === 200, conns.status);
    // Always lists all 5 platforms (connected or not) — fresh tenant A has none yet.
    const rows = conns.body?.data ?? [];
    check('connections lists 5 platforms', rows.length === 5, rows.length);
    // facebook was seeded active above (the connection-gate happy path); the other 4
    // remain not_connected for this tenant.
    check('seeded facebook → connected', rows.find((r: any) => r.platformKey === 'facebook')?.state === 'connected', rows.map((r: any) => [r.platformKey, r.state]));
    check('other platforms → not_connected', rows.filter((r: any) => r.platformKey !== 'facebook').every((r: any) => r.state === 'not_connected'), rows.map((r: any) => [r.platformKey, r.state]));
    check('each row carries capabilities + connectUrl', rows.every((r: any) => Array.isArray(r.capabilities) && typeof r.connectUrl === 'string'), rows[0]);
    check('no token value leaked in connection rows', rows.every((r: any) => !('token' in r) && !('refreshToken' in r)), rows[0]);

    // ---- Generated media route (/media/images) ----
    // Unknown file → 404 (route mounted, fallthrough:false, errorHandler respects the
    // 404 status). The 200-serve of a real PNG is exercised in the manual e2e: this
    // script runs on the HOST but the API serves the CONTAINER filesystem (separate
    // disks), so a host-side PNG isn't fetchable here — checking it would be a false
    // negative. The route + error mapping is what we assert programmatically.
    const missing = await fetch(`${BASE}/media/images/does-not-exist.png`);
    check('media unknown file → 404 (route mounted)', missing.status === 404, missing.status);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    console.log('cleanup: 2 throwaway tenants removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — orchestration API checks green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
