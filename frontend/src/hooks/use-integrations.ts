import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { Integration } from '../lib/types';

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: async () => {
      const res = await apiClient.get<Integration[]>('/integrations');
      return res.data;
    },
  });
}
