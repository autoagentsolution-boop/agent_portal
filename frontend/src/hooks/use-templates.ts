import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { AgentTemplate } from '../lib/types';

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      const res = await apiClient.get<AgentTemplate[]>('/agent-templates');
      return res.data;
    },
  });
}

export function useTemplate(id: string | null | undefined) {
  return useQuery({
    queryKey: ['template', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await apiClient.get<AgentTemplate>(`/agent-templates/${id}`);
      return res.data;
    },
  });
}
