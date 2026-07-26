// Deterministic intent-corpus guard (unit tier). The adversarial corpus in testing/intent-corpus.ts
// documents (in its own header) TWO consumers: the live-gemini smoke in verify-master (INTENT, the
// model must get right) AND *this* file — "asserts the DETERMINISTIC regex path's known failures, so
// a regression in the fallback is caught, and documents exactly which cases the regex CANNOT do."
// That second consumer never existed until now. This is CHARACTERIZATION: it records what the regex
// fallback (analyzeDeterministic + parseRemovals) does TODAY — the FACT cases it must keep getting
// right, and the INTENT cases it provably cannot (asserted as "does NOT mis-fire", not as success).
// It is the safety net for the Phase-3 "split parsers by concern" decomposition: any change that
// shifts which target a removal verb binds to fails here. Pure, no network/DB/LLM.
import {
  FALSE_REMOVAL_CASES,
  NESTED_NEGATION_CASES,
  TRUE_REMOVAL_CASES,
  FACT_CASES,
  SCOPE_CASES,
} from '../orchestration/testing/intent-corpus.ts';
import { analyzeDeterministic, parseRemovals } from '../orchestration/master/deterministic-analyzer.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// ── FACT extraction: platforms the regex MUST keep (this is the regex's job — must stay green) ──────
console.log('FACT — platforms the deterministic parser must extract:');
for (const c of FACT_CASES) {
  const g = analyzeDeterministic(c.message);
  for (const p of c.expect.platformsInclude ?? []) {
    check(`${c.id}: platform '${p}' present`, g.platforms.includes(p as (typeof g.platforms)[number]), { got: g.platforms });
  }
  if (c.expect.campaignScope) check(`${c.id}: scope '${c.expect.campaignScope}'`, g.campaignScope === c.expect.campaignScope, { got: g.campaignScope });
}

// ── TRUE removals: refine-turn removals the regex handles — must STILL fire after a concern-split ───
console.log('\nTRUE REMOVAL — the regex fallback must catch these (regression guards):');
for (const c of TRUE_REMOVAL_CASES) {
  const r = parseRemovals(c.message);
  for (const o of c.expect.removedOutputs ?? []) {
    check(`${c.id}: output '${o}' disabled`, r.disableOutputs.includes(o as (typeof r.disableOutputs)[number]), { got: r.disableOutputs });
  }
  for (const p of c.expect.removedPlatforms ?? []) {
    check(`${c.id}: platform '${p}' dropped`, r.dropPlatforms.includes(p as (typeof r.dropPlatforms)[number]), { got: r.dropPlatforms });
  }
}

// ── FALSE REMOVAL — a removal verb is present but modifies something else. Two sub-classes emerge in
//    the CURRENT deterministic behavior (this is characterization, not a wish-list):
//      • near-verb-suppressed: the verb is far from the target, the 24-char window suppresses it
//        (publish-without-review, without-a-doubt). The regex gets these RIGHT.
//      • regex-CANNOT: the removal verb sits adjacent to a platform the user is actually KEEPING
//        ("I no longer want just Facebook — post to Instagram too"). The near-verb window can't tell
//        "no longer just FB" (additive) from "no longer FB" (removal) — that needs INTENT, which is
//        the model's job (asserted in verify-master's live smoke). We record the HONEST current
//        behavior: the regex DOES drop facebook here. Flipping this to "kept" is a Phase-2+ fix, not
//        a Phase-0 characterization change. The corpus `regexWeakness` field documents why.
console.log('\nFALSE REMOVAL — verb present but NOT a removal:');
// The near-verb window SUPPRESSES these (regex gets them right):
const REGEX_SUPPRESSES = new Set(['publish-without-review', 'without-a-doubt']);
// The regex provably CANNOT do these (adjacent verb+keep-target) — recorded, not asserted as success:
const REGEX_CANNOT = new Set(['no-longer-just-fb']);
for (const c of FALSE_REMOVAL_CASES) {
  const r = parseRemovals(c.message);
  const g = analyzeDeterministic(c.message);
  if (REGEX_SUPPRESSES.has(c.id) && c.expect.noRemoval) {
    check(`${c.id}: NO output wrongly disabled`, r.disableOutputs.length === 0, { wrongly: r.disableOutputs });
    check(`${c.id}: NO platform wrongly dropped`, r.dropPlatforms.length === 0, { wrongly: r.dropPlatforms });
  }
  if (REGEX_CANNOT.has(c.id)) {
    // Characterize the KNOWN limitation: the regex mis-drops facebook here. This assertion pins the
    // CURRENT wrong-but-known behavior so a Phase-3 split can't silently make it *different* (better
    // or worse) without a conscious update. When Phase 2 lands the model-authoritative fix, flip this.
    check(`${c.id}: [KNOWN regex limit] facebook IS mis-dropped (model fixes this, not regex)`,
      r.dropPlatforms.includes('facebook'), { got: r.dropPlatforms });
  }
  // In all cases, the ADDITIVE platforms the sentence asks for must survive.
  for (const p of c.expect.platformsInclude ?? []) {
    check(`${c.id}: kept platform '${p}'`, g.platforms.includes(p as (typeof g.platforms)[number]), { got: g.platforms });
  }
  if (c.expect.needsVideo) check(`${c.id}: video kept (not dropped)`, g.outputs.needsVideo === true, { outputs: g.outputs });
  if (c.expect.needsPublishing) check(`${c.id}: publishing kept`, g.outputs.needsPublishing === true, { outputs: g.outputs });
}

// ── NESTED NEGATION: "don't X but do Y" — documented as something the regex CANNOT express. We do NOT
//    assert the regex gets it right (it can't — that's the model's job). We characterize the honest
//    current behavior: the regex must at least not DROP the platform the user explicitly asked to keep.
//    (If a future split made this WORSE — e.g. dropping instagram — that's a real regression to catch.)
console.log('\nNESTED NEGATION — regex cannot fully parse; assert it does not lose the KEEP target:');
for (const c of NESTED_NEGATION_CASES) {
  const g = analyzeDeterministic(c.message);
  for (const p of c.expect.platformsInclude ?? []) {
    check(`${c.id}: keeps requested platform '${p}'`, g.platforms.includes(p as (typeof g.platforms)[number]), { got: g.platforms });
  }
}

// ── SCOPE: single-vs-campaign escalation the deterministic parser owns ──────────────────────────────
console.log('\nSCOPE — campaign escalation the deterministic parser must get right:');
for (const c of SCOPE_CASES) {
  const g = analyzeDeterministic(c.message);
  if (c.expect.campaignScope) check(`${c.id}: scope '${c.expect.campaignScope}'`, g.campaignScope === c.expect.campaignScope, { got: g.campaignScope });
  for (const p of c.expect.platformsInclude ?? []) {
    check(`${c.id}: platform '${p}'`, g.platforms.includes(p as (typeof g.platforms)[number]), { got: g.platforms });
  }
}

console.log(failures === 0
  ? '\nPASS — deterministic intent corpus characterized (fact/true-removal green, false-removal suppressed)'
  : `\nFAIL — ${failures} corpus assertion(s) drifted`);
process.exit(failures === 0 ? 0 : 1);
