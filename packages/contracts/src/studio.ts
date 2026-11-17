import { z } from 'zod';

const iso = z.iso.datetime({ offset: true });

export const agentKeySchema = z.enum(['orchestrator', 'ux', 'ui', 'reviewer']);
export type AgentKey = z.infer<typeof agentKeySchema>;

const modelName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\w.:/@-]+$/, 'Unsupported characters in model id');

// ---------- agents (AGENT.md) ----------

export const agentDefinitionSchema = z.object({
  key: agentKeySchema,
  name: z.string(),
  description: z.string(),
  version: z.number().int(),
  instructions: z.string(),
  /** null = use the team's default model (one API key, one default model). */
  model: z.string().nullable(),
  enabled: z.boolean(),
  /** false while the team still uses the shipped default. */
  customized: z.boolean(),
  updatedAt: iso.nullable(),
  updatedByName: z.string().nullable(),
});
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

export const updateAgentSchema = z.object({
  instructions: z.string().trim().min(20, 'Instructions are too short').max(40_000),
  model: modelName.nullable(),
  enabled: z.boolean(),
  expectedVersion: z.number().int().min(0),
});
export type UpdateAgent = z.infer<typeof updateAgentSchema>;

export const agentVersionSchema = z.object({
  version: z.number().int(),
  instructions: z.string(),
  model: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: iso,
  authorName: z.string().nullable(),
});
export type AgentVersion = z.infer<typeof agentVersionSchema>;

export const revertAgentSchema = z.object({
  /** 0 = restore the shipped default. */
  toVersion: z.number().int().min(0),
  expectedVersion: z.number().int().min(0),
});

// ---------- design systems (DESIGN.md + tokens.css) ----------

export const designSystemSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
  .max(40);

const designMd = z.string().trim().min(20, 'DESIGN.md is too short').max(200_000);
const tokensCss = z.string().trim().min(10).max(50_000);

export const designSystemSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  version: z.number().int(),
  custom: z.boolean(),
  customized: z.boolean(),
});
export type DesignSystemSummary = z.infer<typeof designSystemSummarySchema>;

export const designSystemSchema = designSystemSummarySchema.extend({
  designMd: z.string(),
  tokensCss: z.string(),
  updatedAt: iso.nullable(),
  updatedByName: z.string().nullable(),
});
export type DesignSystem = z.infer<typeof designSystemSchema>;

export const updateDesignSystemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  designMd,
  tokensCss,
  expectedVersion: z.number().int().min(0),
});
export type UpdateDesignSystem = z.infer<typeof updateDesignSystemSchema>;

export const createDesignSystemSchema = z.object({
  slug: designSystemSlugSchema,
  name: z.string().trim().min(1).max(80),
  designMd,
  tokensCss,
});
export type CreateDesignSystem = z.infer<typeof createDesignSystemSchema>;

export const designSystemVersionSchema = z.object({
  version: z.number().int(),
  name: z.string(),
  createdAt: iso,
  authorName: z.string().nullable(),
});

/** The project's own copy of its design system, stored in the project repository. */
export const projectDesignSchema = z.object({
  designSystemSlug: z.string().nullable(),
  designMd: z.string(),
  tokensCss: z.string(),
  revision: z.number().int(),
});
export type ProjectDesign = z.infer<typeof projectDesignSchema>;

export const applyDesignSystemSchema = z.object({ slug: designSystemSlugSchema });
export const updateProjectDesignSchema = z.object({
  designMd,
  tokensCss,
  baseRevision: z.number().int().min(0),
});

// ---------- generation runs ----------

export const runStatusSchema = z.enum(['running', 'succeeded', 'failed']);

export const startRunSchema = z.object({ prompt: z.string().trim().min(3).max(8000) });

export const runStepSchema = z.object({
  agent: agentKeySchema,
  label: z.string(),
  status: z.enum(['running', 'succeeded', 'failed']),
  model: z.string().nullable(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  durationMs: z.number().int().nullable(),
  errorCode: z.string().nullable(),
});
export type RunStep = z.infer<typeof runStepSchema>;

export const runSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  status: runStatusSchema,
  prompt: z.string(),
  title: z.string().nullable(),
  errorCode: z.string().nullable(),
  startedByName: z.string().nullable(),
  startedAt: iso,
  finishedAt: iso.nullable(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  screens: z.number().int(),
  reviewScore: z.number().nullable(),
  traced: z.boolean(),
  steps: z.array(runStepSchema),
});
export type Run = z.infer<typeof runSchema>;

