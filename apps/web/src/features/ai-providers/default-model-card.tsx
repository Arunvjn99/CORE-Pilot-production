import type { CredentialSummary, DefaultModel } from '@core-studio/contracts';
import { Sparkles } from 'lucide-react';
import { useId, useState } from 'react';
import { Button, ErrorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import type { LlmMutations } from './ai-providers-api';
import { probeStatus, providerInfo } from './providers';

const selectClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60';

/**
 * The team default model. Model choices come from a live connection test of the chosen
 * credential (through the AI runtime), so only models the key can actually reach are offered.
 */
export function DefaultModelCard({
  current,
  candidates,
  canManage,
  mutations,
}: {
  current: DefaultModel | undefined;
  candidates: CredentialSummary[];
  canManage: boolean;
  mutations: LlmMutations;
}) {
  const credentialId = useId();
  const modelId = useId();
  const [selected, setSelected] = useState<string>('');
  const [models, setModels] = useState<string[] | null>(null);
  const [model, setModel] = useState('');
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadModels = () => {
    const credential = candidates.find((c) => c.id === selected);
    if (!credential) return;
    setLoading(true);
    setLoadMessage(null);
    mutations.test.mutate(
      { id: credential.id, platform: false },
      {
        onSuccess: (result) => {
          if (result.code === 'ok') {
            setModels(result.models);
            setModel(
              current?.credentialId === credential.id && result.models.includes(current.model)
                ? current.model
                : (result.models[0] ?? ''),
            );
            if (result.models.length === 0) setLoadMessage('The provider returned no models.');
          } else {
            setModels(null);
            setLoadMessage(`${probeStatus(result.code).label}: ${result.message}`);
          }
        },
        onError: (error) => {
          setLoadMessage(error instanceof ApiError ? error.message : 'Models could not be loaded.');
        },
        onSettled: () => {
          setLoading(false);
        },
      },
    );
  };

  const saveError = mutations.setDefault.error ?? mutations.clearDefault.error;

  return (
    <section
      aria-labelledby="default-model-heading"
      className="space-y-4 rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        <Sparkles size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
        <div className="space-y-1">
          <h2 id="default-model-heading" className="font-semibold">
            Default model
          </h2>
          <p className="text-sm text-text-muted">
            Used by AI features in this team unless a project chooses another model.
          </p>
        </div>
      </div>
      <div aria-live="polite" className="rounded-lg bg-surface-muted p-3 text-sm">
        {current ? (
          <>
            <span className="font-mono font-medium">{current.model}</span>
            <span className="text-text-muted">
              {' '}
              via {current.credentialLabel} ({providerInfo(current.provider).name}
              {current.credentialScope === 'platform' ? ', company-managed' : ''})
            </span>
          </>
        ) : (
          <span className="text-text-muted">No default model is set.</span>
        )}
      </div>
      {canManage && (
        <div className="space-y-3">
          {candidates.length === 0 ? (
            <p className="text-sm text-text-muted">
              Add a team credential, or ask a company admin for access to a company-managed one, to
              choose a default model. Personal credentials can’t be a team default.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-1">
                  <label htmlFor={credentialId} className="text-sm font-medium">
                    Credential
                  </label>
                  <select
                    id={credentialId}
                    className={selectClass}
                    value={selected}
                    onChange={(event) => {
                      setSelected(event.target.value);
                      setModels(null);
                      setModel('');
                      setLoadMessage(null);
                    }}
                  >
                    <option value="">Choose a credential…</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} — {providerInfo(c.provider).name}
                        {c.scope === 'platform' ? ' (company)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <Button onClick={loadModels} disabled={!selected || loading}>
                  {loading ? 'Loading…' : 'Load models'}
                </Button>
              </div>
              {loadMessage && (
                <p role="status" className="text-sm text-text-muted">
                  {loadMessage}
                </p>
              )}
              {models && models.length > 0 && (
                <form
                  className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
                  onSubmit={(event) => {
                    event.preventDefault();
                    mutations.setDefault.mutate({ credentialId: selected, model });
                  }}
                >
                  <div className="space-y-1">
                    <label htmlFor={modelId} className="text-sm font-medium">
                      Model
                    </label>
                    <select
                      id={modelId}
                      className={selectClass}
                      value={model}
                      onChange={(event) => {
                        setModel(event.target.value);
                      }}
                    >
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!model || mutations.setDefault.isPending}
                  >
                    Set as default
                  </Button>
                </form>
              )}
            </>
          )}
          {current && (
            <Button
              variant="danger"
              disabled={mutations.clearDefault.isPending}
              onClick={() => {
                mutations.clearDefault.mutate();
              }}
            >
              Clear default
            </Button>
          )}
          {saveError && (
            <ErrorMessage>
              {saveError instanceof ApiError
                ? saveError.message
                : 'The default could not be saved.'}
            </ErrorMessage>
          )}
        </div>
      )}
    </section>
  );
}
