// Intent router (Atria Core-Intelligence P1) — a lightweight front gate on the message flow. Today
// EVERY message is forced through "extract a marketing GoalSpec → plan a content DAG", so a question
// like "how are my campaigns going?" becomes a nonsensical plan. This classifier splits off the
// data-query case so Atria can just ANSWER (with real Impact numbers) instead of planning.
//
// P1 scope: regex/keyword classification (vi+en), like read-intent.ts — cheap, deterministic, no LLM.
// Only `data-query` is acted on now; everything else falls through to the existing create/refine flow.
// P2 upgrades this to LLM classification and adds general-question reasoning.
export type MessageIntent = 'data-query' | 'other';

// Performance/status questions about work that ALREADY happened. Deliberately question-shaped so a
// creation command ("make a video about our campaign") doesn't match — creation wins on ambiguity.
const DATA_QUERY = [
  /how\s+(are|is|'s|did|have|has)\b.*\b(campaign|campaigns|post|posts|ad|ads|doing|going|perform|performing|performed)\b/,
  /\b(how many|how much)\b.*\b(post|posts|lead|leads|reach|impression|engagement|spend|spent|credit|credits|campaign|campaigns)\b/,
  /\b(impact|performance|analytics|metrics|stats|statistics|results?|roi)\b.*\b(report|so far|this (month|week)|last (month|week)|to date|overall|now|today)?\b/,
  /\b(show|give|tell)\s+me\b.*\b(impact|performance|report|numbers|results?|stats|analytics|how.*(doing|going))\b/,
  /\bwhat('s| is| are)\b.*\b(impact|performance|results?|reach|engagement|leads?|numbers|stats)\b/,
  // Vietnamese
  /\b(tình hình|hiệu quả|kết quả|thống kê|báo cáo|hiệu suất|số liệu)\b/,
  /\bchiến dịch\b.*\b(thế nào|ra sao|sao rồi|thế nào rồi|đang.*(chạy|ra sao)|hiệu quả)\b/,
  /\b(bao nhiêu)\b.*\b(bài|lead|khách|tiếp cận|tương tác|credit|đã (đăng|chi))\b/,
  /\b(đã (đăng|chi|tốn) bao nhiêu)\b/,
];

// Verbs that mark a CREATION/action request (make me content), which must NOT be answered as a query.
const CREATION_SIGNAL =
  /\b(làm|tạo|viết|lên|thiết kế|dựng|chạy( quảng cáo| chiến dịch)|khởi chạy|đăng( bài| lên)|soạn|create|make|build|launch|write|draft|design|generate|produce|publish|schedule|set up|plan (a|an|me))\b/i;

// Classify a raw message. `data-query` = a question about existing performance with no creation verb;
// everything else → 'other' (the existing marketing pipeline handles it unchanged).
export function classifyIntent(message: string): MessageIntent {
  const t = message.toLowerCase();
  if (CREATION_SIGNAL.test(t)) return 'other'; // a "make/plan me X" request is content creation, not a query
  return DATA_QUERY.some((re) => re.test(t)) ? 'data-query' : 'other';
}
