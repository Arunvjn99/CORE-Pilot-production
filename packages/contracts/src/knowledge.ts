import { z } from 'zod';

const iso = z.iso.datetime({ offset: true });

/** Longest knowledge document a team can save (markdown). */
export const KNOWLEDGE_BODY_MAX = 100_000;
/** Total knowledge (all enabled documents) sent to the agents on one run. */
export const KNOWLEDGE_RUN_BUDGET = 60_000;
/** Documents a team can keep. */
export const KNOWLEDGE_MAX_DOCUMENTS = 200;

// ---------- team knowledge base ----------

export const knowledgeDocumentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  enabled: z.boolean(),
  createdAt: iso,
  createdByName: z.string().nullable(),
  updatedAt: iso,
  updatedByName: z.string().nullable(),
});
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;

const title = z.string().trim().min(1, 'Enter a title').max(120);
const body = z.string().max(KNOWLEDGE_BODY_MAX, 'Keep a document under 100,000 characters');

export const createKnowledgeDocumentSchema = z.object({
  title,
  body,
  enabled: z.boolean().default(true),
});
export type CreateKnowledgeDocument = z.input<typeof createKnowledgeDocumentSchema>;

export const updateKnowledgeDocumentSchema = z.object({
  title,
  body,
  enabled: z.boolean(),
  /** `updatedAt` of the document as last read; a newer save makes this a 409 STALE_UPDATE. */
  expectedUpdatedAt: iso,
});
export type UpdateKnowledgeDocument = z.infer<typeof updateKnowledgeDocumentSchema>;
