import type { LlmProvider, ProbeCode } from '@core-studio/contracts';

export interface ProviderInfo {
  id: LlmProvider;
  name: string;
  summary: string;
  keyLabel: string;
  keyPlaceholder: string;
  needsEndpoint: boolean;
  endpointPlaceholder?: string;
  secretOptional: boolean;
  azureFields: boolean;
}

/** Mirrors the contract rules in credentialInputSchema; the API validates again. */
export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    summary: 'GPT models through the public OpenAI API.',
    keyLabel: 'API key',
    keyPlaceholder: 'sk-…',
    needsEndpoint: false,
    secretOptional: false,
    azureFields: false,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    summary: 'Claude models through the Anthropic API.',
    keyLabel: 'API key',
    keyPlaceholder: 'sk-ant-…',
    needsEndpoint: false,
    secretOptional: false,
    azureFields: false,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    summary: 'Gemini models through the Generative Language API.',
    keyLabel: 'API key',
    keyPlaceholder: 'AIza…',
    needsEndpoint: false,
    secretOptional: false,
    azureFields: false,
  },
  {
    id: 'azure_openai',
    name: 'Azure OpenAI',
    summary: 'Your organisation’s Azure OpenAI resource and deployment.',
    keyLabel: 'API key',
    keyPlaceholder: 'Resource key',
    needsEndpoint: true,
    endpointPlaceholder: 'https://<resource>.openai.azure.com',
    secretOptional: false,
    azureFields: true,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    summary: 'Self-hosted open models. A key is only needed behind an authenticating proxy.',
    keyLabel: 'API key (optional)',
    keyPlaceholder: 'Leave empty if not required',
    needsEndpoint: true,
    endpointPlaceholder: 'https://ollama.example.com',
    secretOptional: true,
    azureFields: false,
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));
export function providerInfo(id: LlmProvider): ProviderInfo {
  const info = BY_ID.get(id);
  if (!info) throw new Error(`Unknown provider ${id}`);
  return info;
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

export const PROBE_STATUS: Record<ProbeCode, { label: string; tone: Tone }> = {
  ok: { label: 'Connected', tone: 'success' },
  unauthorized: { label: 'Key rejected', tone: 'danger' },
  not_found: { label: 'Endpoint not found', tone: 'danger' },
  rate_limited: { label: 'Rate limited', tone: 'warning' },
  provider_error: { label: 'Provider error', tone: 'warning' },
  unreachable: { label: 'Unreachable', tone: 'danger' },
  timeout: { label: 'Timed out', tone: 'warning' },
  endpoint_blocked: { label: 'Endpoint blocked', tone: 'danger' },
  credential_unavailable: { label: 'Key unavailable', tone: 'danger' },
  invalid_response: { label: 'Unexpected response', tone: 'warning' },
  runtime_unavailable: { label: 'Service unavailable', tone: 'warning' },
};

export function probeStatus(code: string | null): { label: string; tone: Tone } {
  if (!code) return { label: 'Not tested', tone: 'neutral' };
  return code in PROBE_STATUS
    ? PROBE_STATUS[code as ProbeCode]
    : { label: 'Unknown', tone: 'neutral' };
}

/** Never shows the key: only the last characters the API chose to keep (if any). */
export function maskedKey(hasSecret: boolean, displayHint: string | null): string {
  if (!hasSecret) return 'No key';
  return displayHint ? `•••• ${displayHint.replace('…', '')}` : '•••• (hidden)';
}

export const ACTIVITY_LABELS: Record<string, string> = {
  'llm_credential.created': 'added a credential',
  'llm_credential.rotated': 'rotated a key',
  'llm_credential.revoked': 'revoked a credential',
  'llm_credential.tested': 'tested a connection',
  'llm_policy.updated': 'changed the personal-key policy',
  'llm_default_model.updated': 'set the default model',
  'llm_default_model.cleared': 'cleared the default model',
};
