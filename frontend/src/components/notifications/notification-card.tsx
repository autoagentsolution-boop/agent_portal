import { Link } from 'react-router-dom';
import { ExternalLink, RefreshCw, Check, EyeOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatRelativeShort, shortId } from '../../lib/formatters';
import { Button } from '../ui/button';
import { NotificationSeverityIcon, severityBadgeClass } from './notification-severity-icon';
import type { Notification } from '../../lib/types';

export interface NotificationCardProps {
  notification: Notification;
  onAcknowledge?: (id: string) => void;
  onResolve?: (id: string) => void;
  onRetry?: (executionId: string) => void;
  busy?: boolean;
}

export function NotificationCard({
  notification: n,
  onAcknowledge,
  onResolve,
  onRetry,
  busy,
}: NotificationCardProps) {
  const agentName = n.agentInstance?.name ?? '—';
  const isResolved = n.status === 'resolved';
  const isAcknowledged = n.status === 'acknowledged';

  return (
    <article
      className={cn(
        'rounded-lg border bg-white p-4 shadow-sm transition-colors',
        isResolved ? 'border-gray-200 opacity-70' : 'border-gray-200 hover:border-gray-300',
      )}
    >
      <header className="flex items-start gap-3">
        <NotificationSeverityIcon severity={n.severity} className="mt-0.5 h-5 w-5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{n.title}</h3>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset',
                severityBadgeClass(n.severity),
              )}
            >
              {n.severity}
            </span>
            {n.status !== 'unread' && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                {n.status}
              </span>
            )}
          </div>
          {n.message && (
            <p className="mt-1 text-sm text-gray-700 leading-relaxed">{n.message}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>Agent: <span className="font-medium text-gray-700">{agentName}</span></span>
            {n.executionId && (
              <span>Exec: <span className="font-mono">{shortId(n.executionId, 10)}</span></span>
            )}
            <span title={n.createdAt}>{formatRelativeShort(n.createdAt)}</span>
          </div>
        </div>
      </header>

      <div className="mt-3 flex flex-wrap gap-2">
        {n.executionId && (
          <Button asChild size="sm" variant="outline">
            <Link to={`/executions/${n.executionId}`}>
              <ExternalLink className="h-3.5 w-3.5" />
              View Execution
            </Link>
          </Button>
        )}
        {n.executionId && onRetry && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onRetry(n.executionId!)}>
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        )}
        {!isAcknowledged && !isResolved && onAcknowledge && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAcknowledge(n.id)}>
            <EyeOff className="h-3.5 w-3.5" />
            Mark Read
          </Button>
        )}
        {!isResolved && onResolve && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onResolve(n.id)}>
            <Check className="h-3.5 w-3.5" />
            Mark Resolved
          </Button>
        )}
      </div>
    </article>
  );
}
