// Phase 2 verification — analyzer (deterministic path) + clarification engine +
// master-agent wiring. Pure, no DB. A live Gemini smoke runs only if GEMINI_API_KEY
// is set (otherwise the deterministic fallback is exercised, which is the contract).
import { analyzeDeterministic } from './master/deterministic-analyzer.ts';
import { evaluateClarification } from './master/clarification-engine.ts';
import { MasterAgent } from './master/master-agent.ts';
import { deterministicReply, conversationAuthor } from './master/conversation-author.ts';
import { detectLanguage } from './master/detect-language.ts';
import { mergeGoals, applyRemovals } from './master/goal-merge.ts';
import { parseRemovals } from './master/deterministic-analyzer.ts';
import { agentIdList } from './schemas/workflow-plan.ts';
import { env } from '../config/env.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Deterministic intent extraction.
{
  console.log('Deterministic analyzer');
  const g = analyzeDeterministic('Make a Facebook and LinkedIn post with a short video for our AI automation product');
  check('detects facebook + linkedin', g.platforms.includes('facebook') && g.platforms.includes('linkedin'), g.platforms);
  check('needsVideo from "video"', g.outputs.needsVideo === true);
  check('needsTextPost default true', g.outputs.needsTextPost === true);
  check('product extracted', Boolean(g.slots.product), g.slots.product);

  const draftOnly = analyzeDeterministic('Write a draft only post about our course, do not publish');
  check('needsPublishing false on draft-only', draftOnly.outputs.needsPublishing === false);
}

// Clarification: missing product → asks (required).
{
  console.log('Clarification engine');
  const vague = analyzeDeterministic('Make me a marketing flow');
  const r = evaluateClarification(vague);
  check('vague (no product) → needs_clarification', r.status === 'needs_clarification', r);
  if (r.status === 'needs_clarification') {
    check('asks product (required)', r.questions.some((q) => q.slot === 'product' && q.required), r.questions);
    check('≤5 questions', r.questions.length <= 5, r.questions.length);
  }

  // RICHNESS GATE: product + a single platform but no audience/angle is too thin to
  // plan well — the old engine jumped straight to a bare DAG ("it's dumb"). Now it
  // must ask the high-impact targeting questions first.
  const thin = analyzeDeterministic('Post about our AI automation product on facebook');
  const rThin = evaluateClarification(thin);
  check('thin (product+platform only) → needs_clarification', rThin.status === 'needs_clarification', rThin);
  if (rThin.status === 'needs_clarification') {
    check('thin asks audience (required)', rThin.questions.some((q) => q.slot === 'targetAudience' && q.required), rThin.questions);
    check('thin asks angle (required)', rThin.questions.some((q) => q.slot === 'angle' && q.required), rThin.questions);
  }

  // No platform either → also thin, and the platforms question becomes required.
  const noPlatform = analyzeDeterministic('Post about our AI automation product');
  const rNo = evaluateClarification(noPlatform);
  check('no-platform thin → needs_clarification', rNo.status === 'needs_clarification', rNo);
  check('thin promotes platforms to required', rNo.status === 'needs_clarification' && rNo.questions.some((q) => q.slot === 'platforms' && q.required), rNo);

  // RICH: product + audience + angle (≥2 high-impact slots) → enough to plan, no gate.
  const rich = analyzeDeterministic('Post about our AI automation product on facebook, target audience is small business owners, angle is saving operational time');
  const rRich = evaluateClarification(rich);
  check('rich (product+audience+angle) → ready', rRich.status === 'ready', { status: rRich.status, slots: rich.slots, platforms: rich.platforms });
}

