// Atria Phase 02 verification — pure, no DB/LLM/network. Asserts suggestPublishTimes emits
// one non-empty suggestion per platform (order-matched), degrades unknown platforms to a
// generic suggestion without throwing, leans its rationale wording by audience (B2B vs
// teen/consumer) and by language (vi vs en), and that summarizeTiming covers every platform.
// Mirrors verify-planner.ts conventions (check() helper, failure count, process.exit).
import { suggestPublishTimes, summarizeTiming } from '../agents/publish-timing/suggest-time.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : '');
  }
};

// Basic shape — 3 known platforms, order preserved, all fields populated.
{
  console.log('Basic: known platforms');
  const platforms = ['facebook', 'linkedin', 'x'];
  const result = suggestPublishTimes({ platforms });
  check('3 suggestions returned', result.length === 3, result.length);
  check('platform order preserved', JSON.stringify(result.map((r) => r.platform)) === JSON.stringify(platforms), result.map((r) => r.platform));
  for (const s of result) {
    check(`${s.platform}: window non-empty`, typeof s.window === 'string' && s.window.length > 0, s.window);
    check(`${s.platform}: localTime non-empty`, typeof s.localTime === 'string' && s.localTime.length > 0, s.localTime);
    check(`${s.platform}: rationale non-empty`, typeof s.rationale === 'string' && s.rationale.length > 0, s.rationale);
  }
}

// Unknown platform → generic suggestion, no throw.
{
  console.log('Unknown platform: mastodon');
  let result: ReturnType<typeof suggestPublishTimes> | undefined;
  let threw = false;
  try {
    result = suggestPublishTimes({ platforms: ['mastodon'] });
  } catch {
    threw = true;
  }
  check('does not throw', !threw);
  check('1 generic suggestion returned', !!result && result.length === 1, result);
  if (result) {
    const first = result[0]!;
    check('platform preserved', first.platform === 'mastodon', first.platform);
    check('generic window/rationale present', first.window.length > 0 && first.rationale.length > 0, first);
  }
}

// Audience-aware rationale: B2B leans business-hours wording, teen/consumer leans evenings —
// the two rationales must differ.
{
  console.log('Audience-aware rationale');
  const b2b = suggestPublishTimes({ platforms: ['linkedin'], audience: 'B2B SaaS buyers' })[0]!;
  const teen = suggestPublishTimes({ platforms: ['linkedin'], audience: 'teen gamers' })[0]!;
  check('b2b rationale mentions business hours', /business hours/i.test(b2b.rationale), b2b.rationale);
  check('teen rationale mentions evenings/weekends', /evenings|weekend/i.test(teen.rationale), teen.rationale);
  check('b2b and teen rationales differ', b2b.rationale !== teen.rationale, { b2b: b2b.rationale, teen: teen.rationale });
}

// Language: vi produces Vietnamese text, differing from the equivalent en call.
{
  console.log('Language-aware rationale');
  const vi = suggestPublishTimes({ platforms: ['facebook'], language: 'vi' })[0]!;
  const en = suggestPublishTimes({ platforms: ['facebook'], language: 'en' })[0]!;
  check('vi rationale contains Vietnamese diacritics', /[ăâđêôơư]/i.test(vi.rationale), vi.rationale);
  check('vi and en rationales differ', vi.rationale !== en.rationale, { vi: vi.rationale, en: en.rationale });
}

// summarizeTiming covers every platform id.
{
  console.log('summarizeTiming');
  const platforms = ['facebook', 'instagram', 'threads', 'linkedin', 'x'];
  const suggestions = suggestPublishTimes({ platforms });
  const summary = summarizeTiming(suggestions);
  for (const p of platforms) {
    check(`summary mentions ${p}`, summary.includes(p), summary);
  }
}

console.log(failures === 0 ? '\nPASS — all publish-timing checks green' : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
