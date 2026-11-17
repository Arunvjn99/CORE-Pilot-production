import type { Checkpoint } from '@core-studio/contracts';
import { Download, History, RotateCcw } from 'lucide-react';
import { AlertDialog } from 'radix-ui';
import { useState } from 'react';
import { Button, EmptyState, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { exportUrl, useCheckpointMutations, useCheckpoints } from './studio-api';

const KIND_LABEL: Record<Checkpoint['kind'], string> = {
  create: 'Created',
  manual: 'Saved',
  restore: 'Restored',
  safety: 'Automatic',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Left panel tab: the project's checkpoints, newest first, with restore and download. */
export function HistoryPanel({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const checkpoints = useCheckpoints(projectId);
  const { restore } = useCheckpointMutations(projectId);
  const [confirming, setConfirming] = useState<Checkpoint | null>(null);

  if (checkpoints.isError) return <ErrorMessage>History could not be loaded.</ErrorMessage>;
  if (!checkpoints.data) return <p role="status">Loading history…</p>;
  if (checkpoints.data.length === 0)
    return (
      <EmptyState icon={<History size={28} />} title="No checkpoints yet">
        Save a checkpoint from the toolbar; design runs save one automatically.
      </EmptyState>
    );

  return (
    <section aria-label="History" className="space-y-2">
      <a
        href={exportUrl(projectId)}
        download
        className="flex items-center justify-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Download size={14} aria-hidden="true" /> Export current work (React project)
      </a>
      <ol className="space-y-1">
        {checkpoints.data.map((c, index) => (
          <li
            key={c.id}
            aria-label={c.message}
            className="space-y-1 rounded-md border border-border p-2 text-sm"
          >
            <p className="font-medium break-words">{c.message}</p>
            <p className="text-xs text-text-muted">
              {KIND_LABEL[c.kind]} · {when(c.createdAt)}
              {c.authorName ? ` · ${c.authorName}` : ''}
              {index === 0 ? ' · latest' : ''}
            </p>
            <div className="flex gap-1">
              <a
                href={exportUrl(projectId, c.id)}
                download
                aria-label={`Download “${c.message}”`}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Download size={12} aria-hidden="true" /> Download
              </a>
              {canWrite && (
                <button
                  type="button"
                  aria-label={`Restore “${c.message}”`}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => {
                    restore.reset();
                    setConfirming(c);
                  }}
                >
                  <RotateCcw size={12} aria-hidden="true" /> Restore
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>

      <AlertDialog.Root
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-1/2 space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
            <AlertDialog.Title className="text-lg font-semibold">
              Restore “{confirming?.message}”?
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-text-muted">
              Every screen, page and the design system go back to this checkpoint. Unsaved work is
              kept as an automatic checkpoint first, so you can return to it.
            </AlertDialog.Description>
            {restore.error ? (
              <ErrorMessage>
                {restore.error instanceof ApiError
                  ? restore.error.message
                  : 'The checkpoint could not be restored.'}
              </ErrorMessage>
            ) : null}
            <div className="flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button>Cancel</Button>
              </AlertDialog.Cancel>
              <Button
                variant="primary"
                disabled={restore.isPending}
                onClick={() => {
                  if (!confirming) return;
                  restore.mutate(confirming.id, {
                    onSuccess: () => {
                      setConfirming(null);
                    },
                  });
                }}
              >
                {restore.isPending ? 'Restoring…' : 'Restore'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
