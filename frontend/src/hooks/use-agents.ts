import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
  AgentInstance,
  AgentInstanceStatus,
  AgentTemplate,
  Integration,
  RunResponse,
} from '../lib/types';

export interface AgentDetail extends AgentInstance {
  configJson?: Record<string, unknown>;
  template?: AgentTemplate & { id: string; name: string; category: string };
  integrations?: Array<{ integrationId: string; integration: Integration }>;
  executions?: unknown[];
}

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const res = await apiClient.get<AgentInstance[]>('/agent-instances');
      return res.data;
    },
  });
}

export function useAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ['agent', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await apiClient.get<AgentDetail>(`/agent-instances/${id}`);
      return res.data;
    },
  });
}

export interface RunAgentArgs {
  id: string;
  overrides?: Record<string, unknown>;
}

export function useRunAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: RunAgentArgs | string) => {
      const { id, overrides } = typeof args === 'string' ? { id: args, overrides: undefined } : args;
      const body = overrides && Object.keys(overrides).length > 0 ? { overrides } : {};
      const res = await apiClient.post<RunResponse>(`/agent-instances/${id}/run`, body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export interface CreateAgentPayload {
  template_id: string;
  name: string;
  selected_integrations: string[];
  trigger_mode: string;
  config: Record<string, unknown>;
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateAgentPayload) => {
      const res = await apiClient.post<AgentInstance>('/agent-instances', payload);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useUpdateAgentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AgentInstanceStatus }) => {
      const res = await apiClient.patch<AgentInstance>(`/agent-instances/${id}/status`, { status });
      return res.data;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      void qc.invalidateQueries({ queryKey: ['agent', vars.id] });
    },
  });
}

export function useArchiveAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.delete<AgentInstance>(`/agent-instances/${id}`);
      return res.data;
    },
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      void qc.invalidateQueries({ queryKey: ['agent', id] });
    },
  });
}

export function archiveAgentSilently(id: string): void {
  apiClient.delete(`/agent-instances/${id}`).catch(() => {
    // Best-effort cleanup on wizard exit. Failure is acceptable —
    // a periodic backend sweep is the canonical garbage collector.
  });
}
