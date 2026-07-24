// Leads page (Lead Collector §01.3). Two parts: an intake-token setup panel (mint the token
// a funnel presents so leads land on THIS tenant) and the leads table with the hybrid score.
import { useEffect, useState } from 'react';
import { api, type LeadRow, type IntakeTokenRow, type PostDto, type LinkStatusEntry } from '../api/client';
import { useLocale, t } from '../i18n';
import { tError } from '../i18n/t-error';

interface Props { notify: (msg: string, kind?: 'ok' | 'err') => void }

const scoreClass = (s: number | null): string => (s == null ? 'muted' : s >= 70 ? 'score-hot' : s >= 40 ? 'score-warm' : 'score-cold');

// A platform link, optionally carrying an on-demand liveness marker (undefined = not checked yet).
type LinkEntry = { platform: string; url: string; alive: boolean | null | undefined };

const aliveMarker = (alive: boolean | null | undefined): string =>
  alive === true ? '🟢 ' : alive === false ? '🔴 ' : alive === null ? '⚪ ' : '';

// Tooltip for each liveness state. ⚪ (null) is "couldn't verify" — deliberately distinct from 🔴
// "deleted": some platforms can't confirm existence (LinkedIn on the consumer tier, or an older post
// whose id isn't resolvable), so we show ⚪ rather than guess a red/green.
const aliveTitle = (alive: boolean | null | undefined): string =>
  alive === true ? t('leads.link.alive_true')
  : alive === false ? t('leads.link.alive_false')
  : alive === null ? t('leads.link.alive_unknown')
  : t('leads.link.not_checked');

// "expires in N day(s)" / "expired" from an ISO timestamp, or null if there's no expiry to show.
const expiryText = (iso: string | null | undefined): { text: string; expired: boolean } | null => {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return { text: t('leads.link.expired'), expired: true };
  return { text: t('leads.link.expires_in', { days }), expired: false };
};

const LEADS_PAGE_SIZE = 30;