// Master agent end-to-end (deterministic): thin → clarify, rich → planned DAG.
{
  console.log('MasterAgent.planFromGoal');
  const agent = new MasterAgent();

  // The FB-post example from the screenshot: now asks before planning.
  const thin = analyzeDeterministic('Post about our AI automation product on facebook with an infographic');
  const outThin = agent.planFromGoal(thin);
  check('thin FB example → awaiting_clarification', outThin.status === 'awaiting_clarification', outThin.status);

  // Richly specified → plans the full DAG.
  const rich = analyzeDeterministic('Post about our AI automation product on facebook with an infographic, target audience is small business owners, angle is saving operational time');
  const out = agent.planFromGoal(rich);
  check('rich → planned', out.status === 'planned', out.status);
  if (out.status === 'planned') {
    check('plan has concept_writer + infographic + publisher',
      ['concept_writer', 'infographic', 'publisher'].every((a) => agentIdList(out.plan).includes(a as never)),
      agentIdList(out.plan));
  }

  const vague = analyzeDeterministic('help me with marketing');
  const out2 = agent.planFromGoal(vague);
  check('vague → awaiting_clarification', out2.status === 'awaiting_clarification', out2.status);
}

// Conversational refinement: a follow-up message must MERGE onto the prior goal, not
// reset it (the "re-asks everything when I add an image" bug). Uses planFromGoal +
// mergeGoals directly (no LLM) to keep the assertion deterministic.
{
  console.log('Refinement merge (goal-merge)');
  const rich = analyzeDeterministic('Post about our AI automation product on facebook, audience small business owners, angle saving operational time');
  const richOut = new MasterAgent().planFromGoal(rich);
  check('rich baseline → planned', richOut.status === 'planned', richOut.status);

  // The follow-up "I also want to add an image" mentions no product/audience/platform.
  const delta = analyzeDeterministic('tôi muốn up ảnh nữa, thêm infographic');
  const merged = mergeGoals(rich, delta);
  check('merge keeps product', Boolean(merged.slots.product), merged.slots.product);
  check('merge keeps audience', Boolean(merged.slots.targetAudience), merged.slots.targetAudience);
  check('merge keeps platforms', merged.platforms.includes('facebook'), merged.platforms);
  check('merge adds infographic', merged.outputs.needsInfographic === true, merged.outputs);

  const mergedOut = new MasterAgent().planFromGoal(merged);
  check('merged still plans (no re-clarify)', mergedOut.status === 'planned', mergedOut.status);
}

// Subtractive refinement: a removal phrase ("bỏ video") must un-set the named output
// AFTER the additive merge, keep everything else, and never produce an empty plan.
{
  console.log('Subtractive refinement (applyRemovals)');
  const base = analyzeDeterministic('Full branding campaign for our AI automation product on facebook, audience small business owners, angle saving time, with infographic and video');
  check('base has video+infographic', base.outputs.needsVideo && base.outputs.needsInfographic, base.outputs);

  // "bỏ video" — removal verb + target. parseRemovals should flag video only.
  const rmVideo = parseRemovals('bỏ video đi, giữ nguyên phần còn lại');
  check('parseRemovals detects video', rmVideo.disableOutputs.includes('video'), rmVideo);
  check('parseRemovals no false platform', rmVideo.dropPlatforms.length === 0, rmVideo);

  const afterRemove = applyRemovals(base, rmVideo);
  check('video removed', afterRemove.outputs.needsVideo === false, afterRemove.outputs);
  check('infographic kept', afterRemove.outputs.needsInfographic === true, afterRemove.outputs);
  check('product kept after removal', Boolean(afterRemove.slots.product), afterRemove.slots.product);
  check('platforms kept after removal', afterRemove.platforms.includes('facebook'), afterRemove.platforms);

  // "thêm video" is additive, NOT a removal — must not trip the parser.
  const notRemoval = parseRemovals('thêm video nữa nhé');
  check('additive phrase is not a removal', notRemoval.disableOutputs.length === 0 && notRemoval.dropPlatforms.length === 0, notRemoval);

  // Drop a platform.
  const rmFb = parseRemovals('remove facebook');
  const afterDrop = applyRemovals(base, rmFb);
  check('facebook dropped', !afterDrop.platforms.includes('facebook'), afterDrop.platforms);

  // Empty-plan guard: removing every output must fall back to a text post (plannable).
  const rmAll = { disableOutputs: ['ideation', 'strategy', 'research', 'infographic', 'video', 'publishing'] as const, dropPlatforms: [] };
  const guarded = applyRemovals({ ...base, outputs: { ...base.outputs, needsTextPost: false } }, { disableOutputs: [...rmAll.disableOutputs], dropPlatforms: [] });
  check('empty-plan guard keeps a text post', guarded.outputs.needsTextPost === true, guarded.outputs);
  const guardedOut = new MasterAgent().planFromGoal(guarded);
  check('guarded goal still plannable', guardedOut.status === 'planned' || guardedOut.status === 'awaiting_clarification', guardedOut.status);
}

