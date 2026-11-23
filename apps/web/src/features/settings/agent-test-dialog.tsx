import {
  type AgentDefinition,
  type AgentTest,
  agentTestResultSchema,
  type AgentTestResult,
} from '@core-studio/contracts';
import { useMutation } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useId, useState } from 'react';
import { Button, ErrorMessage } from '../../components/ui';
import { ApiError, apiSend } from '../../lib/api-client';
import { useDesignSystems } from '../studio/studio-api';

const control =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60';
const count = new Intl.NumberFormat();

/**
 * Output as the reader wants it: pretty JSON for the planning/review agents (the first JSON
 * object, as a run reads it), the component code for the UI designer. Raw text otherwise.
 */
export function formatAgentOutput(key: AgentDefinition['key'], output: string): string {
  if (key === 'ui') {
    const fenced = /```(?:tsx|jsx|typescript|ts)?\s*\n([\s\S]*?)```/.exec(output);
    return (fenced?.[1] ?? output).trim();
  }
  const match = /\{[\s\S]*\}/.exec(output);
  if (!match) return output.trim();
  try {
    return JSON.stringify(JSON.parse(match[0]), null, 2);
  } catch {
    return output.trim();
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * "Test this agent": runs only this agent once with the instructions in the editor (unsaved
 * edits included), the team key and model and a design system. Nothing is saved.
 */
export function AgentTestDialog({
  teamId,
  agent,
  instructions,
}: {
  teamId: string;
  agent: AgentDefinition;
  instructions: string;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [slug, setSlug] = useState('');
  const systems = useDesignSystems(teamId);
  const ids = { prompt: useId(), system: useId(), hint: useId(), output: useId() };
  const test = useMutation({
    mutationFn: (body: AgentTest) =>
      apiSend('POST', `/api/v1/studio/agents/${agent.key}/test`, {
        body,
        schema: agentTestResultSchema,
      }),
  });
  const result: AgentTestResult | undefined = test.data;
  const tooShort = instructions.trim().length < 20;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) test.reset();
      }}
    >
      <Dialog.Trigger asChild>
        <Button>
          <FlaskConical size={14} aria-hidden="true" /> Test
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 flex max-h-[calc(100vh-2rem)] w-[min(48rem,calc(100vw-2rem))] -translate-1/2 flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold">Test {agent.name}</Dialog.Title>
          <Dialog.Description className="text-sm text-text-muted">
            Runs only this agent once, with the instructions in the editor (unsaved changes
            included), the team&apos;s key and{' '}
            {agent.model ? `the model ${agent.model}` : 'default model'}, the design system and the
            team knowledge. Nothing is saved to any project.
          </Dialog.Description>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              // The dialog is rendered inside the agent editor's form: React bubbles a portal's
              // submit to it, which would save the agent.
              event.stopPropagation();
              test.mutate({
                instructions,
                prompt: prompt.trim(),
                ...(slug ? { designSystemSlug: slug } : {}),
              });
            }}
          >
            <div className="space-y-1">
              <label htmlFor={ids.prompt} className="text-sm font-medium">
                Sample request
              </label>
              <textarea
                id={ids.prompt}
                rows={agent.key === 'reviewer' ? 8 : 4}
                required
                maxLength={8000}
                aria-describedby={ids.hint}
                className={control}
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                }}
              />
              <p id={ids.hint} className="text-xs text-text-muted">
                {agent.key === 'reviewer'
                  ? 'Paste the screen code (TSX) to review, with any request around it.'
                  : 'What a designer would ask for, e.g. “A sign-in screen for members”.'}
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor={ids.system} className="text-sm font-medium">
                Design system
              </label>
              <select
                id={ids.system}
                className={control}
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                }}
              >
                <option value="">Default (CORE 2.0)</option>
                {(systems.data ?? []).map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            {tooShort && (
              <ErrorMessage>
                The instructions are too short to test. Write at least 20 characters.
              </ErrorMessage>
            )}
            {test.error && (
              <ErrorMessage>
                {test.error instanceof ApiError ? test.error.message : 'The test could not be run.'}
              </ErrorMessage>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button>Close</Button>
              </Dialog.Close>
              <Button
                type="submit"
                variant="primary"
                disabled={test.isPending || tooShort || prompt.trim().length < 3}
              >
                {test.isPending ? 'Running…' : 'Run test'}
              </Button>
            </div>
          </form>
          <section aria-live="polite" aria-busy={test.isPending} aria-label="Test result">
            {result && (
              <div className="space-y-2">
                <p className="text-sm">
                  <span className="font-medium">{result.model}</span>
                  <span className="text-text-muted">
                    {' '}
                    · {count.format(result.inputTokens)} input tokens ·{' '}
                    {count.format(result.outputTokens)} output tokens · {seconds(result.durationMs)}
                  </span>
                </p>
                <p className={`text-sm ${result.valid ? 'text-text-muted' : 'text-danger'}`}>
                  {result.valid
                    ? 'The output follows the format a design run needs.'
                    : 'A design run could not use this output: it does not follow the required format.'}
                </p>
                <h3 id={ids.output} className="text-sm font-semibold">
                  Output
                </h3>
                <pre
                  aria-labelledby={ids.output}
                  tabIndex={0}
                  className="max-h-96 overflow-auto rounded-md border border-border bg-surface-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <code>{formatAgentOutput(agent.key, result.output)}</code>
                </pre>
              </div>
            )}
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
