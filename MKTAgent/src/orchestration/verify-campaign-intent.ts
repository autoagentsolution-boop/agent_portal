// Unit checks for the campaign-create intent detector (item 2). Deterministic, no DB.
import { detectCampaignIntent } from './master/campaign-intent.ts';
import { goalSpec } from './schemas/goal-spec.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const g = goalSpec.parse({
  outputs: { needsTextPost: true, needsPublishing: true }, platforms: ['facebook'],
  slots: {}, confidence: 0.9, provider: 'deterministic',
});

// Positive — explicit create intent (the masteragent1.png message).
const p1 = detectCampaignIntent('Let make a first campaign "Abstract User". First post will be "Do you tired of Manual work?"', g);
check('detects create campaign (EN)', p1.isCreate, p1);
check('extracts campaign name', p1.campaignName === 'Abstract User', p1.campaignName);
check('extracts post title', p1.postTitle === 'Do you tired of Manual work?', p1.postTitle);

// Positive — Vietnamese.
check('detects tạo campaign (VN)', detectCampaignIntent('tạo chiến dịch đầu tiên cho tôi', g).isCreate);
check('detects tạo bài (VN)', detectCampaignIntent('làm bài viết đầu tiên', g).isCreate);

// Positive — bare affirmation to the save-offer.
check('bare "yes" → create', detectCampaignIntent('yes', g).isCreate);
check('bare "có" → create', detectCampaignIntent('có', g).isCreate);

// Negative — must NOT hijack a "plan a different flow" message.
check('new flow request → NOT create', !detectCampaignIntent('build a full branding flow for a new product', g).isCreate,
  detectCampaignIntent('build a full branding flow for a new product', g));
check('bare mention of campaign word → NOT create', !detectCampaignIntent('what does the campaign plan look like?', g).isCreate);
check('mid-sentence yes → NOT create', !detectCampaignIntent('yes but change the video to an image', g).isCreate);

// REGRESSION (bug 2026-07-13, session b8064b19) — the VERBATIM message that reproduced a new flow.
// Incidental "schedule" must NOT hijack a clearly-named single-campaign create-from-flow.
const real = detectCampaignIntent(
  'Let create a first campaigns "Impression". First post will be related how Atria help people to achieve their daily task. Specially for the marketing purpose where we can schedule it or on demand',
  g,
);
check('real msg: "schedule it" does NOT block create', real.isCreate, real);
check('real msg: not misrouted to plan', !real.isPlan, real);
check('real msg: not ambiguous', !real.isAmbiguous, real);
check('real msg: campaign name = Impression', real.campaignName === 'Impression', real.campaignName);

// Batch/plan asks → isPlan (fall through to strategist), NOT create-from-flow.
check('weekly campaigns → plan', detectCampaignIntent('plan weekly campaigns for me', g).isPlan);
check('content calendar → plan (batch wins over create verb)', detectCampaignIntent('make a content calendar for the month', g).isPlan);
check('chiến dịch hàng tuần → plan', detectCampaignIntent('lên lịch chiến dịch hàng tuần', g).isPlan);
check('create weekly campaigns → plan (batch phrase wins)', detectCampaignIntent('create weekly campaigns', g).isPlan);

// Genuinely ambiguous — a NAMED single create AND a batch phrase together → reconfirm.
const amb = detectCampaignIntent('create campaign "Launch" with weekly posts', g);
check('named create + weekly posts → ambiguous (reconfirm)', amb.isAmbiguous && !amb.isCreate && !amb.isPlan, amb);

// Reconfirm answers resolve cleanly.
check('"single" answer → create', detectCampaignIntent('single', g).isCreate);
check('"weekly" answer → plan', detectCampaignIntent('weekly', g).isPlan);

console.log(failures === 0 ? '\nPASS — campaign-intent detector green' : `\nFAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
