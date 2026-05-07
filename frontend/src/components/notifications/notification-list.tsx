import { Bell } from 'lucide-react';
import { Skeleton } from '../ui/skeleton';
import { extractErrorMessage } from '../../lib/api-client';
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
}: NotificationListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {extractErrorMessage(error, 'Failed to load notifications.')}
      </div>
    );
  }
  if (!notifications || notifications.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
        <Bell className="mx-auto h-6 w-6 text-gray-400" />
        <p className="mt-2 text-sm text-gray-600">{emptyHint}</p>
      </div>
    );
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