// Product KNOWLEDGE + persona capture. A placeholder product ("sản phẩm của tôi") must
// not satisfy the gate; the agent must ask for real product knowledge + who's marketing.
{
  console.log('Product knowledge + persona gate');

  // Thin: a placeholder product with no details → must ask productDetails (required) +
  // accountType (required). This is the exact screenshot bug.
  const thin = analyzeDeterministic('tôi muốn quảng cáo sản phẩm của tôi trên facebook');
  check('placeholder product yields no productDetails', !thin.slots.productDetails, thin.slots.productDetails);
  const rThin = evaluateClarification(thin);
  check('thin product → needs_clarification', rThin.status === 'needs_clarification', rThin.status);
  if (rThin.status === 'needs_clarification') {
    check('asks productDetails (required)', rThin.questions.some((q) => q.slot === 'productDetails' && q.required), rThin.questions);
    check('asks accountType (required)', rThin.questions.some((q) => q.slot === 'accountType' && q.required), rThin.questions);
  }

  // Rich product knowledge → productDetails filled, gate cleared, NOT re-asked.
  const rich = analyzeDeterministic('Quảng cáo trên facebook, sản phẩm của tôi chuyên cung cấp phần mềm quản lý kho cho doanh nghiệp vừa và nhỏ, giúp tiết kiệm thời gian, đối tượng là chủ shop online');
  check('rich product fills productDetails', Boolean(rich.slots.productDetails), rich.slots.productDetails);
  const rRich = evaluateClarification(rich);
  check('rich product → ready (no productDetails re-ask)', rRich.status === 'ready', { status: rRich.status, details: rich.slots.productDetails });

  // accountType inference from phrasing.
  check('infers company from "doanh nghiệp"', rich.slots.accountType === 'company', rich.slots.accountType);
  const personal = analyzeDeterministic('mình muốn quảng bá cá nhân, sản phẩm là khoá học dạy vẽ online cho người mới bắt đầu');
  check('infers personal from "cá nhân"', personal.slots.accountType === 'personal', personal.slots.accountType);
  const brand = analyzeDeterministic('quảng cáo cho thương hiệu thời trang của shop, sản phẩm là áo thun in hình theo yêu cầu');
  check('infers business from "thương hiệu/shop"', brand.slots.accountType === 'business', brand.slots.accountType);

  // mergeGoals keeps the two new slots across a refinement turn.
  const delta = analyzeDeterministic('thêm infographic nữa');
  const merged = mergeGoals(rich, delta);
  check('merge keeps productDetails', Boolean(merged.slots.productDetails), merged.slots.productDetails);
  check('merge keeps accountType', merged.slots.accountType === 'company', merged.slots.accountType);
}

// Conversation author (deterministic fallback — no LLM needed). Voices each outcome.
{
  console.log('ConversationAuthor (deterministic fallback)');
  const agent = new MasterAgent();
  const thin = agent.planFromGoal(analyzeDeterministic('Post about our AI automation product on facebook'));
  const clarifyReply = deterministicReply(thin);
  check('clarify reply mentions a question', /audience|angle|platform/i.test(clarifyReply), clarifyReply);

  const rich = agent.planFromGoal(analyzeDeterministic('Post about our AI automation product on facebook, target audience is small business owners, angle is saving time'));
  const planReply = deterministicReply(rich);
  check('plan reply names approval + a step', /approve/i.test(planReply) && /publish|step|concept/i.test(planReply), planReply);
}

