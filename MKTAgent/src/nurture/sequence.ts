// Nurture sequence template + stage→intent map (Lead Nurture Agent Phase 01). This IS the "brain" —
// a cadence state machine + template map (DATA), not an LLM planning loop. The LLM only personalizes
// wording inside email_writer; this table decides WHEN and WHAT-ABOUT. KISS: one sequence today;
// extend by adding a keyed entry to SEQUENCES (enroll.ts would need to choose one — not needed yet).
export interface SequenceTouch {
  index: number;
  stage: string; // intro | value | cta — also NurtureTouch.stage and a STAGE_INTENT key
  dayOffset: number; // days after enrollment this touch is due
}

export interface Sequence {
  id: string;
  touches: SequenceTouch[];
}

// Default 3-touch cadence (locked decision, plan overview): day 0 intro, day 3 value, day 6 soft CTA.
export const DEFAULT_SEQUENCE: Sequence = {
  id: 'default3',
  touches: [
    { index: 0, stage: 'intro', dayOffset: 0 },
    { index: 1, stage: 'value', dayOffset: 3 },
    { index: 2, stage: 'cta', dayOffset: 6 },
  ],
};

// What each stage should SAY — grounds email_writer's `angle` slot (the LLM personalizes the
// wording; this table only fixes the intent so the cadence stays predictable and on-brief).
export const STAGE_INTENT: Record<string, string> = {
  intro: 'Warm thank-you + who we are',
  value: 'One concrete value/proof point',
  cta: 'Soft ask: reply or book a call',
};

export const SEQUENCES: Record<string, Sequence> = { [DEFAULT_SEQUENCE.id]: DEFAULT_SEQUENCE };

// Build a per-owner cadence from Nurture Inbox settings (Phase 04: maxTouches/gapDays). Encoded into
// a deterministic id (`custom:<n>:<gap>`) so it round-trips through NurtureThread.sequenceId — no new
// storage needed, and getSequence below can rebuild the exact same Sequence from the id alone. Bounds
// (1-12 touches, 1-30 day gap) keep a fat-fingered setting from planning an unbounded cadence. Default
// settings (3/3) reproduce DEFAULT_SEQUENCE's day 0/3/6 cadence byte-for-byte (same stages, same offsets).
export const buildSequence = (maxTouches: number, gapDays: number): Sequence => {
  const n = Math.max(1, Math.min(12, Math.trunc(maxTouches) || 3));
  const gap = Math.max(1, Math.min(30, Math.trunc(gapDays) || 3));
  const stageFor = (i: number): string => (i === 0 ? 'intro' : i === n - 1 ? 'cta' : 'value');
  return {
    id: `custom:${n}:${gap}`,
    touches: Array.from({ length: n }, (_, i) => ({ index: i, stage: stageFor(i), dayOffset: i * gap })),
  };
};

export const getSequence = (id: string): Sequence => {
  if (id.startsWith('custom:')) {
    const [, n, gap] = id.split(':');
    return buildSequence(Number(n), Number(gap));
  }
  return SEQUENCES[id] ?? DEFAULT_SEQUENCE;
};

// The touch a thread should send next. touchNumber = count of touches already SENT = the next
// touch's sequence index (0 = nothing sent yet). Null once the sequence is exhausted.
export const nextTouch = (sequence: Sequence, touchNumber: number): SequenceTouch | null =>
  sequence.touches.find((t) => t.index === touchNumber) ?? null;

// Days between touchIndex and the NEXT touch in the sequence — drives nextPlanAt after a send
// (nextPlanAt = sentAt + gapDaysAfter). Null when touchIndex was the last touch (sequence complete).
export const gapDaysAfter = (sequence: Sequence, touchIndex: number): number | null => {
  const cur = sequence.touches.find((t) => t.index === touchIndex);
  const next = sequence.touches.find((t) => t.index === touchIndex + 1);
  if (!cur || !next) return null;
  return next.dayOffset - cur.dayOffset;
};
