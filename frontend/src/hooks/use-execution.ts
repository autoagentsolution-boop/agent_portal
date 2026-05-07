import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ExecutionDetail } from '../lib/types';

const NON_TERMINAL = new Set(['queued', 'running']);

export function useExecution(id: string | null | undefined, options: { poll?: boolean } = {}) {
  const { poll = false } = options;
  return useQuery({
    queryKey: ['execution', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await apiClient.get<ExecutionDetail>(`/executions/${id}`);
      return res.data;
    },
    refetchInterval: (query) => {
      if (!poll) return false;
      const status = (query.state.data as ExecutionDetail | undefined)?.status;
      return status && NON_TERMINAL.has(status) ? 2000 : false;
    },
    refetchOnWindowFocus: false,
  });
}
