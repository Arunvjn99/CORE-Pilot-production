import type { CommentThread, Screen } from '@core-studio/contracts';
import { Check, MessageCircle, RotateCcw, Trash2 } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { Button, EmptyState, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { timeAgo } from '../../lib/time';
import { useCommentMutations } from './comments-api';

export interface PendingPin {
  pageId: string;
  x: number;
  y: number;
}

const field =
  'w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent';
const small =
  'inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent';

const failure = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

function Composer({
  label,
  submitLabel,
  initial = '',
  autoFocus = false,
  pending,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initial?: string;
  autoFocus?: boolean;
  pending: boolean;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initial);
  const id = useId();
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim()) onSubmit(body.trim());
        setBody('');
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={4000}
        value={body}
        autoFocus={autoFocus}
        placeholder={label}
        className={field}
        onChange={(event) => {
          setBody(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
            event.currentTarget.form?.requestSubmit();
          if (event.key === 'Escape' && onCancel) onCancel();
        }}
      />
      <div className="flex justify-end gap-1">
        {onCancel && (
          <Button onClick={onCancel} className="!px-2 !py-1 text-xs">
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={pending || !body.trim()}
          className="!px-2 !py-1 text-xs"
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Message({
  author,
  createdAt,
  edited,
  children,
}: {
  author: string | null;
  createdAt: string;
  edited: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-text-muted">
        <span className="font-semibold text-text">{author ?? 'Former member'}</span> ·{' '}
        {timeAgo(createdAt)}
        {edited ? ' · edited' : ''}
      </p>
      <div className="text-sm break-words whitespace-pre-wrap">{children}</div>
    </div>
  );
}

/** Left panel tab: comment threads (pins on screens or file-level), replies, resolve. */
export function CommentsPanel({
  projectId,
  threads,
  screens,
  userId,
  canWrite,
  canModerate,
  includeResolved,
  onIncludeResolved,
  pendingPin,
  onCancelPin,
  activeId,
  onSelect,
}: {
  projectId: string;
  threads: CommentThread[] | undefined;
  screens: Screen[];
  userId: string;
  canWrite: boolean;
  /** Team admins/owners may delete anyone's comments. */
  canModerate: boolean;
  includeResolved: boolean;
  onIncludeResolved: (value: boolean) => void;
  pendingPin: PendingPin | null;
  onCancelPin: () => void;
  activeId: string | null;
  onSelect: (threadId: string) => void;
}) {
  const m = useCommentMutations(projectId);
  const [editing, setEditing] = useState<string | null>(null);
  const screenName = (pageId: string | null) =>
    pageId ? (screens.find((s) => s.pageId === pageId)?.name ?? 'Deleted screen') : 'Whole file';
  const error =
    m.create.error ?? m.reply.error ?? m.edit.error ?? m.setResolved.error ?? m.remove.error;
  const numbered = (threads ?? []).filter((t) => t.x !== null);

  return (
    <section aria-label="Comments" className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(event) => {
              onIncludeResolved(event.target.checked);
            }}
          />
          Show resolved
        </label>
      </div>
      {error ? (
        <ErrorMessage>{failure(error, 'The comment could not be saved.')}</ErrorMessage>
      ) : null}

      {pendingPin && (
        <div className="space-y-1 rounded-md border border-accent p-2">
          <p className="text-xs font-semibold">New comment on {screenName(pendingPin.pageId)}</p>
          <Composer
            label="Add a comment"
            submitLabel="Post"
            autoFocus
            pending={m.create.isPending}
            onCancel={onCancelPin}
            onSubmit={(body) => {
              m.create.mutate(
                { pageId: pendingPin.pageId, x: pendingPin.x, y: pendingPin.y, body },
                {
                  onSuccess: (thread) => {
                    onCancelPin();
                    onSelect(thread.id);
                  },
                },
              );
            }}
          />
        </div>
      )}
      {canWrite && !pendingPin && (
        <Composer
          label="Comment on the whole file"
          submitLabel="Post"
          pending={m.create.isPending}
          onSubmit={(body) => {
            m.create.mutate({ body });
          }}
        />
      )}

      {threads?.length === 0 && !pendingPin && (
        <EmptyState icon={<MessageCircle size={28} />} title="No comments">
          {canWrite
            ? 'Choose the comment tool (C) and click a screen to pin a comment.'
            : 'Nobody has commented on this file yet.'}
        </EmptyState>
      )}
      <ol className="space-y-2">
        {(threads ?? []).map((thread) => {
          const pinNumber = numbered.indexOf(thread) + 1;
          const own = thread.authorId === userId;
          return (
            <li
              key={thread.id}
              aria-label={`Comment by ${thread.authorName ?? 'former member'}: ${thread.body.slice(0, 60)}`}
              className={`space-y-2 rounded-md border p-2 ${activeId === thread.id ? 'border-accent' : 'border-border'} ${thread.resolvedAt ? 'opacity-70' : ''}`}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left text-xs text-text-muted hover:text-text"
                onClick={() => {
                  onSelect(thread.id);
                }}
              >
                {pinNumber > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-accent-contrast">
                    {pinNumber}
                  </span>
                )}
                <span className="truncate">{screenName(thread.pageId)}</span>
                {thread.resolvedAt && <span>· Resolved</span>}
              </button>
              {editing === thread.id ? (
                <Composer
                  label="Edit comment"
                  submitLabel="Save"
                  initial={thread.body}
                  autoFocus
                  pending={m.edit.isPending}
                  onCancel={() => {
                    setEditing(null);
                  }}
                  onSubmit={(body) => {
                    m.edit.mutate(
                      { commentId: thread.id, body },
                      {
                        onSuccess: () => {
                          setEditing(null);
                        },
                      },
                    );
                  }}
                />
              ) : (
                <Message
                  author={thread.authorName}
                  createdAt={thread.createdAt}
                  edited={thread.edited}
                >
                  {thread.body}
                </Message>
              )}
              {thread.replies.length > 0 && (
                <ul className="space-y-2 border-l-2 border-border pl-2">
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>
                      <Message
                        author={reply.authorName}
                        createdAt={reply.createdAt}
                        edited={reply.edited}
                      >
                        {reply.body}
                      </Message>
                      {canWrite && (reply.authorId === userId || canModerate) && (
                        <button
                          type="button"
                          className={small}
                          aria-label={`Delete reply by ${reply.authorName ?? 'former member'}`}
                          onClick={() => {
                            m.remove.mutate(reply.id);
                          }}
                        >
                          <Trash2 size={12} aria-hidden="true" /> Delete
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canWrite && (
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    className={small}
                    onClick={() => {
                      m.setResolved.mutate({ threadId: thread.id, resolved: !thread.resolvedAt });
                    }}
                  >
                    {thread.resolvedAt ? (
                      <>
                        <RotateCcw size={12} aria-hidden="true" /> Reopen
                      </>
                    ) : (
                      <>
                        <Check size={12} aria-hidden="true" /> Resolve
                      </>
                    )}
                  </button>
                  {own && (
                    <button
                      type="button"
                      className={small}
                      onClick={() => {
                        setEditing(thread.id);
                      }}
                    >
                      Edit
                    </button>
                  )}
                  {(own || canModerate) && (
                    <button
                      type="button"
                      className={small}
                      aria-label="Delete thread"
                      onClick={() => {
                        m.remove.mutate(thread.id);
                      }}
                    >
                      <Trash2 size={12} aria-hidden="true" /> Delete
                    </button>
                  )}
                </div>
              )}
              {canWrite && !thread.resolvedAt && (
                <Composer
                  label="Reply"
                  submitLabel="Reply"
                  pending={m.reply.isPending}
                  onSubmit={(body) => {
                    m.reply.mutate({ threadId: thread.id, body });
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
