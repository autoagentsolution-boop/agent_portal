// The shape of any user-facing message the server emits: a stable CODE plus optional structured
// params. The server never authors the sentence — the client renders `code` (+ params) through its
// i18n catalog (web/src/i18n). Used for API errors (via http.fail), SSE node notices, and gate copy.
// Node errors also carry a `code` alongside their legacy human string during migration; the client
// prefers the code and falls back to the string.
export interface UserMessage {
  code: string;
  params?: Record<string, string | number>;
}

export const userMessage = (code: string, params?: Record<string, string | number>): UserMessage =>
  params ? { code, params } : { code };
