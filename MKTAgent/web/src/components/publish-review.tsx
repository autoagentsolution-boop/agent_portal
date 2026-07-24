// Publish review (item 3): before the publish/approve gate, show — per target platform
// — whether the post's asset type is postable there AND whether it's connected. Turns an
// opaque "Approve" into an informed check: the user sees exactly what will go where and why
// the rest is held. Fetched on mount from GET /posts/:id/postability (read-only, no network
// publish). Pairs with item 1 (the runtime skip) and item 2 (auto-publish).
import { useEffect, useState } from 'react';
import { api, type PostabilityDto, type PostabilityRowDto } from '../api/client';
import { useLocale, type MessageKey, type Params } from '../i18n';
import { tError, type ApiErrorLike } from '../i18n/t-error';

interface Props {
  postId: string;
  onOpenConnections?: () => void;
}

const label = (p: string): string => p.charAt(0).toUpperCase() + p.slice(1);

const rowNote = (r: PostabilityRowDto, t: (key: MessageKey, params?: Params) => string): string => {
  if (r.willPublish) return t('publish.row.will_publish');
  if (!r.assetSupported) return r.reason ?? t('publish.row.asset_unsupported');
  return r.reason ?? t('publish.row.connection_state', { state: r.connectionState.replace('_', ' ') });
};

export function PublishReview({ postId, onOpenConnections }: Props) {
  const { t } = useLocale();
  const [data, setData] = useState<PostabilityDto | null>(null);
  const [err, setErr] = useState<ApiErrorLike | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await api.getPostability(postId);
      if (!live) return;
      if (r.ok) setData(r.data);
      else setErr(r.error);
    })();
    return () => { live = false; };
  }, [postId]);

  if (err) return <p className="muted small">{t('publish.review.load_failed', { reason: tError(err) })}</p>;
  if (!data) return <p className="muted small">{t('publish.review.checking')}</p>;

  const hasConnBlock = data.platforms.some((p) => !p.willPublish && p.assetSupported && p.connectionState !== 'connected');

  return (
    <div className="publish-review">
      <div className="section-title">{t('publish.review.title', { assetType: data.assetType })}</div>
      <ul className="publish-review-list">
        {data.platforms.map((p) => (
          <li key={p.platform} className={p.willPublish ? 'ok' : 'blocked'}>
            <span className="publish-review-icon">{p.willPublish ? '✓' : '✗'}</span>
            <span className="publish-review-platform">{label(p.platform)}</span>
            <span className="publish-review-note muted small">{rowNote(p, t)}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        {data.publishable.length > 0
          ? t('publish.review.summary.some', { publishable: data.publishable.length, total: data.platforms.length })
          : t('publish.review.summary.none')}
      </p>
      {hasConnBlock && onOpenConnections && (
        <button className="btn small" onClick={onOpenConnections}>{t('connect.fix.cta')}</button>
      )}
    </div>
  );
}
