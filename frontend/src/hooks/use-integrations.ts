import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { Integration, IntegrationTestResult } from '../lib/types';

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: async () => {
      const res = await apiClient.get<Integration[]>('/integrations');
      return res.data;
    },
  });
}

function useIntegrationStateMutation(action: 'mock-connect' | 'disconnect') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<Integration>(`/integrations/${id}/${action}`, {});
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}

export const useMockConnectIntegration = () => useIntegrationStateMutation('mock-connect');
export const useDisconnectIntegration = () => useIntegrationStateMutation('disconnect');

export function useTestIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<IntegrationTestResult>(`/integrations/${id}/test`, {});
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}
