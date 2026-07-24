// English catalog — the SOURCE OF TRUTH. Every key the app can render is defined here; the other
// locales are Partial<typeof en> and fall back to these values on a miss. `as const` makes `keyof`
// a literal union, so a t() call naming a key absent here is a BUILD error, never a runtime blank.
//
// Naming: area.thing.state (flat, dotted; the whole dotted string is the key). Two server-facing
// namespaces: `err.<code>` for API error codes and `notice.<code>` for server-emitted notices — each
// MUST carry a remedy clause (say what to do next), which is the actual defect the envelope fixes.
//
// Keys arrive with their migration — do NOT pre-populate 830 keys. This is the phase-01 seed:
// the act-on tier (approve/connect/pay/retry/delete/confirm) plus the phase-02 code namespaces.
export const en = {
  // ---- common actions ----
  'common.confirm': 'Confirm',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.retry': 'Retry',
  'common.loading': 'Loading…',
  'common.approve': 'Approve',
  'common.reject': 'Reject',
  'common.connect': 'Connect',
  'common.reconnect': 'Reconnect',

  // ---- credits (money) ----
  'credits.exhausted': 'You are out of credits. Top up to keep running agents.',
  'credits.grant.confirm': 'This will cost about {credits} credits. Continue?',
  'credits.grant.title': 'Confirm credit spend',

  // ---- connection gate (blocking) ----
  'connect.required.title': 'Connection required',
  'connect.required.body': 'Connect {platforms} to continue. Your draft is ready and waiting.',

  // ---- approval (act-on) ----
  'approve.video.cost': 'Generating this video costs about {credits} credits. Approve?',
  'approve.send.confirm': 'Approve and send this email?',
  'approve.step.failed': 'A step failed. Review it, then retry or approve again.',

  // ---- schedule (F11 — was hardcoded English under a localized reply) ----
  'schedule.confirm_tail': "I've read the send time as {time}. Please confirm that's right.",

  // ---- destructive confirms (must keep naming the object) ----
  'confirm.delete.workspace': 'Delete workspace "{name}"? This cannot be undone.',
  'confirm.delete.generic': 'Delete "{name}"? This cannot be undone.',
  'confirm.lead.token.revoke': 'Revoke this intake link? Existing forms using it will stop working.',

  // ---- server error codes (err.<code>) — each carries a remedy ----
  'err.gmail_not_connected': 'Gmail is not connected. Connect Google to send email.',
  'err.invalid_grant': 'Your Google connection expired. Reconnect Google to keep sending.',
  'err.insufficient_credits': 'Not enough credits for this action. Top up and try again.',
  'err.gmail_send_failed': 'The email could not be sent. Check your Google connection and retry.',
  'err.no_recipient': 'No recipient was found for this email. Add a recipient and retry.',
  'err.network_error': 'Network problem — the request did not reach the server. Check your connection and retry.',
  'err.validation_failed': 'Some fields need fixing before this can be saved.',
  'err.invalid_ui_language': 'That interface language is not available yet.',
  // Fallback for an unrecognized code — the raw code still shows in small print (see t-error.ts).
  'err.generic': 'Something went wrong. Please try again.',

  // ---- server notices (notice.<code>) ----
  'notice.connect_to_publish': 'Connect {platforms} to publish — your draft is ready and waiting.',
} as const;

export type Catalog = typeof en;
export type MessageKey = keyof Catalog;
