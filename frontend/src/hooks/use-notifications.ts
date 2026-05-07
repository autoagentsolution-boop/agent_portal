import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { Notification, NotificationSeverity, NotificationStatus } from '../lib/types';

export interface NotificationsQuery {
  status?: NotificationStatus;
  severity?: NotificationSeverity;
  agent_instance_id?: string;
  limit?: number;
}

export function useNotifications(query: NotificationsQuery = {}) {
  return useQuery({
    queryKey: ['notifications', query],
    queryFn: async () => {
      const res = await apiClient.get<Notification[]>('/notifications', {
        params: {
          ...(query.status && { status: query.status }),
          ...(query.severity && { severity: query.severity }),
          ...(query.agent_instance_id && { agent_instance_id: query.agent_instance_id }),
          ...(query.limit && { limit: String(query.limit) }),
        },
      });
      return res.data;
    },
  });
}

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: ['notifications', 'count', 'unread'],
    queryFn: async () => {
      const res = await apiClient.get<{ count: number }>('/notifications/count', {
        params: { status: 'unread' },
      });
      return res.data.count;
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

function useNotificationMutation(action: 'acknowledge' | 'resolve') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.patch<Notification>(`/notifications/${id}/${action}`, {});
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export const useAcknowledgeNotification = () => useNotificationMutation('acknowledge');
export const useResolveNotification = () => useNotificationMutation('resolve');
