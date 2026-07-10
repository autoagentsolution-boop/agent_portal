// Detects when a user's message is asking Atria for a SPOKEN answer — "read the report", "how are
// my campaigns going?", "đọc báo cáo", "tình hình thế nào" — so the chat can offer a prominent
// "read this aloud" confirm on Atria's reply (never auto-plays; the click is the confirm + the audio
// gesture). Deliberately liberal: a false positive only shows an extra button the user can ignore.
const READ_INTENT = [
  /\bread\b/,                              // read / read it / read the report
  /read\s+(it|this|that|the|them|me)?\s*(aloud|out|to me)?/,
  /\bđọc\b/,                               // đọc / đọc to / đọc báo cáo / đọc cho tôi
  /how\s+(are|is|'s|are the|is the)?\s*.*\b(going|doing|performing|looking)\b/, // how are campaigns going
  /\b(báo cáo|tình hình|cập nhật tình hình|thế nào rồi|sao rồi)\b/,
  /\b(tell me|kể|nói cho tôi|cho tôi biết|summari[sz]e|tóm tắt)\b/,
  /\bnghe\b/,                              // "cho tôi nghe", "nghe báo cáo"
];

export function wantsSpokenReply(text: string): boolean {
  const t = text.toLowerCase();
  return READ_INTENT.some((re) => re.test(t));
}
