// Data-query answer (Atria Core-Intelligence P1) — when the intent router flags a message as a
// performance question ("how are my campaigns going?", "tình hình chiến dịch tháng này?"), Atria fetches
// the REAL Impact numbers and voices a concise, spoken-ready answer instead of planning a content DAG.
// Reuses metricsForPeriod + buildImpactReport (all measured/labeled) so the answer never invents data.
// Gemini phrases it in the user's language; a deterministic vi/en fallback keeps it working with no key.
import { env } from '../../config/env.ts';
import { metricsForPeriod } from '../../impact/impact-metrics.ts';
import { buildImpactReport, type ImpactReport } from '../../impact/value-model.ts';
import { detectLanguage, languageName } from './detect-language.ts';
import { recordGeminiCall } from '../../cost/llm-usage.ts';

export interface DataQueryAnswer {
  answer: string; // natural-language, spoken-ready reply
  report: ImpactReport; // the structured report it was built from (for logging/telemetry)
  periodLabel: string;
}

// Map words in the message to a lookback window. Default 30 days (the Impact page default).
const periodFromMessage = (msg: string): { since: Date; days: number; label: string } => {
  const t = msg.toLowerCase();
  const now = Date.now();
  if (/\b(today|hôm nay|to ?day)\b/.test(t)) return { since: new Date(now - 86_400_000), days: 1, label: 'today' };
  if (/\b(this week|tuần này|7\s*(day|ngày)|last week|tuần (trước|qua))\b/.test(t)) return { since: new Date(now - 7 * 86_400_000), days: 7, label: 'the last 7 days' };
  if (/\b(quarter|90\s*(day|ngày)|3 (month|tháng)|quý)\b/.test(t)) return { since: new Date(now - 90 * 86_400_000), days: 90, label: 'the last 90 days' };
  if (/\b(all time|tất cả|toàn bộ|từ trước( đến nay)?|overall|to date)\b/.test(t)) return { since: new Date(0), days: 0, label: 'all time' };
  return { since: new Date(now - 30 * 86_400_000), days: 30, label: 'the last 30 days' };
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

// The reach/engagement phrase, preferring MEASURED social insights over the labeled estimate.
const reachPhrase = (r: ImpactReport, vi: boolean): string => {
  const m = r.metrics;
  if (m.measuredReach !== null) return vi ? `${m.measuredReach.toLocaleString()} lượt tiếp cận (đo được)` : `${m.measuredReach.toLocaleString()} reach (measured)`;
  if (m.measuredEngaged !== null) return vi ? `${m.measuredEngaged.toLocaleString()} lượt tương tác (đo được)` : `${m.measuredEngaged.toLocaleString()} engagements (measured)`;
  return vi ? `~${r.value.estimatedReach.toLocaleString()} lượt tiếp cận (ước tính)` : `~${r.value.estimatedReach.toLocaleString()} est. reach`;
};

// No-LLM fallback — a plain, spoken-ready summary from the real numbers, in vi or en.
const deterministicAnswer = (r: ImpactReport, label: string, vi: boolean): string => {
  const m = r.metrics;
  if (m.postsPublished === 0 && m.creditsSpent === 0 && m.leadsCaptured === 0) {
    return vi
      ? `Trong ${labelVi(label)}, chưa có hoạt động nào được ghi nhận — chưa có bài đăng, lead hay chi phí. Khi bạn chạy một chiến dịch, mình sẽ báo cáo kết quả thật ở đây.`
      : `Over ${label}, there's no activity recorded yet — no published posts, leads, or spend. Once you run a campaign, I'll report the real results here.`;
  }
  const plat = m.platforms.length ? m.platforms.join(', ') : (vi ? 'chưa có nền tảng' : 'no platforms yet');
  if (vi) {
    return `Trong ${labelVi(label)}: bạn đã đăng ${m.postsPublished} bài trên ${m.platforms.length} nền tảng (${plat}), thu về ${m.leadsCaptured} lead, đạt ${reachPhrase(r, true)}. Chi phí thật $${round2(m.usdSpent)} (≈${m.creditsSpent} credit) — so với ước tính ~$${r.value.baselineUsd} nếu thuê agency trong ${r.value.baselineDays} ngày.`;
  }
  return `Over ${label}: you published ${m.postsPublished} posts across ${m.platforms.length} platform${m.platforms.length === 1 ? '' : 's'} (${plat}), captured ${m.leadsCaptured} leads, and reached ${reachPhrase(r, false)}. Real spend was $${round2(m.usdSpent)} (≈${m.creditsSpent} credits) — versus an estimated ~$${r.value.baselineUsd} to do the same with an agency over ${r.value.baselineDays} days.`;
};

const labelVi = (label: string): string =>
  ({ 'today': 'hôm nay', 'the last 7 days': '7 ngày qua', 'the last 30 days': '30 ngày qua', 'the last 90 days': '90 ngày qua', 'all time': 'toàn bộ thời gian' }[label] ?? label);

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

const extractText = (raw: unknown): string =>
  (raw as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';

const SYSTEM_PROMPT =
  `You are Atria, a marketing operations agent reporting a user's REAL performance numbers. ` +
  `Answer their question directly and concisely (2-4 sentences), in a warm, spoken-friendly tone — this reply may be read aloud. ` +
  `Use ONLY the numbers provided; never invent or extrapolate. If everything is zero, say so plainly and encourage them to run a campaign. ` +
  `Lead with the answer, not preamble. No markdown, no bullet lists — flowing sentences.`;

// Author the NL answer with Gemini, falling back to the deterministic summary on any failure.
const authorAnswer = async (
  r: ImpactReport,
  label: string,
  userMessage: string,
  vi: boolean,
  ownerId: string | null,
): Promise<string> => {
  const fallback = deterministicAnswer(r, label, vi);
  if (!env.GEMINI_API_KEY) return fallback;
  const replyLanguage = languageName(detectLanguage(userMessage));
  const languageDirective = replyLanguage
    ? `Write your entire reply in ${replyLanguage}.`
    : `Write your reply in the SAME language as the user's message below. Detect it from their words; do not default to English.`;
  const facts = {
    period: label,
    postsPublished: r.metrics.postsPublished,
    platforms: r.metrics.platforms,
    leadsCaptured: r.metrics.leadsCaptured,
    measuredReach: r.metrics.measuredReach,
    measuredImpressions: r.metrics.measuredImpressions,
    measuredEngagements: r.metrics.measuredEngaged,
    insightsFrom: r.metrics.insightsPlatforms,
    usdSpent: round2(r.metrics.usdSpent),
    creditsSpent: r.metrics.creditsSpent,
    estimatedReachIfNotMeasured: r.value.estimatedReach,
    agencyBaselineUsd: r.value.baselineUsd,
    agencyBaselineDays: r.value.baselineDays,
  };
  try {
    const res = await fetch(endpoint(env.GEMINI_MODEL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          role: 'user',
          parts: [{ text: `${languageDirective}\n\nUser's question: """${userMessage}"""\n\nReal performance data (do not invent beyond this):\n${JSON.stringify(facts)}` }],
        }],
        generationConfig: { temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return fallback;
    const raw = await res.json();
    await recordGeminiCall(raw, { ownerId, surface: 'chat', model: env.GEMINI_MODEL });
    const text = extractText(raw);
    return text.length >= 2 ? text : fallback;
  } catch {
    return fallback;
  }
};

// Full data-query answer: pick the period, aggregate the real metrics, build the report, voice it.
export async function answerDataQuery(ownerId: string, userMessage: string): Promise<DataQueryAnswer> {
  const { since, label } = periodFromMessage(userMessage);
  const metrics = await metricsForPeriod(ownerId, since);
  const report = buildImpactReport('period', metrics);
  const vi = detectLanguage(userMessage) === 'vi';
  const answer = await authorAnswer(report, label, userMessage, vi, ownerId);
  return { answer, report, periodLabel: label };
}
