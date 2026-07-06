// Parse a social comment into an opt-in lead (§01.4). A comment counts as an opt-in ONLY when
// it contains the post's configured keyword (e.g. "Atria AI") AND an email — the commenter is
// explicitly asking to be contacted (the keyword is the consent signal, the email is how).
// Pure + no I/O so the extraction is fully unit-testable independent of any Graph API.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// Collapse whitespace + lowercase so "Atria   AI" / "atria ai" all match "Atria AI".
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

export interface ParsedComment {
  matched: boolean;   // keyword present AND an email found → a capturable opt-in
  email: string | null;
  keywordHit: boolean; // keyword present (even without an email) — for logging/telemetry
}

export const parseComment = (text: string | null | undefined, keyword: string): ParsedComment => {
  const body = (text ?? '').trim();
  const kw = norm(keyword);
  if (!body || !kw) return { matched: false, email: null, keywordHit: false };
  const keywordHit = norm(body).includes(kw);
  if (!keywordHit) return { matched: false, email: null, keywordHit: false };
  const email = body.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null;
  return { matched: Boolean(email), email, keywordHit: true };
};
