import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

export type ApprovalAction = 'approve' | 'reject';

export interface ApprovalPayload {
  executionId: string;
  action: ApprovalAction;
  draftIndex?: number;
  note?: string;
}

export interface ApprovalResponse {
  execution_id: string;
  action: ApprovalAction;
  transitioned_indices: number[];
  outputJson: unknown;
}

export function useDraftApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ executionId, ...body }: ApprovalPayload) => {
      const res = await apiClient.patch<ApprovalResponse>(
        `/executions/${executionId}/approval`,
        body,
      );
      return res.data;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['execution', vars.executionId] });
      void qc.invalidateQueries({ queryKey: ['executions'] });
    },
  });
}
