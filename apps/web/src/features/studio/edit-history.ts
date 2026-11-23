import { type Screen, sourceEditResultSchema } from '@core-studio/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiSend } from '../../lib/api-client';
import { applySourceResult, studioKeys } from './studio-api';

/** One canvas edit: the screen's whole source before and after it. */
export interface SourceChange {
  pageId: string;
  path: string;
  before: string;
  after: string;
}

const LIMIT = 50;

/**
 * Undo/redo for canvas edits (V6). Undo writes the previous source back through
 * `PUT …/screens/:pageId/source` with the current revision, so it is itself a normal, audited edit.
 * If the screen changed in the meantime (an AI run or a teammate), undo refuses instead of
 * overwriting that work, and the history is cleared.
 */
export function useEditHistory(projectId: string, screens: Screen[], revision: number) {
  const client = useQueryClient();
  const [past, setPast] = useState<SourceChange[]>([]);
  const [future, setFuture] = useState<SourceChange[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const write = useMutation({
    mutationFn: ({ change, code }: { change: SourceChange; code: string }) =>
      apiSend('PUT', `/api/v1/projects/${projectId}/screens/${change.pageId}/source`, {
        body: { code, baseRevision: revision },
        schema: sourceEditResultSchema,
      }),
    onSuccess: (result, { change }) => {
      applySourceResult(client, projectId, change.path, result);
    },
    onSettled: () => client.invalidateQueries({ queryKey: studioKeys.screens(projectId) }),
  });

  const reset = (text: string) => {
    setPast([]);
    setFuture([]);
    setMessage(text);
  };

  const step = (direction: 'undo' | 'redo') => {
    const stack = direction === 'undo' ? past : future;
    const change = stack.at(-1);
    if (!change || write.isPending) return;
    const current = screens.find((s) => s.filePath === change.path)?.code;
    const expected = direction === 'undo' ? change.after : change.before;
    if (current !== expected) {
      reset(
        `The screen changed since that edit, so it can’t be ${direction === 'undo' ? 'undone' : 'redone'}.`,
      );
      return;
    }
    setMessage(null);
    write.mutate(
      { change, code: direction === 'undo' ? change.before : change.after },
      {
        onSuccess: () => {
          if (direction === 'undo') {
            setPast((p) => p.slice(0, -1));
            setFuture((f) => [...f, change]);
          } else {
            setFuture((f) => f.slice(0, -1));
            setPast((p) => [...p, change]);
          }
        },
        onError: (error) => {
          reset(
            error instanceof ApiError && error.code === 'STALE_REVISION'
              ? 'Someone else changed the file, so the history was cleared.'
              : 'The change could not be undone.',
          );
        },
      },
    );
  };

  return {
    record: (change: SourceChange) => {
      if (change.before === change.after) return;
      setPast((p) => [...p, change].slice(-LIMIT));
      setFuture([]);
      setMessage(null);
    },
    undo: () => {
      step('undo');
    },
    redo: () => {
      step('redo');
    },
    canUndo: past.length > 0 && !write.isPending,
    canRedo: future.length > 0 && !write.isPending,
    pending: write.isPending,
    message,
  };
}
