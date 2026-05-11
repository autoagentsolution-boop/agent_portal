import { z } from 'zod';

export const RunAgentSchema = z.object({
  overrides: z.record(z.string(), z.unknown()).optional(),
});
export type RunAgentDto = z.infer<typeof RunAgentSchema>;