// Language detection (the wrong-language-reply bug). Pure, no LLM. Non-Latin scripts
// resolve to a code; Latin-script messages return null (the LLM mirrors the message).
{
  console.log('detectLanguage (multi-script)');
  check('Latin/English → null (model mirrors)', detectLanguage('Write a short LinkedIn post about our new feature') === null);
  check('VN diacritics → vi', detectLanguage('Lên chiến dịch branding cho sản phẩm của tôi') === 'vi');
  check('unaccented VN → vi', detectLanguage('toi muon dang bai ban hang moi ngay') === 'vi');
  check('Thai → th', detectLanguage('เขียนโพสต์สั้นๆ เกี่ยวกับฟีเจอร์ใหม่') === 'th');
  check('Japanese (kana) → ja', detectLanguage('新機能についての短い投稿を書いて') === 'ja');
  check('Korean → ko', detectLanguage('새로운 기능에 대한 짧은 게시물을 작성해줘') === 'ko');
  check('Russian (Cyrillic) → ru', detectLanguage('Напишите короткий пост о новой функции') === 'ru');
  check('Arabic → ar', detectLanguage('اكتب منشورًا قصيرًا عن الميزة الجديدة') === 'ar');
  check('French (Latin) → null (model mirrors)', detectLanguage('Rédige un court post LinkedIn sur notre nouvelle fonctionnalité') === null);
  check('empty → null', detectLanguage('') === null);
}

// Optional live Gemini smoke.
async function geminiSmoke(): Promise<void> {
  if (!env.GEMINI_API_KEY) { console.log('Gemini smoke: SKIPPED (no GEMINI_API_KEY)'); return; }
  console.log('Gemini smoke (live)');
  const { GeminiRequirementAnalyzer } = await import('./master/requirement-analyzer.ts');
  const g = await new GeminiRequirementAnalyzer().analyze('I want a short video post for my coffee shop on Instagram');
  check('gemini returns valid GoalSpec', g.goal === 'marketing_content', g);
  check('gemini detects instagram', g.platforms.includes('instagram'), g.platforms);
  check('gemini provider tagged', g.provider.startsWith('gemini') || g.provider === 'deterministic-v1', g.provider);

  // Language fidelity: the reply must mirror the user's message language even though the
  // clarification seeds are partly Vietnamese (the reported bug). Pass the raw message so
  // the model mirrors it. (a) English message → NO Vietnamese diacritics.
  const VI_DIA = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;
  const agentL = new MasterAgent();
  const enMsg = 'Write a short LinkedIn post about our new feature';
  const enReply = await conversationAuthor.author(agentL.planFromGoal(analyzeDeterministic(enMsg)), [], { userMessage: enMsg, language: null });
  check('EN message → reply has NO Vietnamese diacritics', !VI_DIA.test(enReply), enReply.slice(0, 160));

  // (b) A NON-Latin, non-VN language (Thai) → reply is in Thai script (proves the fix
  // covers languages beyond vi/en — the user's point). Detected code 'th' pins it.
  const thMsg = 'เขียนโพสต์ LinkedIn สั้นๆ เกี่ยวกับฟีเจอร์ใหม่ของเรา';
  const thReply = await conversationAuthor.author(agentL.planFromGoal(analyzeDeterministic(thMsg)), [], { userMessage: thMsg, language: 'th' });
  check('Thai message → reply contains Thai script', /[฀-๿]/.test(thReply), thReply.slice(0, 160));
}

await geminiSmoke();
console.log(failures === 0 ? '\nPASS — all master/clarification checks green' : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
