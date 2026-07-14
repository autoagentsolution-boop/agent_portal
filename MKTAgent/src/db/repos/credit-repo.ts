// Credit wallet repo (credit-wallet Phase 01). Append-only ledger; balance = SUM(delta).
// Positive = trial/grant, negative = debit. Idempotency for debits is enforced by the
// (runId, kind) unique index — a re-entered/resumed run debits at most once.
import { prisma } from '../client.ts';
import type { CreditLedger } from '../../../prisma/generated/prisma/client.ts';

// New-tenant trial (credit-wallet Phase 01, user override 2026-07-14): every user starts with
// this free balance so they can run a few real flows before an admin grant / payments land.
export const TRIAL_CREDITS = 2000;

export type CreditKind = 'trial' | 'grant' | 'debit' | 'adjust';

// Current balance = SUM of all deltas for this owner. Empty ledger → 0.
export const getBalance = async (ownerId: string): Promise<number> => {
  const agg = await prisma.creditLedger.aggregate({ where: { ownerId }, _sum: { delta: true } });
  return agg._sum.delta ?? 0;
};

// Append a ledger entry. `delta` sign is the caller's responsibility (grants positive, debits
// negative). Returns the created row. Not idempotent on its own — see ensureTrialGrant / debit.
export const addLedgerEntry = (args: {
  ownerId: string;
  delta: number;
  kind: CreditKind;
  reason?: string | null;
  runId?: string | null;
  grantedBy?: string | null;
}): Promise<CreditLedger> =>
  prisma.creditLedger.create({
    data: {
      ownerId: args.ownerId,
      delta: args.delta,
      kind: args.kind,
      reason: args.reason ?? null,
      runId: args.runId ?? null,
      grantedBy: args.grantedBy ?? null,
    },
  });

// Super-admin grant (positive credits). Thin wrapper over addLedgerEntry for the admin router.
export const grantCredits = (
  ownerId: string,
  credits: number,
  reason: string | null,
  grantedBy: string,
): Promise<CreditLedger> =>
  addLedgerEntry({ ownerId, delta: Math.abs(credits), kind: 'grant', reason, grantedBy });

// One-time trial on first login. Idempotent: a second call for a tenant that already has a trial
// row is a no-op (returns false). The (runId, kind) unique index can't guard trial rows (they have
// runId=null), so the check-then-insert is made atomic with a transaction-scoped advisory lock
// keyed on the owner — this closes the TOCTOU where two concurrent first-logins (retried OAuth
// callback / second tab) both see count=0 and double-grant. The lock auto-releases at tx end and
// works under transaction pooling (pg_advisory_XACT_lock, not the session variant).
export const ensureTrialGrant = (ownerId: string): Promise<boolean> =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`;
    const existing = await tx.creditLedger.count({ where: { ownerId, kind: 'trial' } });
    if (existing > 0) return false;
    await tx.creditLedger.create({
      data: { ownerId, delta: TRIAL_CREDITS, kind: 'trial', reason: 'new tenant trial' },
    });
    return true;
  });

// Per-tenant wallet summary for the super-admin console: balance + a breakdown of how it got there
// (trial/granted in, spent out) + last activity. Two round-trips (users + a grouped ledger agg) reduced
// in JS — tenant counts are small (single-operator platform), so no need for a hand-rolled SQL join.
export interface TenantBalance {
  ownerId: string;
  email: string;
  displayName: string | null;
  isSuperAdmin: boolean;
  balance: number;
  granted: number; // trial + grant credits received
  spent: number; // debited credits (positive number)
  lastActive: string; // ISO — user.updatedAt
}

export const listTenantsWithBalances = async (): Promise<TenantBalance[]> => {
  const [users, byKind] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, displayName: true, isSuperAdmin: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.creditLedger.groupBy({ by: ['ownerId', 'kind'], _sum: { delta: true } }),
  ]);
  const acc = new Map<string, { balance: number; granted: number; spent: number }>();
  for (const g of byKind) {
    const sum = g._sum.delta ?? 0;
    const row = acc.get(g.ownerId) ?? { balance: 0, granted: 0, spent: 0 };
    row.balance += sum;
    if (g.kind === 'debit') row.spent += -sum;
    else if (g.kind === 'trial' || g.kind === 'grant') row.granted += sum;
    acc.set(g.ownerId, row);
  }
  return users.map((u) => {
    const row = acc.get(u.id) ?? { balance: 0, granted: 0, spent: 0 };
    return {
      ownerId: u.id,
      email: u.email,
      displayName: u.displayName,
      isSuperAdmin: u.isSuperAdmin,
      balance: row.balance,
      granted: row.granted,
      spent: row.spent,
      lastActive: u.updatedAt.toISOString(),
    };
  });
};

// Debit a completed run's cost. Idempotent by runId via the (runId, kind) unique index: a
// resumed/re-entered run that reaches completion again will hit the constraint and be skipped.
// A zero/negative credit run is a no-op (nothing to debit). Returns true if a debit row landed.
export const debitRun = async (
  ownerId: string,
  credits: number,
  runId: string,
  reason: string | null = 'flow run',
): Promise<boolean> => {
  if (credits <= 0) return false;
  try {
    await prisma.creditLedger.create({
      data: { ownerId, delta: -Math.abs(credits), kind: 'debit', runId, reason },
    });
    return true;
  } catch (e) {
    // P2002 = unique violation → this run was already debited. Idempotent success (no double charge).
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') return false;
    throw e;
  }
};
