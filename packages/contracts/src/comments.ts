import { z } from 'zod';

/** Comment text: trimmed, 1..4000 characters. */
const body = z.string().trim().min(1, 'Write a comment').max(4000);
/** Position on the screen, relative to its width/height. */
const coordinate = z.number().min(0).max(1);

/** A reply in a thread (one level deep). */
export const commentReplySchema = z.object({
  id: z.uuid(),
  parentId: z.uuid(),
  body: z.string(),
  authorId: z.uuid().nullable(),
  /** Null when the author's account no longer exists. */
  authorName: z.string().nullable(),
  edited: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type CommentReply = z.infer<typeof commentReplySchema>;

/**
 * A top-level comment (thread) on a file: pinned to a screen (`pageId` with `x`/`y` in 0..1),
 * on a screen without a position (`pageId`, null x/y) or on the whole file (all null).
 * `pageId` becomes null when the screen is deleted.
 */
export const commentThreadSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  pageId: z.uuid().nullable(),
  x: z.number().nullable(),
  y: z.number().nullable(),
  body: z.string(),
  authorId: z.uuid().nullable(),
  authorName: z.string().nullable(),
  edited: z.boolean(),
  resolvedAt: z.iso.datetime({ offset: true }).nullable(),
  resolvedById: z.uuid().nullable(),
  resolvedByName: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  /** Oldest first. */
  replies: z.array(commentReplySchema),
});
export type CommentThread = z.infer<typeof commentThreadSchema>;

export const commentListQuerySchema = z.object({
  /** Resolved threads are hidden unless `includeResolved=true`. */
  includeResolved: z.stringbool().default(false),
});
export type CommentListQuery = z.infer<typeof commentListQuerySchema>;

export const createCommentSchema = z
  .object({
    pageId: z.uuid().nullable().default(null),
    x: coordinate.nullable().default(null),
    y: coordinate.nullable().default(null),
    body,
  })
  .refine((v) => (v.x === null) === (v.y === null), {
    message: 'x and y must both be set or both be omitted',
    path: ['x'],
  })
  .refine((v) => v.x === null || v.pageId !== null, {
    message: 'A pinned comment needs a screen',
    path: ['pageId'],
  });
export type CreateComment = z.infer<typeof createCommentSchema>;

export const createReplySchema = z.object({ body });
export type CreateReply = z.infer<typeof createReplySchema>;

export const updateCommentSchema = z.object({ body });
export type UpdateComment = z.infer<typeof updateCommentSchema>;
