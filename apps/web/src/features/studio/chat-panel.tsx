import type { Run, RunEvent } from '@core-studio/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, CheckCircle2, Circle, CircleAlert, Loader2, Send, Sparkles } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Button, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { studioKeys, useRunEvents, useRuns, useStartRun } from './studio-api';

const AGENT_NAMES: Record<string, string> = {
  orchestrator: 'Orchestrator',
  ux: 'UX designer',
  ui: 'UI designer',
  reviewer: 'Reviewer',
};

const ERRORS: Record<string, string> = {
  unauthorized: 'The provider rejected the API key. Check Settings → AI providers.',
  rate_limited: 'The provider is rate limiting the key. Try again shortly.',
  timeout: 'The model took too long to respond.',
  unreachable: 'The model provider could not be reached.',
  invalid_output:
    'The model returned output in an unexpected format. Try again or adjust the agent instructions.',
  invalid_screens: 'The generated screens were not valid code and were not saved.',
  runtime_unavailable: 'The AI runtime is unavailable.',
  credential_unavailable: 'The stored key could not be decrypted.',
  no_screens: 'No screens were produced.',
  truncated: 'The model ran out of output tokens before finishing. Try a smaller request.',
  refused: 'The model declined this request. Rephrase it and try again.',
  not_found: 'The provider does not know this model. Pick another default model.',
  provider_error: 'The provider returned an error. Check the default model and try again.',
};

export const errorText = (code: string | null) =>
  code ? (ERRORS[code] ?? `The run failed (${code}).`) : null;

