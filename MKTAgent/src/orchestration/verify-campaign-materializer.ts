// Phase 04 verification — calendar → scheduled posts. Proves the scheduling engine lands every
// slot inside the campaign's posting window (in its timezone, in the future, spread across the
// duration) and the materializer creates N Posts each with a registry-composed DAG + scheduledAt,
// idempotently (re-materialize sweeps un-published, never a published one). One throwaway tenant.
import { prisma } from '../db/client.ts';
import { scheduleCalendar } from '../scheduler/schedule-calendar.ts';
import { materializeCalendar } from './master/campaign-materializer.ts';
import { getRunWithNodes } from '../db/repos/workflow-run-repo.ts';
import type { CalendarSlot } from './schemas/artifact-schemas.ts';

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown): void => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
};

// Hour-of-day of an instant in a given IANA zone.
const hourInTz = (d: Date, tz: string): number =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit' }).format(d).replace('24', '00'));

// A calendar slot builder (schema-shaped).
const slot = (index: number, format: CalendarSlot['format'], dayOffset: number, platforms: CalendarSlot['platforms']): CalendarSlot =>
  ({ index, pillar: `P${index}`, angle: `Angle ${index}`, format, platforms, hook: `Hook ${index}`, rationale: 'r', dayOffset });

async function main(): Promise<void> {
  // ── Pure scheduling: 12 slots, 4 weeks, Bangkok 09:00-11:00 ───────────────────────────────
  const tz = 'Asia/Bangkok';
  const now = new Date('2026-07-08T00:00:00Z');
  const twelve = Array.from({ length: 12 }, (_, i) => ({ index: i, dayOffset: Math.floor(i / 3) * 7 + (i % 3) * 2 }));
  const timings = scheduleCalendar({ slots: twelve, postingWindow: '09:00-11:00', timezone: tz, now });
  check('schedule: one timing per slot', timings.length === 12, timings.length);
  check('schedule: all inside posting window (09:00-11:00 Bangkok)', timings.every((t) => { const h = hourInTz(t.scheduledAt, tz); return h >= 9 && h < 11; }), timings.map((t) => hourInTz(t.scheduledAt, tz)));
  check('schedule: all in the future', timings.every((t) => t.scheduledAt.getTime() > now.getTime()));
  check('schedule: spread across the month (>14 days span)', (Math.max(...timings.map((t) => t.scheduledAt.getTime())) - Math.min(...timings.map((t) => t.scheduledAt.getTime()))) > 14 * 86_400_000);
  check('schedule: sorted ascending', timings.every((t, i) => i === 0 || t.scheduledAt.getTime() >= timings[i - 1]!.scheduledAt.getTime()));
  check('schedule: default window when none set', scheduleCalendar({ slots: [{ index: 0, dayOffset: 0 }], now, timezone: tz }).length === 1);

  // ── DB materialize (throwaway tenant) ─────────────────────────────────────────────────────
  const user = await prisma.user.create({ data: { email: `mat-${Date.now()}@test.local`, defaultLanguage: 'en' } });
  try {
    const campaign = await prisma.campaign.create({ data: {
      ownerId: user.id, product: 'AI automation platform', brandContext: 'Automates ops workflows.',
      platforms: ['facebook'], postingWindow: '09:00-11:00', timezone: tz, language: 'en',
    } });

    const calendar: CalendarSlot[] = [
      slot(0, 'text', 0, ['facebook']),
      slot(1, 'image', 2, ['facebook']),
      slot(2, 'carousel', 5, ['instagram']),
      slot(3, 'video', 9, ['facebook']),
    ];

    const res = await materializeCalendar(campaign.id, user.id, calendar, { now });
    if (!res) { check('materialize returned', false); return; }
    check('materialize: 4 posts created', res.posts.length === 4, res.posts.length);
    check('materialize: none skipped', res.skipped.length === 0, res.skipped);
    check('materialize: first run has 0 sweep', res.swept === 0, res.swept);
    check('materialize: every post has a scheduledAt', res.posts.every((p) => Boolean(p.scheduledAt)), res.posts);

    // DAG composition per format (registry-derived, not hand-authored).
    const dagFor = async (runId: string): Promise<string[]> => (await getRunWithNodes(runId, user.id))?.nodes.map((n) => n.agentId) ?? [];
    const byIndex = new Map(res.posts.map((p) => [p.index, p]));
    check('materialize: text slot DAG = concept + publisher', (await dagFor(byIndex.get(0)!.runId)).includes('concept_writer') && (await dagFor(byIndex.get(0)!.runId)).includes('publisher'));
    check('materialize: image slot DAG has infographic', (await dagFor(byIndex.get(1)!.runId)).includes('infographic'));
    check('materialize: carousel slot DAG has storyboard', (await dagFor(byIndex.get(2)!.runId)).includes('storyboard'));
    const videoDag = await dagFor(byIndex.get(3)!.runId);
    // A video slot materializes video_script → video. NOT storyboard: a video is rendered from the
    // script, so pulling storyboard in would generate and bill frames nothing consumes (2026-07-21).
    check('materialize: video slot DAG has video_script + video', videoDag.includes('video_script') && videoDag.includes('video'), videoDag);
    check('materialize: video slot DAG has NO storyboard', !videoDag.includes('storyboard'), videoDag);

    // assetType per format on the Post row.
    const posts = await prisma.post.findMany({ where: { campaignId: campaign.id, ownerId: user.id }, orderBy: { createdAt: 'asc' } });
    const at = (idx: number) => posts.find((p) => p.runId === byIndex.get(idx)!.runId)?.assetType;
    check('materialize: image→image, carousel→carousel, video→video assetType', at(1) === 'image' && at(2) === 'carousel' && at(3) === 'video', { i: at(1), c: at(2), v: at(3) });
    check('materialize: posts start at brief', posts.every((p) => p.status === 'brief'));

    // ── Idempotent re-materialize: sweeps un-published, no dup ───────────────────────────────
    const res2 = await materializeCalendar(campaign.id, user.id, calendar, { now });
    check('re-materialize: swept the 4 un-published', res2!.swept === 4, res2!.swept);
    const totalAfter = await prisma.post.count({ where: { campaignId: campaign.id, ownerId: user.id } });
    check('re-materialize: total posts still 4 (no dup)', totalAfter === 4, totalAfter);

    // ── Published-post preservation: a posted post is never swept ─────────────────────────────
    const survivor = (await prisma.post.findFirst({ where: { campaignId: campaign.id, ownerId: user.id } }))!;
    await prisma.post.update({ where: { id: survivor.id }, data: { status: 'posted' } });
    const res3 = await materializeCalendar(campaign.id, user.id, calendar, { now });
    check('re-materialize: posted post NOT swept', res3!.swept === 3, res3!.swept);
    const survivorStill = await prisma.post.findFirst({ where: { id: survivor.id } });
    check('re-materialize: posted post survives', survivorStill?.status === 'posted', survivorStill?.status);
    const finalTotal = await prisma.post.count({ where: { campaignId: campaign.id, ownerId: user.id } });
    check('re-materialize: 1 posted + 4 fresh = 5 total', finalTotal === 5, finalTotal);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('cleanup: throwaway tenant removed');
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nPASS — campaign materializer checks green' : `\nFAIL — ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
