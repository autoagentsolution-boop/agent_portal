import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { BusinessOutcomes, OutcomeRange } from '../lib/types';

export function useAgentBusinessOutcomes(
  agentInstanceId: string | undefined,
  range: OutcomeRange,
) {
  return useQuery({
    queryKey: ['analytics', 'agents', agentInstanceId, 'business-outcomes', range],
    queryFn: async () => {
      const res = await apiClient.get<BusinessOutcomes>(
        `/analytics/agents/${agentInstanceId}/business-outcomes`,
        { params: { range } },
      );
      return res.data;
    },
    enabled: Boolean(agentInstanceId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
