// Atria Phase 02 — Publisher optimal-time suggestion ("đề xuất giờ tối ưu → duyệt").
// PURE heuristic, no LLM/DB/network: a small const map of well-known best-time-to-post
// windows per platform (industry-standard social-media-scheduling guidance, not
// user-specific analytics — good enough for a pre-approval nudge, cheap + testable).
// The suggestion is advisory only; the human still approves the actual publish time.

export interface TimingInput {
  platforms: string[];
  audience?: string | null;
  language?: string | null;
  timezone?: string | null;
}

export interface TimingSuggestion {
  platform: string;
  window: string;
  localTime: string;
  rationale: string;
}

// Heuristic best-time windows per platform. Source: commonly-cited social scheduling
// benchmarks (Sprout Social / Hootsuite style guidance) — day-part patterns, not live data.
interface PlatformWindow {
  window: string;
  localTime: string;
  day: string; // short label used in rationale, e.g. "weekday afternoon"
}

const PLATFORM_WINDOWS: Record<string, PlatformWindow> = {
  facebook: { window: 'Tue–Thu, 1–3 PM', localTime: 'Wed 13:00', day: 'weekday afternoon' },
  instagram: { window: 'Tue–Fri, 11 AM–1 PM & 7–9 PM', localTime: 'Thu 12:00', day: 'midday/evening' },
  threads: { window: 'Tue–Fri, 11 AM–1 PM & 7–9 PM', localTime: 'Thu 12:00', day: 'midday/evening' }, // mirrors IG audience overlap
  linkedin: { window: 'Tue–Thu, 9–11 AM', localTime: 'Wed 10:00', day: 'business-hours morning' },
  x: { window: 'Weekdays, 8–10 AM & 5–6 PM', localTime: 'Wed 08:30', day: 'commute-time' },
};

// Unknown/unlisted platform → generic safe default (never throw).
const GENERIC_WINDOW: PlatformWindow = { window: 'Tue–Thu, 10 AM–12 PM', localTime: 'Wed 10:30', day: 'weekday late-morning' };

const isB2b = (audience: string): boolean => /\bb2b|business|saas|enterprise|professional/i.test(audience);
const isEveningAudience = (audience: string): boolean => /\bteen|gamer|consumer|b2c|student|casual/i.test(audience);

const rationale = (
  platform: string,
  win: PlatformWindow,
  audience: string | null | undefined,
  language: string | null | undefined,
  timezone: string | null | undefined,
): string => {
  const vi = language === 'vi';
  const tzPart = timezone
    ? vi ? `theo múi giờ ${timezone}` : `in ${timezone}`
    : vi ? 'theo giờ địa phương của khán giả' : "assuming the audience's local time";

  const audienceStr = audience ?? '';
  if (audienceStr && isB2b(audienceStr)) {
    return vi
      ? `Khán giả B2B hoạt động trong giờ hành chính — ${win.day} phù hợp cho ${platform}, ${tzPart}.`
      : `B2B audiences are active during business hours — ${win.day} suits ${platform}, ${tzPart}.`;
  }
  if (audienceStr && isEveningAudience(audienceStr)) {
    return vi
      ? `Khán giả tiêu dùng thường online buổi tối/cuối tuần — khung giờ này cho ${platform} tối ưu tương tác, ${tzPart}.`
      : `Consumer audiences skew evenings/weekends — this window maximizes engagement on ${platform}, ${tzPart}.`;
  }
  return vi
    ? `Khung giờ ${win.day} là thời điểm tương tác cao trên ${platform}, ${tzPart}.`
    : `${win.day.charAt(0).toUpperCase() + win.day.slice(1)} is a historically high-engagement window on ${platform}, ${tzPart}.`;
};

// One suggestion per input platform. Unknown platforms fall back to GENERIC_WINDOW —
// this function never throws.
export function suggestPublishTimes(input: TimingInput): TimingSuggestion[] {
  return input.platforms.map((platform) => {
    const win = PLATFORM_WINDOWS[platform] ?? GENERIC_WINDOW;
    return {
      platform,
      window: win.window,
      localTime: win.localTime,
      rationale: rationale(platform, win, input.audience, input.language, input.timezone),
    };
  });
}

// Compact multi-line summary for the publish-review UI/log — one line per platform.
export function summarizeTiming(suggestions: TimingSuggestion[]): string {
  return suggestions.map((s) => `${s.platform}: ${s.window} — ${s.rationale}`).join('\n');
}
