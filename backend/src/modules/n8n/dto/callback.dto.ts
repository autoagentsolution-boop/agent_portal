import { z } from 'zod';

export const N8nCallbackSchema = z.object({
  execution_id: z.string().min(1),
  agent_instance_id: z.string().min(1),
  template_id: z.string().min(1),
  status: z.enum(['success', 'warning', 'failed']),
  n8n_execution_id: z.string().nullable().optional(),
  started_at: z.string().datetime().nullable().optional(),
  finished_at: z.string().datetime().nullable().optional(),
  metrics: z
    .object({
      input_count: z.number().int().nonnegative().default(0),
      output_count: z.number().int().nonnegative().default(0),
      error_count: z.number().int().nonnegative().default(0),
      tokens_input: z.number().int().nonnegative().default(0),
      tokens_output: z.number().int().nonnegative().default(0),
      estimated_cost_usd: z.number().nonnegative().default(0),
    })
    .partial()
    .optional(),
  result: z
    .object({
      summary: z.string().optional(),
      data: z.unknown().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean().optional(),
    })
    .nullable()
    .optional(),
});

export type N8nCallbackDto = z.infer<typeof N8nCallbackSchema>;

export interface N8nTriggerPayload {
  execution_id: string;
  agent_instance_id: string;
  template_id: string;
  workspace_id: string;
  config: Record<string, unknown>;
  selected_integrations: string[];
  input: { mode: string; items: unknown[] };
  callback: { url: string; secret: string };
}