export function LeadsPage({ notify }: Props) {
  const { t } = useLocale();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [leadsCursor, setLeadsCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tokens, setTokens] = useState<IntakeTokenRow[]>([]);
  // Published posts (posted/partial) — candidates for a comment-keyword lead collector,
  // whether or not one is active yet.
  const [collectors, setCollectors] = useState<PostDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [collectorBusy, setCollectorBusy] = useState<string | null>(null);
  const [keywordInputs, setKeywordInputs] = useState<Record<string, string>>({});
  const [checkBusy, setCheckBusy] = useState<string | null>(null);
  const [linkStatus, setLinkStatus] = useState<Record<string, LinkStatusEntry[]>>({});

  const load = async () => {
    setLoading(true);
    const [l, tokensRes, p] = await Promise.all([
      api.listLeads({ limit: LEADS_PAGE_SIZE }),
      api.listIntakeTokens(),
      api.listPosts({ limit: 100 }),
    ]);
    if (l.ok) { setLeads(l.data); setLeadsCursor(l.meta?.nextCursor ?? null); } else notify(t('leads.err.list', { error: tError(l.error) }), 'err');
    if (tokensRes.ok) setTokens(tokensRes.data);
    // Published posts can have comments — show them all as potential/active lead collectors.
    // Published posts only; a deleted post (collector stopped) is hidden — but any leads it already
    // collected stay in the leads list above (leads are separate rows, not tied to the post).
    if (p.ok) {
      const posts = p.data.filter((post) => (post.status === 'posted' || post.status === 'partial') && post.leadCollectorStatus !== 'post_deleted');
      setCollectors(posts);
      // Hydrate the persisted liveness snapshot so ⚪/🔴/🟢 survives a refresh (audit P0-3).
      // Keep any fresher in-session result (from a manual "Check links") over the server snapshot.
      setLinkStatus((prev) => {
        const seeded: Record<string, LinkStatusEntry[]> = { ...prev };
        for (const post of posts) if (!seeded[post.id] && post.linkStatus?.length) seeded[post.id] = post.linkStatus;
        return seeded;
      });
    }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mint = async () => {
    setBusy('mint');
    const r = await api.createIntakeToken();
    setBusy(null);
    if (!r.ok) { notify(t('leads.err.mint', { error: tError(r.error) }), 'err'); return; }
    setFreshToken(r.data.token); // shown once
    notify(t('leads.token.created'));
    await load();
  };
  const revoke = async (id: string) => {
    if (!confirm(t('leads.token.revoke_confirm'))) return;
    const r = await api.revokeIntakeToken(id);
    if (!r.ok) { notify(t('leads.err.revoke', { error: tError(r.error) }), 'err'); return; }
    notify(t('leads.token.revoked')); await load();
  };
  const pollComments = async () => {
    setBusy('poll');
    const r = await api.pollComments();
    setBusy(null);
    if (!r.ok) { notify(t('leads.err.poll', { error: tError(r.error) }), 'err'); return; }
    notify(t('leads.poll.result', { posts: r.data.postsPolled, captured: r.data.leadsCaptured, dup: r.data.duplicates }));
    if (r.data.leadsCaptured > 0) await load();
  };
  const rescore = async (id: string) => {
    setBusy(id);
    const r = await api.rescoreLead(id);
    setBusy(null);
    if (!r.ok) { notify(t('leads.err.rescore', { error: tError(r.error) }), 'err'); return; }
    setLeads((prev) => prev.map((l) => (l.id === id ? r.data : l)));
    notify(t('leads.rescore.result', { score: r.data.score ?? '—' }));
  };
  // Appends the next keyset page onto the existing list (does not disturb rows already rendered).
  const loadMoreLeads = async () => {
    if (!leadsCursor) return;
    setLoadingMore(true);
    const r = await api.listLeads({ limit: LEADS_PAGE_SIZE, cursor: leadsCursor });
    setLoadingMore(false);
    if (!r.ok) { notify(t('leads.err.list', { error: tError(r.error) }), 'err'); return; }
    setLeads((prev) => [...prev, ...r.data]);
    setLeadsCursor(r.meta?.nextCursor ?? null);
  };
  const startCollector = async (postId: string) => {
    const keyword = (keywordInputs[postId] ?? '').trim();
    if (!keyword) { notify(t('leads.collector.keyword_required'), 'err'); return; }
    setCollectorBusy(postId);
    const r = await api.setCollector(postId, keyword);
    setCollectorBusy(null);
    if (!r.ok) { notify(t('leads.err.collector', { error: tError(r.error) }), 'err'); return; }
    notify(t('leads.collector.started', { keyword }));
    setKeywordInputs((prev) => ({ ...prev, [postId]: '' }));
    await load();
  };
  const stopCollector = async (postId: string) => {
    setCollectorBusy(postId);
    const r = await api.setCollector(postId, null);
    setCollectorBusy(null);
    if (!r.ok) { notify(t('leads.err.collector', { error: tError(r.error) }), 'err'); return; }
    notify(t('leads.collector.stopped'));
    await load();
  };
  // Re-sets the same keyword — the backend refreshes the 30-day expiry window without
  // touching the keyword or watched sources.
  const extendCollector = async (postId: string, keyword: string) => {
    setCollectorBusy(postId);
    const r = await api.setCollector(postId, keyword);
    setCollectorBusy(null);
    if (!r.ok) { notify(t('leads.err.extend', { error: tError(r.error) }), 'err'); return; }
    notify(t('leads.collector.extended'));
    await load();
  };
  // On-demand per-platform liveness check (real API calls — slow). Reload after so a
  // self-healed post_deleted (all links dead) drops out of the list.
  const checkLinks = async (postId: string) => {
    setCheckBusy(postId);
    const r = await api.checkLinks(postId);
    if (!r.ok) { setCheckBusy(null); notify(t('leads.err.check_links', { error: tError(r.error) }), 'err'); return; }
    setLinkStatus((prev) => ({ ...prev, [postId]: r.data.links }));
    setCheckBusy(null);
    notify(t('leads.links.checked', { count: r.data.links.length }));
    await load();
  };

  const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

  return (
    <div className="leads-page">
      <div className="spread" style={{ marginBottom: 14 }}>
        <div>
          <div className="eyebrow">{t('leads.eyebrow')}</div>
          <h2 style={{ margin: '2px 0 0', fontSize: 18 }}>{t('leads.title')}</h2>
          <p className="muted small" style={{ marginTop: 4 }}>{t('leads.subtitle')}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" disabled={busy === 'poll'} onClick={() => void pollComments()}>{busy === 'poll' ? t('leads.poll.busy') : t('leads.poll.cta')}</button>
          <button className="btn" onClick={() => setSetupOpen((o) => !o)}>{setupOpen ? t('leads.setup.toggle_hide') : t('leads.setup.toggle_show')}</button>
        </div>
      </div>

      {setupOpen && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="spread">
            <strong style={{ fontSize: 14 }}>{t('leads.setup.tokens_title')}</strong>
            <button className="btn small primary" disabled={busy === 'mint'} onClick={() => void mint()}>{busy === 'mint' ? t('leads.setup.mint_busy') : t('leads.setup.mint_cta')}</button>
          </div>
          <p className="muted small" style={{ marginTop: 4 }}>{t('leads.setup.token_hint_pre')} <code>?t=TOKEN</code> {t('leads.setup.token_hint_mid')} <code>x-intake-token</code> {t('leads.setup.token_hint_post')}</p>
          {freshToken && (
            <div className="copy-box" style={{ borderColor: 'var(--accent)' }}>
              <div className="label">{t('leads.setup.new_token_label')}</div>
              <div className="text" style={{ wordBreak: 'break-all' }}>{freshToken}</div>
              <div className="muted small" style={{ marginTop: 4 }}>{t('leads.setup.example_label')} <code>{base || 'http://localhost:7100'}/leads/form?t={freshToken}</code></div>
              <button className="btn small" style={{ marginTop: 6 }} onClick={() => { void navigator.clipboard.writeText(freshToken); notify(t('leads.setup.copied')); }}>{t('leads.setup.copy_cta')}</button>
            </div>
          )}
          {tokens.length === 0 ? <p className="muted small">{t('leads.setup.no_tokens')}</p> : (
            <div className="post-summary-list" style={{ marginTop: 8 }}>
              {tokens.map((tok) => (
                <div key={tok.id} className="spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="small">{tok.label ?? t('leads.token.default_label')} · <span className={tok.active ? '' : 'muted'}>{tok.active ? t('leads.token.active') : t('leads.token.revoked_state')}</span> · <span className="muted">{t('leads.token.used', { value: tok.lastUsedAt ? new Date(tok.lastUsedAt).toLocaleDateString() : t('leads.token.never') })}</span></span>
                  {tok.active && <button className="btn small danger" onClick={() => void revoke(tok.id)}>{t('leads.token.revoke_cta')}</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Published posts can watch comments for a keyword — start/stop the collector inline. */}
      {collectors.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="spread"><strong style={{ fontSize: 14 }}>{t('leads.collectors.title')}</strong><span className="muted small">{t('leads.collectors.count', { count: collectors.length })}</span></div>
          <p className="muted small" style={{ marginTop: 4 }}>{t('leads.collectors.hint_pre')} <strong>{t('leads.poll.cta')}</strong> {t('leads.collectors.hint_post')}</p>
          <div className="post-summary-list" style={{ marginTop: 8 }}>
            {collectors.map((p) => {
              const collecting = Boolean(p.leadCaptureKeyword);
              const watchedPlatforms = p.commentSourceIds ? Object.keys(p.commentSourceIds) : [];
              const pending = collecting && watchedPlatforms.length === 0;
              const rowBusy = collectorBusy === p.id;
              const rowChecking = checkBusy === p.id;
              const checked = linkStatus[p.id];
              const linkEntries: LinkEntry[] =
                checked ?? (p.postUrls ? Object.entries(p.postUrls).map(([platform, url]) => ({ platform, url, alive: undefined })) : []);
              const expiry = collecting ? expiryText(p.leadCollectorExpiresAt) : null;
              return (
                <div key={p.id} className="spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <div className="small">
                      <strong>{p.platforms.join(', ') || t('leads.collectors.no_platforms')}</strong>{' '}
                      <span className="muted">· {p.id.slice(0, 8)} · {p.status}</span>
                    </div>
                    {linkEntries.length > 0 && (
                      <div className="small" style={{ marginTop: 2 }}>
                        {linkEntries.map((l) => (
                          <a key={l.platform} href={l.url} target="_blank" rel="noreferrer" title={aliveTitle(l.alive)} style={{ marginRight: 10 }}>
                            {aliveMarker(l.alive)}{l.platform} ↗
                          </a>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 2 }}>
                      {collecting ? (
                        <span className="small">
                          {pending ? t('leads.collectors.pending') : t('leads.collectors.collecting')} — {t('leads.collectors.keyword_label')} <strong>{p.leadCaptureKeyword}</strong>
                          {watchedPlatforms.length > 0 && <span className="muted"> · {t('leads.collectors.watching', { platforms: watchedPlatforms.join(', ') })}</span>}
                          {expiry && (
                            <span className={expiry.expired ? '' : 'muted'} style={expiry.expired ? { color: 'var(--amber)', marginLeft: 6, fontWeight: 600 } : { marginLeft: 6 }}>
                              {' '}· {expiry.text}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="muted small">{t('leads.collectors.not_collecting')}</span>
                      )}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    <button className="btn small" disabled={rowBusy || rowChecking} onClick={() => void checkLinks(p.id)}>
                      {rowChecking ? t('leads.collectors.check_links_busy') : t('leads.collectors.check_links_cta')}
                    </button>
                    {collecting ? (
                      <>
                        <button
                          className={`btn small ${expiry?.expired ? 'primary' : ''}`}
                          disabled={rowBusy || rowChecking}
                          onClick={() => void extendCollector(p.id, p.leadCaptureKeyword as string)}
                        >
                          {rowBusy ? '…' : t('leads.collectors.extend_cta')}
                        </button>
                        <button className="btn small danger" disabled={rowBusy || rowChecking} onClick={() => void stopCollector(p.id)}>{rowBusy ? '…' : t('leads.collectors.stop_cta')}</button>
                      </>
                    ) : (
                      <>
                        <input
                          value={keywordInputs[p.id] ?? ''}
                          onChange={(e) => setKeywordInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          placeholder={t('leads.collectors.keyword_placeholder')}
                          style={{ width: 110 }}
                          disabled={rowBusy || rowChecking}
                        />
                        <button className="btn small primary" disabled={rowBusy || rowChecking} onClick={() => void startCollector(p.id)}>{rowBusy ? '…' : t('leads.collectors.start_cta')}</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading ? <div className="muted">{t('common.loading')}</div> : leads.length === 0 ? (
        <p className="muted">{t('leads.empty.title')} {collectors.length > 0 ? t('leads.empty.with_collectors') : <>{t('leads.empty.no_collectors_pre')} <strong>{t('leads.empty.setup_link')}</strong>{t('leads.empty.no_collectors_post')}</>}</p>
      ) : (
        <>
          <div className="lead-table">
            {leads.map((l) => (
              <div key={l.id} className="lead-row card">
                <div className={`lead-score ${scoreClass(l.score)}`} title={l.scoreReasons.map((r) => `${r.reason} (${r.delta >= 0 ? '+' : ''}${r.delta})`).join('\n')}>
                  {l.score ?? '—'}
                </div>
                <div className="lead-main">
                  <div className="lead-head"><strong>{l.name ?? l.email}</strong> <span className="muted small">{l.email}</span></div>
                  <div className="muted small">{l.source}{l.phone ? ` · ${l.phone}` : ''} · {new Date(l.receivedAt).toLocaleString()}</div>
                  {l.message && <div className="small" style={{ marginTop: 4 }}>{l.message}</div>}
                </div>
                <button className="btn small" disabled={busy === l.id} onClick={() => void rescore(l.id)}>{busy === l.id ? '…' : t('leads.rescore.cta')}</button>
              </div>
            ))}
          </div>
          {leadsCursor && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn" disabled={loadingMore} onClick={() => void loadMoreLeads()}>
                {loadingMore ? t('leads.load_more.busy') : t('leads.load_more.cta')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
