// Impact / value report (Atria Phase 08 / surfaces Phase 07). The money shot: real cost/output/leads
// next to a clearly-LABELED saved-vs-agency estimate. Works per-campaign (pass campaignId) or
// per-period (pass period). Real numbers and estimates are visually separated — honesty by design.
import { useEffect, useState } from 'react';
import { api, type ImpactReportDto } from '../api/client';
import { ReadAloudButton } from './read-aloud-button';
import { useLocale } from '../i18n';

interface Props {
  campaignId?: string; // one campaign
  period?: '7d' | '30d' | '90d' | 'all'; // or a period window
}

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
      {hint && <div className="muted" style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}

export function ImpactReport({ campaignId, period = '30d' }: Props) {
  const { t } = useLocale();
  const [report, setReport] = useState<ImpactReportDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const p = campaignId ? api.campaignImpact(campaignId) : api.periodImpact(period);
    void p.then((r) => { if (r.ok) setReport(r.data); setLoading(false); });
  }, [campaignId, period]);

  if (loading) return <p className="muted">{t('impact.loading')}</p>;
  if (!report) return <p className="muted">{t('impact.no_data')}</p>;
  const { metrics, value } = report;
  const ABBR: Record<string, string> = { facebook: 'FB', instagram: 'IG', threads: 'TH', linkedin: 'LI', x: 'X' };
  const srcLabel = metrics.insightsPlatforms.length
    ? metrics.insightsPlatforms.map((p) => ABBR[p] ?? p.toUpperCase()).join('+')
    : t('impact.measured_prefix');

  const postCount = (n: number) => t(n === 1 ? 'impact.post.one' : 'impact.post.other', { count: n });
  const reachHint = (impressions: number | null) =>
    `${t('impact.measured_prefix')} · ${postCount(metrics.postsMeasured)}${impressions !== null ? ` · ${t('impact.impressions_suffix', { count: impressions.toLocaleString() })}` : ''}`;

  // Spoken summary (V2): the headline + the money-shot measured/estimated numbers, so Atria can read
  // the report aloud. Kept short (a few sentences) to bound TTS latency + cost.
  const narration = [
    report.headline,
    t('impact.narration.spent', { amount: money(metrics.usdSpent), credits: metrics.creditsSpent }),
    t('impact.narration.posts_platforms', { posts: metrics.postsPublished, platforms: metrics.platforms.length }),
    metrics.leadsCaptured > 0 ? t('impact.narration.leads', { leads: metrics.leadsCaptured }) : '',
    metrics.measuredReach !== null ? t('impact.narration.reach', { reach: metrics.measuredReach.toLocaleString() }) : '',
    t('impact.narration.savings', { saved: money(value.savedUsd), days: value.savedDays }),
  ].filter(Boolean).join(' ');

  return (
    <section style={{ maxWidth: 820 }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {campaignId ? t('impact.title.campaign') : t('impact.title.period', { period })}
        <ReadAloudButton text={narration} title={t('impact.read_aloud.title')} className="impact-tts" />
      </h3>
      <p style={{ fontSize: 17, fontWeight: 600, margin: '6px 0 16px' }}>{report.headline}</p>

      <h4 style={{ margin: '0 0 8px' }}>{t('impact.measured.heading')}</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Stat label={t('impact.stat.spent')} value={money(metrics.usdSpent)} hint={t('plan.tier.credits', { credits: metrics.creditsSpent })} />
        <Stat label={t('impact.stat.posts_published')} value={String(metrics.postsPublished)} />
        <Stat label={t('impact.stat.platforms')} value={String(metrics.platforms.length)} hint={metrics.platforms.join(', ') || '—'} />
        <Stat label={t('impact.stat.media_pieces')} value={String(metrics.mediaPieces)} />
        <Stat label={t('impact.stat.leads_captured')} value={String(metrics.leadsCaptured)} />
        {metrics.measuredReach !== null && (
          <Stat
            label={t('impact.stat.reach', { src: srcLabel })}
            value={metrics.measuredReach.toLocaleString()}
            hint={reachHint(metrics.measuredImpressions)}
          />
        )}
        {metrics.measuredEngaged !== null && (
          <Stat
            label={t('impact.stat.engagements', { src: srcLabel })}
            value={metrics.measuredEngaged.toLocaleString()}
            hint={`${t('impact.measured_prefix')} · ${postCount(metrics.postsMeasured)}`}
          />
        )}
      </div>

      <h4 style={{ margin: '18px 0 8px' }}>
        {t('impact.estimated.heading')} <span className="tree-badge" title={t('impact.estimated.badge_title')}>{t('impact.estimated.badge_label')}</span>
      </h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Stat label={t('impact.stat.cost_saved')} value={money(value.savedUsd)} hint={t('impact.stat.baseline_hint', { amount: money(value.baselineUsd) })} />
        <Stat label={t('impact.stat.time_saved')} value={t('impact.days_value', { count: value.savedDays })} />
        {metrics.measuredReach === null && (
          <Stat label={t('impact.stat.est_reach')} value={value.estimatedReach.toLocaleString()} hint={t('impact.stat.est_reach_hint')} />
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        {t('impact.assumptions_footer', {
          rate: value.assumptions.agencyDayRateUsd,
          hours: value.assumptions.hoursPerPost,
          reach: value.assumptions.reachPerPost,
        })}
      </p>
    </section>
  );
}
