// Lead Nurture reply poller (Phase 02) — the READ half of the two-way loop. Mirrors
// leads/sources/comment-poller.ts's shape (bounded, per-owner sweep; injectable fetcher for
// verification). For every owner who currently holds the gmail.readonly scope, walks ONLY the Gmail
// threads WE started (LeadNurtureThread.gmailThreadId — HARD invariant #2, never a general inbox
// scan), pulls messages newer than the thread's last check, and ingests genuine lead replies as
// InboundReply — skipping our own outbound copies and auto-replies/bulk mail (HARD invariant #3). An
// owner missing the read scope degrades to one-way (Phase 01 sends keep working) for this tick
// instead of throwing (HARD invariant #5); nothing here ever sends (HARD invariant #1).
import { getLead } from '../db/repos/lead-repo.ts';
import { listThreadsWithGmail, listOwnersWithGmailThreads, markThreadChecked } from './nurture-thread-repo.ts';
import { upsertInboundReply } from './reply-repo.ts';
import { listThreadMessages, hasGmailReadScope, type GmailListFn, type GmailMessage } from './gmail-read.ts';
import { logger } from '../lib/logger.ts';

export interface ReplyPollSummary {
  ownersScanned: number;
  scopeMissing: number;
  threadsPolled: number;
  messagesScanned: number;
  repliesIngested: number;
}

// A message counts as a genuine inbound lead reply iff it's FROM the lead's own address and isn't our
// own outbound copy (Gmail's SENT label) or an auto-generated bounce/bulk notice (HARD invariant #3).
const isGenuineLeadReply = (m: GmailMessage, leadEmail: string): boolean =>
  !m.isOutbound && !m.isAutoReply && m.from === leadEmail.trim().toLowerCase();

// `now`/`ownerId` are injectable for deterministic, single-tenant verification; production omits both
// (real wall clock, every owner with a live nurture thread).
export const pollNurtureReplies = async (
  listMessages: GmailListFn = listThreadMessages,
  hasReadScope: (ownerId: string) => Promise<boolean> = hasGmailReadScope,
  now: Date = new Date(),
  ownerId?: string,
): Promise<ReplyPollSummary> => {
  const summary: ReplyPollSummary = {
    ownersScanned: 0,
    scopeMissing: 0,
    threadsPolled: 0,
    messagesScanned: 0,
    repliesIngested: 0,
  };
  const owners = ownerId ? [ownerId] : await listOwnersWithGmailThreads();

  for (const owner of owners) {
    summary.ownersScanned++;
    let readable: boolean;
    try {
      readable = await hasReadScope(owner);
    } catch (e) {
      // The scope probe itself failed (network/transient) — skip this owner this tick rather than
      // crash the whole cron sweep over one owner's blip.
      logger.warn('nurture_reply_scope_probe_failed', { ownerId: owner, error: String(e).slice(0, 200) });
      continue;
    }
    if (!readable) {
      summary.scopeMissing++;
      logger.info('gmail_read_scope_missing', { ownerId: owner });
      continue; // degrade to one-way — Phase 01 sends are unaffected, we just can't see replies yet
    }

    for (const thread of await listThreadsWithGmail(owner)) {
      summary.threadsPolled++;
      const lead = await getLead(thread.leadId, owner);
      if (!lead || !lead.email.trim() || !thread.gmailThreadId) continue;

      let messages: GmailMessage[];
      try {
        messages = await listMessages(owner, thread.gmailThreadId, thread.lastCheckedAt);
      } catch (e) {
        // Transient/rate-limited (withRetry inside listThreadMessages already backed off 429s) —
        // leave lastCheckedAt untouched so nothing is skipped; retried next tick.
        logger.warn('nurture_reply_fetch_failed', { threadId: thread.id, error: String(e).slice(0, 200) });
        continue;
      }

      let ingested = 0;
      for (const m of messages) {
        summary.messagesScanned++;
        if (!isGenuineLeadReply(m, lead.email)) continue;
        const created = await upsertInboundReply({
          threadId: thread.id,
          gmailMessageId: m.id,
          fromEmail: m.from,
          body: m.bodyText,
          receivedAt: m.receivedAt,
        });
        if (created) {
          summary.repliesIngested++;
          ingested++;
        }
      }
      // Only flip hasUnhandledReply TRUE on a genuine new ingest — undefined leaves an
      // already-unhandled flag from an earlier tick alone instead of clearing it.
      await markThreadChecked(thread.id, now, ingested > 0 ? true : undefined);
    }
  }

  if (summary.repliesIngested || summary.scopeMissing) logger.info('nurture_replies_polled', { ...summary });
  return summary;
};
