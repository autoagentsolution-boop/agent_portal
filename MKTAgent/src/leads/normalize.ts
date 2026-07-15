// Lead payload normalizers — ported verbatim from the n8n Code nodes
// (mkt-lead-capture "Auth + validate", mkt-calcom-lead "Auth + parse booking",
// mkt-form-lead "Normalize form row"). Pure functions: validate + map raw inbound
// shapes → a NormalizedLead. No DB, no network — the service layer persists.
import type { LeadSource, SocialPlatform } from '../../prisma/generated/prisma/client.ts';

export interface NormalizedLead {
  name: string;
  // null → HANDLE-ONLY lead (Multichannel Nurture Phase 03, comment sources only): comment APIs
  // never return email/phone, so a commenter who typed the capture keyword without an email still
  // captures — captureLead requires `platform`+`platformUserId` below to be set when this is null.
  email: string | null;
  phone: string;
  message: string;
  sourceProduct: string;
  sourcePlatform: string; // free-form origin tag (kept in rawPayload; not a column)
  source: LeadSource;
  calBookingUid: string | null;
  rawPayload: Record<string, unknown>;
  // Platform identity (Phase 03) — set ONLY by comment sources (webhook + poller), never by
  // webhook/form/calcom intake. Persisted on the Lead row for handle-only dedupe + as a nurture
  // target; also carried alongside a typed email (harmless enrichment, not required for dedupe then).
  platform?: SocialPlatform | null;
  platformUserId?: string | null;
  platformHandle?: string | null;
}

// Discriminated result so the router maps cleanly to HTTP without throwing.
export type NormalizeResult =
  | { ok: true; lead: NormalizedLead }
  | { ok: false; status: number; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown): string => String(v == null ? '' : v);

// ---- Webhook / generic JSON POST ------------------------------------------------
export const normalizeWebhook = (body: Record<string, unknown>): NormalizeResult => {
  const email = str(body.email).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, status: 400, error: 'invalid_email' };
  return {
    ok: true,
    lead: {
      name: str(body.name).slice(0, 200),
      email,
      phone: str(body.phone).slice(0, 50),
      message: str(body.message).slice(0, 2000),
      sourceProduct: str(body.product || body.sourceProduct).slice(0, 200),
      sourcePlatform: str(body.platform || body.sourcePlatform).slice(0, 50),
      source: 'webhook',
      calBookingUid: null,
      rawPayload: body,
    },
  };
};

// ---- Cal.com BOOKING_CREATED → lead --------------------------------------------
export const normalizeCalcom = (body: Record<string, unknown>): NormalizeResult => {
  const triggerEvent = str(body.triggerEvent);
  if (triggerEvent && triggerEvent !== 'BOOKING_CREATED') {
    return { ok: false, status: 202, error: 'ignored_event' };
  }
  const p = (body.payload as Record<string, unknown>) || {};
  const attendees = p.attendees as Array<Record<string, unknown>> | undefined;
  const attendee = (Array.isArray(attendees) && attendees[0]) || {};
  const email = str(attendee.email).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, status: 400, error: 'invalid_email' };

  // Meeting link: Cal.com exposes it in several shapes across versions.
  const videoCallData = p.videoCallData as Record<string, unknown> | undefined;
  const metadata = p.metadata as Record<string, unknown> | undefined;
  const meetUrl = str(
    videoCallData?.url || metadata?.videoCallUrl || p.location,
  ).slice(0, 500);
  const meetingAt = str(p.startTime).slice(0, 50);
  const calBookingUid = str(p.uid || p.bookingId).slice(0, 100);
  const title = str(p.title || p.eventTitle || 'Cal.com booking').slice(0, 200);
  const attendeeMessage = str(p.additionalNotes || attendee.notes).slice(0, 1000);

  const message = [title, meetingAt && `Meeting: ${meetingAt}`, meetUrl && `Link: ${meetUrl}`, attendeeMessage]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);

  return {
    ok: true,
    lead: {
      name: str(attendee.name).slice(0, 200),
      email,
      phone: str(attendee.phoneNumber).slice(0, 50),
      message,
      sourceProduct: title,
      sourcePlatform: 'calcom',
      source: 'calcom',
      calBookingUid: calBookingUid || null,
      rawPayload: { meetingAt, meetUrl, calBookingUid, payload: p },
    },
  };
};

// ---- Google-Form-style row (keyword-pick column resolution) ---------------------
const pick = (lk: Record<string, string>, keywords: string[]): string => {
  for (const kw of keywords) {
    for (const key of Object.keys(lk)) {
      if (key.includes(kw)) {
        const v = lk[key];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
    }
  }
  return '';
};

export const normalizeForm = (row: Record<string, unknown>): NormalizeResult => {
  const lk: Record<string, string> = {};
  for (const k of Object.keys(row)) lk[k.toLowerCase().trim()] = str(row[k]);

  const email = pick(lk, ['email', 'e-mail', 'thư', 'mail']).toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, status: 400, error: 'invalid_email' };

  // 'looking for' before 'product' so the product question wins over the
  // 'how do you know about our products' question (keyword order matters).
  const sourceProduct = pick(lk, ['looking for', 'sản phẩm', 'dịch vụ', 'service', 'product']).slice(0, 200);
  const challenges = pick(lk, ['challenge', 'message', 'nội dung', 'nhu cầu', 'need', 'vấn đề', 'ghi chú', 'note', 'yêu cầu']);
  const heardFrom = pick(lk, ['how do you know', 'know about', 'hear about', 'biết', 'kênh']);
  const message = [challenges, heardFrom && `Heard from: ${heardFrom}`].filter(Boolean).join('\n').slice(0, 2000);

  return {
    ok: true,
    lead: {
      name: pick(lk, ['name', 'tên', 'họ']).slice(0, 200),
      email,
      phone: pick(lk, ['phone', 'điện thoại', 'sđt', 'so dien thoai', 'tel']).slice(0, 50),
      message,
      sourceProduct,
      sourcePlatform: 'form',
      source: 'form',
      calBookingUid: null,
      rawPayload: row,
    },
  };
};