function Timeline({ events }: { events: RunEvent[] }) {
  const rows: {
    key: string;
    icon: 'run' | 'ok' | 'fail';
    text: string;
    detail?: string;
    todos?: string[];
  }[] = [];
  const succeeded = events.some((e) => e.type === 'done' && e.status === 'succeeded');
  const finished = new Set<string>();
  for (const e of events) {
    if (e.type === 'step_finished' || e.type === 'step_failed')
      finished.add(`${e.agent}:${e.label}`);
  }
  events.forEach((e, i) => {
    if (e.type === 'step_started' && !finished.has(`${e.agent}:${e.label}`))
      rows.push({
        key: String(i),
        icon: 'run',
        text: `${AGENT_NAMES[e.agent] ?? e.agent}: ${e.label}`,
      });
    if (e.type === 'step_finished')
      rows.push({
        key: String(i),
        icon: 'ok',
        text: `${AGENT_NAMES[e.agent] ?? e.agent}: ${e.label}`,
        detail: `${(e.inputTokens + e.outputTokens).toLocaleString()} tokens · ${(e.durationMs / 1000).toFixed(1)} s`,
      });
    if (e.type === 'step_failed')
      rows.push({
        key: String(i),
        icon: 'fail',
        text: `${AGENT_NAMES[e.agent] ?? e.agent}: ${e.label}`,
        detail: e.code,
      });
    if (e.type === 'plan')
      rows.push({
        key: String(i),
        icon: 'ok',
        text: `Plan: ${e.title}`,
        detail: e.screens.map((s) => s.name).join(' · '),
        todos: e.todos,
      });
    if (e.type === 'review')
      rows.push({
        key: String(i),
        icon: e.screens.every((s) => s.pass) ? 'ok' : 'fail',
        text: e.round === 0 ? 'Review' : `Review after fixes (round ${String(e.round)})`,
        detail: e.screens.map((s) => `${s.route} ${String(s.score)}`).join(' · '),
      });
    if (e.type === 'saved')
      rows.push({ key: String(i), icon: 'ok', text: 'Saved to the project and checkpointed' });
  });
  return (
    <ol aria-live="polite" className="space-y-2">
      {rows.map((row) => (
        <li key={row.key} className="flex gap-2 text-sm">
          {row.icon === 'run' && (
            <Loader2
              size={16}
              aria-hidden="true"
              className="mt-0.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"
            />
          )}
          {row.icon === 'ok' && (
            <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
          )}
          {row.icon === 'fail' && (
            <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
          )}
          <span className="min-w-0">
            <span className="block">{row.text}</span>
            {row.detail && (
              <span className="block truncate text-xs text-text-muted">{row.detail}</span>
            )}
            {row.todos && row.todos.length > 0 && (
              <ul aria-label="Plan to-dos" className="mt-1 space-y-0.5">
                {row.todos.map((todo, n) => (
                  <li key={n} className="flex items-start gap-1.5 text-xs text-text-muted">
                    {succeeded ? (
                      <CheckCircle2
                        size={12}
                        aria-label="Done"
                        className="mt-0.5 shrink-0 text-success"
                      />
                    ) : (
                      <Circle size={12} aria-label="To do" className="mt-0.5 shrink-0" />
                    )}
                    <span>{todo}</span>
                  </li>
                ))}
              </ul>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function RunHistory({ runs }: { runs: Run[] }) {
  if (runs.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-text-muted">Previous runs ({runs.length})</summary>
      <ul className="mt-2 space-y-2">
        {runs.map((run) => (
          <li key={run.id} className="rounded-md border border-border p-2">
            <p className="line-clamp-2">{run.prompt}</p>
            <p className="text-xs text-text-muted">
              {run.status === 'succeeded'
                ? `${String(run.screens)} screens · ${(run.inputTokens + run.outputTokens).toLocaleString()} tokens${run.reviewScore !== null ? ` · score ${String(run.reviewScore)}` : ''}`
                : run.status === 'running'
                  ? 'Running…'
                  : (errorText(run.errorCode) ?? 'Failed')}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Left panel: prompt the agent team and follow the run live. */
export function ChatPanel({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const [prompt, setPrompt] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const start = useStartRun(projectId);
  const runs = useRuns(projectId);
  const client = useQueryClient();
  const inputId = useId();
  const { events, finished, lost } = useRunEvents(projectId, runId, () => {
    void client.invalidateQueries({ queryKey: studioKeys.screens(projectId) });
    void client.invalidateQueries({ queryKey: studioKeys.runs(projectId) });
    void client.invalidateQueries({ queryKey: ['projects'] });
  });
  const done = events.find((e) => e.type === 'done');
  const running = runId !== null && !finished && !lost;
  const startError = start.error instanceof ApiError ? start.error : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {!runId && (
          <div className="space-y-2 rounded-lg bg-surface-muted p-3 text-sm text-text-muted">
            <p className="flex items-center gap-2 font-medium text-text">
              <Sparkles size={16} aria-hidden="true" className="text-accent" /> Describe what to
              design
            </p>
            <p>
              The orchestrator plans the screens, the UX and UI designers build them in your design
              system, and the reviewer checks them before they are saved.
            </p>
          </div>
        )}
        {runId && (
          <section aria-label="Current run" className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Bot size={16} aria-hidden="true" /> Agent team
            </p>
            <Timeline events={events} />
            {done?.type === 'done' && done.status === 'failed' && (
              <ErrorMessage>{errorText(done.errorCode) ?? 'The run failed.'}</ErrorMessage>
            )}
            {lost && (
              <ErrorMessage>
                Lost the connection to this run. Its result will appear under previous runs.
              </ErrorMessage>
            )}
          </section>
        )}
        <RunHistory runs={(runs.data ?? []).filter((r) => r.id !== runId)} />
      </div>
      {canWrite && (
        <form
          className="space-y-2 border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (prompt.trim().length < 3) return;
            start.mutate(prompt.trim(), {
              onSuccess: ({ id }) => {
                setRunId(id);
                setPrompt('');
              },
            });
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            Design request
          </label>
          <textarea
            id={inputId}
            rows={3}
            maxLength={8000}
            disabled={running}
            placeholder="e.g. A loan request flow: eligibility, amount and term, review and submit"
            className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
                event.currentTarget.form?.requestSubmit();
            }}
          />
          {startError && (
            <ErrorMessage>
              {startError.message}{' '}
              {startError.code === 'NO_DEFAULT_MODEL' && (
                <Link to="/settings/ai-providers" className="underline">
                  Open AI providers
                </Link>
              )}
            </ErrorMessage>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full justify-center"
            disabled={running || start.isPending}
          >
            {running ? (
              <Loader2 size={16} aria-hidden="true" className="animate-spin" />
            ) : (
              <Send size={16} aria-hidden="true" />
            )}
            {running ? 'Agents are working…' : 'Generate'}
          </Button>
        </form>
      )}
    </div>
  );
}
