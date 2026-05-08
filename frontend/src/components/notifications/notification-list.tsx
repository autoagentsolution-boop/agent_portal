import { Bell } from 'lucide-react';
import { RowSkeleton } from '../ui/loading-skeleton';
import { ErrorState } from '../ui/error-state';
import { EmptyState } from '../ui/empty-state';
import { NotificationCard, type NotificationCardProps } from './notification-card';
import type { Notification } from '../../lib/types';

export interface NotificationListProps {
  notifications: Notification[] | undefined;
  isLoading?: boolean;
  error?: unknown;
  emptyHint?: string;
  busyId?: string | null;
  onAcknowledge?: NotificationCardProps['onAcknowledge'];
  onResolve?: NotificationCardProps['onResolve'];
  onRetry?: NotificationCardProps['onRetry'];
  onRetryFetch?: () => void;
  isRetryingFetch?: boolean;
}

export function NotificationList({
  notifications,
  isLoading,
  error,
  emptyHint = 'No notifications match the current filters.',
  busyId,
  onAcknowledge,
  onResolve,
  onRetry,
  onRetryFetch,
  isRetryingFetch,
}: NotificationListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <RowSkeleton key={i} height="h-28" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <ErrorState
        title="Failed to load notifications"
        error={error}
        onRetry={onRetryFetch}
        isRetrying={isRetryingFetch}
      />
    );
  }
  if (!notifications || notifications.length === 0) {
    return <EmptyState icon={Bell} title={emptyHint} />;
  }
  return (
    <div className="space-y-3">
      {notifications.map((n) => (
        <NotificationCard
          key={n.id}
          notification={n}
          busy={busyId === n.id}
          onAcknowledge={onAcknowledge}
          onResolve={onResolve}
          onRetry={onRetry}
        />
      ))}
    </div>
  );
}
