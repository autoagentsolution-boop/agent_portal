// Calendar scheduling engine (Atria Phase 04). Turns a content calendar's per-slot dayOffset
// into concrete `scheduledAt` timestamps, ACTIVATING the dormant Campaign.postingWindow +
// timezone: each slot lands at a real time INSIDE the posting window, in the campaign's IANA
// timezone, spread across the duration (deterministic in-window jitter so same-day slots don't
// collide). Pure + `now` is injected → fully testable, no wall-clock dependence.
//
// Timezone math with no date lib: we convert a wall-clock time in an IANA zone to a UTC instant
// via the Intl offset trick (format the guessed instant back in the zone, measure the delta).

export interface CalendarSlotInput {
  index: number;
  dayOffset: number;
}

export interface CalendarSlotTiming {
  index: number;
  scheduledAt: Date;
}

export interface ScheduleCalendarInput {
  slots: CalendarSlotInput[];
  postingWindow?: string | null; // "HH:MM-HH:MM" (campaign local); default 09:00-11:00
  timezone?: string | null; // IANA tz; default UTC
  now: Date; // injected (never Date.now() — keeps this pure + testable)
  startDayOffset?: number; // day 0 anchor relative to `now`; default 1 (begin tomorrow, never past)
}

const DEFAULT_WINDOW = { startMin: 9 * 60, endMin: 11 * 60 };

const parseWindow = (raw?: string | null): { startMin: number; endMin: number } => {
  const m = (raw ?? '').trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return DEFAULT_WINDOW;
  const startMin = Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
  const endMin = Math.min(23, Number(m[3])) * 60 + Math.min(59, Number(m[4]));
  return endMin > startMin ? { startMin, endMin } : DEFAULT_WINDOW;
};

// Minutes the zone is ahead of UTC at `date` (e.g. +420 for Asia/Bangkok).
const tzOffsetMinutes = (date: Date, tz: string): number => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
  const hour = p.hour === '24' ? '00' : p.hour; // some engines emit '24' at midnight
  const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(hour), Number(p.minute), Number(p.second));
  return Math.round((asUTC - date.getTime()) / 60000);
};

// UTC instant for a wall-clock Y/M/D H:M in the given zone (one-shot; DST-boundary exact enough
// for post scheduling). Guess the instant as if UTC, then subtract the measured zone offset.
const zonedWallToUtc = (y: number, mo: number, d: number, hh: number, mm: number, tz: string): Date => {
  const guess = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const off = tzOffsetMinutes(new Date(guess), tz);
  return new Date(guess - off * 60000);
};

// The wall-date (Y/M/D) of `now` in the zone — the day-0 anchor.
const wallDatePartsInTz = (now: Date, tz: string): { y: number; mo: number; d: number } => {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(dtf.formatToParts(now).map((x) => [x.type, x.value])) as Record<string, string>;
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day) };
};

// Advance a calendar date by n days (UTC-anchored → immune to DST when only the DATE matters).
const addCalendarDays = (y: number, mo: number, d: number, n: number): { y: number; mo: number; d: number } => {
  const t = new Date(Date.UTC(y, mo - 1, d) + n * 86_400_000);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

export function scheduleCalendar(input: ScheduleCalendarInput): CalendarSlotTiming[] {
  const tz = (input.timezone && input.timezone.trim()) || 'UTC';
  const win = parseWindow(input.postingWindow);
  const span = Math.max(1, win.endMin - win.startMin);
  const base = wallDatePartsInTz(input.now, tz);
  const startDay = input.startDayOffset ?? 1; // begin tomorrow so nothing schedules in the past

  const timings = input.slots.map((s) => {
    const dayNum = startDay + Math.max(0, s.dayOffset);
    const day = addCalendarDays(base.y, base.mo, base.d, dayNum);
    // Deterministic in-window spread: two slots on the same day get different minutes.
    const minute = win.startMin + ((s.index * 37) % span);
    let at = zonedWallToUtc(day.y, day.mo, day.d, Math.floor(minute / 60), minute % 60, tz);
    // Never schedule at/before `now` — push to the next day at the same in-window minute.
    for (let g = 1; at.getTime() <= input.now.getTime() && g < 400; g++) {
      const nd = addCalendarDays(day.y, day.mo, day.d, g);
      at = zonedWallToUtc(nd.y, nd.mo, nd.d, Math.floor(minute / 60), minute % 60, tz);
    }
    return { index: s.index, scheduledAt: at };
  });

  return timings.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}
