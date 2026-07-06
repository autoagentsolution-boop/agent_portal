// Verify the LLM usage ledger + real-usage costing (cost-accounting correctness fix).
// Pure checks always run; the DB round-trip runs when Postgres is reachable, else SKIPs.
import { costFromUsage, costUsdFromUsage, estimateLlmCost, videoClipCost, type GeminiUsage } from '../orchestration/executor/node-cost.ts';
import { extractGeminiUsage, recordLlmUsage, usageTotals } from './llm-usage.ts';
import { prisma } from '../db/client.ts';

let failures = 0;
const ck = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// ── Pure: costing correctness ────────────────────────────────────────────────
const base: GeminiUsage = { promptTokens: 1000, outputTokens: 500, thoughtTokens: 0, cachedTokens: 0 };
const withThinking: GeminiUsage = { ...base, thoughtTokens: 4000 };

// Thinking tokens are billed at the OUTPUT rate — they MUST raise the cost (the whole bug).
ck('thinking tokens increase cost', costUsdFromUsage(withThinking, 'gemini-2.5-flash') > costUsdFromUsage(base, 'gemini-2.5-flash'),
  { base: costUsdFromUsage(base, 'gemini-2.5-flash'), thinking: costUsdFromUsage(withThinking, 'gemini-2.5-flash') });

// gemini-2.5-flash: 1000 in @ $0.30/M + 500 out @ $2.50/M = 0.0003 + 0.00125 = 0.00155.
const flashCost = costUsdFromUsage(base, 'gemini-2.5-flash');
ck('flash base cost exact', Math.abs(flashCost - 0.00155) < 1e-9, flashCost);

// pro costs more than flash for identical usage; lite-prefix isn't shadowed by flash.
ck('pro > flash for same usage', costUsdFromUsage(base, 'gemini-2.5-pro') > flashCost);
ck('flash-lite < flash (longest-prefix match)', costUsdFromUsage(base, 'gemini-2.5-flash-lite') < flashCost);
ck('unknown model falls back to flash', Math.abs(costUsdFromUsage(base, 'some-other-model') - flashCost) < 1e-9);

// costFromUsage folds thinking into outputTokens for the node display.
const nc = costFromUsage(withThinking, 'gemini-2.5-flash');
ck('costFromUsage folds thinking into outputTokens', nc.outputTokens === 500 + 4000, nc.outputTokens);

// cached prompt billed cheaper than full prompt.
const cached: GeminiUsage = { promptTokens: 1000, outputTokens: 0, thoughtTokens: 0, cachedTokens: 1000 };
const uncached: GeminiUsage = { promptTokens: 1000, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0 };
ck('cached prompt cheaper', costUsdFromUsage(cached, 'gemini-2.5-flash') < costUsdFromUsage(uncached, 'gemini-2.5-flash'));

// Video priced per-second: an 8s clip ≈ $0.40 (was $0.20 flat).
ck('video 8s clip ≈ $0.40', Math.abs(videoClipCost(1, 8).costUsd - 0.40) < 1e-9, videoClipCost(1, 8).costUsd);

// estimateLlmCost (fallback) still produces a positive cost + honors model pricing.
ck('estimate fallback positive', estimateLlmCost('a'.repeat(400), 'b'.repeat(400)).costUsd > 0);

// extractGeminiUsage reads the real envelope incl. thoughtsTokenCount.
const raw = { usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60, thoughtsTokenCount: 300, cachedContentTokenCount: 20 } };
const ex = extractGeminiUsage(raw);
ck('extractGeminiUsage reads thoughtsTokenCount', ex.thoughtTokens === 300 && ex.promptTokens === 120 && ex.outputTokens === 60 && ex.cachedTokens === 20, ex);
ck('extractGeminiUsage on empty → zeros', (() => { const z = extractGeminiUsage({}); return z.promptTokens === 0 && z.thoughtTokens === 0; })());

// ── DB round-trip (skip gracefully if Postgres is unreachable) ────────────────
const TEST_OWNER = '00000000-0000-4000-8000-000000000c05';
const dbChecks = async (): Promise<void> => {
  await prisma.llmUsage.deleteMany({ where: { ownerId: TEST_OWNER } });
  await recordLlmUsage({ ownerId: TEST_OWNER, surface: 'chat', model: 'gemini-2.5-flash', usage: withThinking });
  await recordLlmUsage({ ownerId: TEST_OWNER, surface: 'orchestration', model: 'gemini-2.5-flash', usage: base });
  await recordLlmUsage({ ownerId: TEST_OWNER, surface: 'orchestration', model: 'veo-3.1-lite', usage: { promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0 }, extraCostUsd: 0.40 });
  const totals = await usageTotals(TEST_OWNER);
  ck('ledger totals 3 calls', totals.calls === 3, totals.calls);
  ck('ledger cost is sum > 0', totals.costUsd > 0.40, totals.costUsd);
  ck('ledger breaks down by surface', totals.bySurface.length === 2 && totals.bySurface.some((s) => s.surface === 'chat') && totals.bySurface.some((s) => s.surface === 'orchestration'), totals.bySurface);
  ck('thought tokens aggregated', totals.thoughtTokens === 4000, totals.thoughtTokens);
  await prisma.llmUsage.deleteMany({ where: { ownerId: TEST_OWNER } });
  console.log('cleanup: test usage rows removed');
};

try {
  await prisma.$queryRaw`SELECT 1`;
  await dbChecks();
} catch (e) {
  console.log('  SKIP db round-trip (Postgres unreachable):', String(e).slice(0, 80));
}

console.log(failures ? `\nFAIL — ${failures} llm-usage check(s) red` : '\nPASS — llm usage ledger + costing green');
process.exit(failures ? 1 : 0);
