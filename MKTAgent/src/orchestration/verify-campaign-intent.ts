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

console.log(failures === 0 ? '\nPASS — campaign-intent detector green' : `\nFAIL — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
