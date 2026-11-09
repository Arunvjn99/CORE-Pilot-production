import { z } from 'zod';

export const dependencyStatusSchema = z.enum(['up', 'down']);

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  service: z.string(),
  version: z.string(),
  checks: z.record(z.string(), dependencyStatusSchema),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
