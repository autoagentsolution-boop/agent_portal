import { z } from 'zod';

export const CreateAgentSchema = z.object({
  template_id: z.string(),
  name: z.string().min(1),
  selected_integrations: z.array(z.string()),
  trigger_mode: z.string(),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type CreateAgentDto = z.infer<typeof CreateAgentSchema>;

export const UpdateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  selected_integrations: z.array(z.string()).optional(),
  trigger_mode: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateAgentDto = z.infer<typeof UpdateAgentSchema>;

export const UpdateStatusSchema = z.object({
  status: z.enum(['draft', 'running', 'paused', 'error', 'archived']),
});
export type UpdateStatusDto = z.infer<typeof UpdateStatusSchema>;
