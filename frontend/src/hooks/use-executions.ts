import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ExecutionRow, RunResponse } from '../lib/types';

export interface ExecutionsQuery {
  agent_instance_id?: string;
  status?: string;
  limit?: number;
}

export function useExecutions(query: ExecutionsQuery = {}) {
  return useQuery({
    queryKey: ['executions', query],
    queryFn: async () => {
      const res = await apiClient.get<ExecutionRow[]>('/executions', {
        params: {
          ...(query.agent_instance_id && { agent_instance_id: query.agent_instance_id }),
          ...(query.status && { status: query.status }),
          ...(query.limit && { limit: String(query.limit) }),
        },
      });
      return res.data;
    },
  });
}

export function useRetryExecution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (executionId: string) => {
      const res = await apiClient.post<RunResponse>(`/executions/${executionId}/retry`, {});
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['executions'] });
      void qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
