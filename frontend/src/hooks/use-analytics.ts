import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { AnalyticsAgentSummary, AnalyticsSummary } from '../lib/types';

export function useAnalyticsSummary() {
  return useQuery({
    queryKey: ['analytics', 'summary'],
    queryFn: async () => {
      const res = await apiClient.get<AnalyticsSummary>('/analytics/summary');
      return res.data;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useAgentAnalytics(agentInstanceId: string | undefined) {
  return useQuery({
    queryKey: ['analytics', 'agents', agentInstanceId],
    queryFn: async () => {
      const res = await apiClient.get<AnalyticsAgentSummary>(
        `/analytics/agents/${agentInstanceId}`,
      );
      return res.data;
    },
    enabled: Boolean(agentInstanceId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