/** Server-sent events of a run (each is JSON in an SSE `data:` line). */
export const runEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('step_started'), agent: agentKeySchema, label: z.string() }),
  z.object({
    type: z.literal('step_finished'),
    agent: agentKeySchema,
    label: z.string(),
    model: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    durationMs: z.number(),
  }),
  z.object({
    type: z.literal('step_failed'),
    agent: agentKeySchema,
    label: z.string(),
    code: z.string(),
  }),
  z.object({
    type: z.literal('plan'),
    title: z.string(),
    summary: z.string(),
    screens: z.array(z.object({ name: z.string(), route: z.string() })),
    todos: z.array(z.string()),
  }),
  z.object({ type: z.literal('screen'), name: z.string(), route: z.string() }),
  z.object({
    type: z.literal('review'),
    round: z.number(),
    screens: z.array(
      z.object({
        route: z.string(),
        score: z.number(),
        pass: z.boolean(),
        checks: z
          .array(z.object({ id: z.string(), pass: z.boolean(), note: z.string() }))
          .default([]),
        fixes: z.array(z.string()).default([]),
      }),
    ),
  }),
  z.object({ type: z.literal('saved'), revision: z.number(), checkpointId: z.uuid().nullable() }),
  z.object({ type: z.literal('done'), status: runStatusSchema, errorCode: z.string().nullable() }),
]);
export type RunEvent = z.infer<typeof runEventSchema>;

// ---------- screens, source edits ----------

export const screenSchema = z.object({
  pageId: z.uuid(),
  name: z.string(),
  route: z.string(),
  filePath: z.string(),
  code: z.string(),
});
export const screensResponseSchema = z.object({
  revision: z.number().int(),
  tokensCss: z.string(),
  screens: z.array(screenSchema),
});
export type ScreensResponse = z.infer<typeof screensResponseSchema>;
export type Screen = z.infer<typeof screenSchema>;

export const editableAttributeSchema = z.enum([
  'data-link',
  'alt',
  'placeholder',
  'aria-label',
  'title',
]);

export const sourceEditSchema = z.object({
  path: z.string().max(300),
  /** JSX element location reported by the preview (1-based line, 0-based column). */
  line: z.number().int().min(1),
  column: z.number().int().min(0),
  baseRevision: z.number().int().min(0),
  op: z.discriminatedUnion('type', [
    z.object({ type: z.literal('setText'), text: z.string().max(2000) }),
    z.object({
      type: z.literal('setClassName'),
      className: z
        .string()
        .max(2000)
        .regex(/^[^"'`{}<>\\]*$/, 'Unsupported characters in class names'),
    }),
    z.object({
      type: z.literal('setAttribute'),
      name: editableAttributeSchema,
      value: z.string().max(500).nullable(),
    }),
  ]),
});
export type SourceEdit = z.infer<typeof sourceEditSchema>;
export const sourceEditResultSchema = z.object({ revision: z.number().int(), code: z.string() });

// ---------- metrics ----------

export const metricsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export const metricsSchema = z.object({
  days: z.number().int(),
  totals: z.object({
    runs: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
    screens: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    avgReviewScore: z.number().nullable(),
    avgDurationMs: z.number().nullable(),
  }),
  byAgent: z.array(
    z.object({
      agent: agentKeySchema,
      calls: z.number().int(),
      failures: z.number().int(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      avgDurationMs: z.number().nullable(),
    }),
  ),
  byModel: z.array(
    z.object({ model: z.string(), calls: z.number().int(), tokens: z.number().int() }),
  ),
  byDay: z.array(
    z.object({
      day: z.string(),
      runs: z.number().int(),
      tokens: z.number().int(),
      failed: z.number().int(),
    }),
  ),
  byProject: z.array(
    z.object({
      projectId: z.uuid(),
      name: z.string(),
      runs: z.number().int(),
      tokens: z.number().int(),
      screens: z.number().int(),
    }),
  ),
  errors: z.array(z.object({ code: z.string(), count: z.number().int() })),
});
export type Metrics = z.infer<typeof metricsSchema>;

export const studioConfigSchema = z.object({
  previewOrigin: z.string(),
  langsmithEnabled: z.boolean(),
});
export type StudioConfig = z.infer<typeof studioConfigSchema>;
