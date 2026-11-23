import { KNOWLEDGE_RUN_BUDGET, type KnowledgeDocument } from '@core-studio/contracts';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import { AlertDialog } from 'radix-ui';
import { useId, useState } from 'react';
import { Button, EmptyState, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { hasPermission } from '../auth/permissions';
import { useSession } from '../auth/use-session';
import { useKnowledge, useKnowledgeMutations } from './knowledge-api';

const control =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60';
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const count = new Intl.NumberFormat();

const errorText = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

/**
 * Settings → Knowledge: team documents every agent follows (product facts, content rules,
 * compliance wording). Enabled documents are added to every design run, after DESIGN.md.
 */
export function KnowledgePage() {
  const { data: session } = useSession();
  const teamId = session?.activeOrganizationId ?? '';
  const knowledge = useKnowledge(teamId);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (!session || !teamId) return null;
  const canManage = hasPermission(session, 'design-systems:manage');
  const docs = knowledge.data ?? [];
  const current = creating ? null : (docs.find((d) => d.id === selected) ?? docs[0] ?? null);
  const enabledChars = docs.filter((d) => d.enabled).reduce((n, d) => n + d.body.length, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav aria-label="Knowledge documents" className="space-y-2">
        <p className="text-sm text-text-muted">
          Every agent follows the enabled documents on every run.
        </p>
        {knowledge.isError && <ErrorMessage>The knowledge base could not be loaded.</ErrorMessage>}
        <ul className="space-y-1">
          {docs.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                aria-current={d.id === current?.id ? 'true' : undefined}
                onClick={() => {
                  setCreating(false);
                  setSelected(d.id);
                }}
                className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent ${d.id === current?.id ? 'bg-surface-muted font-semibold' : 'hover:bg-surface-muted'}`}
              >
                <BookOpen size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate">{d.title}</span>
                  <span className="block text-xs font-normal text-text-muted">
                    {d.enabled ? 'On' : 'Off'} · {count.format(d.body.length)} characters
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {docs.length > 0 && (
          <p className="text-xs text-text-muted">
            Agents receive {count.format(Math.min(enabledChars, KNOWLEDGE_RUN_BUDGET))} of up to{' '}
            {count.format(KNOWLEDGE_RUN_BUDGET)} characters.
            {enabledChars > KNOWLEDGE_RUN_BUDGET &&
              ' The enabled documents are longer: the last ones are cut on every run.'}
          </p>
        )}
        {canManage && (
          <Button
            className="w-full justify-center"
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus size={14} aria-hidden="true" /> New document
          </Button>
        )}
      </nav>
      {creating ? (
        <DocumentEditor
          teamId={teamId}
          doc={null}
          canManage={canManage}
          onSaved={(id) => {
            setCreating(false);
            setSelected(id);
          }}
          onCancel={() => {
            setCreating(false);
          }}
        />
      ) : current ? (
        <DocumentEditor
          key={`${current.id}-${current.updatedAt}`}
          teamId={teamId}
          doc={current}
          canManage={canManage}
          onSaved={setSelected}
          onDeleted={() => {
            setSelected(null);
          }}
        />
      ) : (
        knowledge.isSuccess && (
          <EmptyState icon={<BookOpen size={32} />} title="No knowledge yet">
            {canManage
              ? 'Add product facts, content rules or compliance wording that every agent must follow.'
              : 'Team admins can add product facts, content rules or compliance wording that every agent must follow.'}
          </EmptyState>
        )
      )}
    </div>
  );
}

function DocumentEditor({
  teamId,
  doc,
  canManage,
  onSaved,
  onCancel,
  onDeleted,
}: {
  teamId: string;
  doc: KnowledgeDocument | null;
  canManage: boolean;
  onSaved: (id: string) => void;
  onCancel?: () => void;
  onDeleted?: () => void;
}) {
  const { create, update, remove } = useKnowledgeMutations(teamId);
  const [title, setTitle] = useState(doc?.title ?? '');
  const [body, setBody] = useState(doc?.body ?? '');
  const [enabled, setEnabled] = useState(doc?.enabled ?? true);
  const ids = { heading: useId(), title: useId(), body: useId(), enabled: useId(), hint: useId() };
  const dirty = !doc || title !== doc.title || body !== doc.body || enabled !== doc.enabled;
  const saving = create.isPending || update.isPending;
  const error = create.error ?? update.error ?? remove.error;

  return (
    <section aria-labelledby={ids.heading} className="space-y-4">
      <div>
        <h2 id={ids.heading} className="text-lg font-semibold">
          {doc ? doc.title : 'New document'}
        </h2>
        {doc && (
          <p className="text-xs text-text-muted">
            Updated {dateTime.format(new Date(doc.updatedAt))}
            {doc.updatedByName ? ` · ${doc.updatedByName}` : ''}
          </p>
        )}
        {!canManage && (
          <p className="text-sm text-text-muted">Only team admins can edit the knowledge base.</p>
        )}
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const values = { title: title.trim(), body, enabled };
          const done = {
            onSuccess: (saved: KnowledgeDocument) => {
              onSaved(saved.id);
            },
          };
          if (doc) update.mutate({ id: doc.id, ...values, expectedUpdatedAt: doc.updatedAt }, done);
          else create.mutate(values, done);
        }}
      >
        <div className="space-y-1">
          <label htmlFor={ids.title} className="text-sm font-medium">
            Title
          </label>
          <input
            id={ids.title}
            className={control}
            required
            maxLength={120}
            disabled={!canManage}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.body} className="text-sm font-medium">
            Content
          </label>
          <textarea
            id={ids.body}
            rows={20}
            maxLength={100_000}
            aria-describedby={ids.hint}
            disabled={!canManage}
            className={`${control} font-mono text-xs leading-relaxed`}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
          <p id={ids.hint} className="text-xs text-text-muted">
            Markdown, up to 100,000 characters ({count.format(body.length)} used). Agents see it
            under its title.
          </p>
        </div>
        <label htmlFor={ids.enabled} className="flex items-start gap-2 text-sm">
          <input
            id={ids.enabled}
            type="checkbox"
            checked={enabled}
            disabled={!canManage}
            onChange={(e) => {
              setEnabled(e.target.checked);
            }}
          />
          <span>
            Enabled
            <span className="block text-xs text-text-muted">
              Turned-off documents are kept but not given to the agents.
            </span>
          </span>
        </label>
        {error && <ErrorMessage>{errorText(error, 'Could not save.')}</ErrorMessage>}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={!dirty || saving || !title.trim()}>
              {doc ? 'Save' : 'Create document'}
            </Button>
            {!doc && onCancel && <Button onClick={onCancel}>Cancel</Button>}
            {doc && (
              <AlertDialog.Root>
                <AlertDialog.Trigger asChild>
                  <Button variant="danger" disabled={remove.isPending}>
                    <Trash2 size={14} aria-hidden="true" /> Delete
                  </Button>
                </AlertDialog.Trigger>
                <AlertDialog.Portal>
                  <AlertDialog.Overlay className="fixed inset-0 bg-black/40" />
                  <AlertDialog.Content className="fixed top-1/2 left-1/2 w-[min(26rem,calc(100vw-2rem))] -translate-1/2 space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
                    <AlertDialog.Title className="text-lg font-semibold">
                      Delete “{doc.title}”?
                    </AlertDialog.Title>
                    <AlertDialog.Description className="text-sm text-text-muted">
                      Agents will no longer follow it. This cannot be undone; turn it off instead to
                      keep it.
                    </AlertDialog.Description>
                    <div className="flex justify-end gap-2">
                      <AlertDialog.Cancel asChild>
                        <Button>Cancel</Button>
                      </AlertDialog.Cancel>
                      <AlertDialog.Action asChild>
                        <Button
                          variant="danger"
                          onClick={() => {
                            remove.mutate(doc.id, { onSuccess: () => onDeleted?.() });
                          }}
                        >
                          Delete
                        </Button>
                      </AlertDialog.Action>
                    </div>
                  </AlertDialog.Content>
                </AlertDialog.Portal>
              </AlertDialog.Root>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
