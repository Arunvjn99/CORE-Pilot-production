import { DefaultAzureCredential } from '@azure/identity';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CORRELATION_ID_HEADER, type LlmProvider, probeCodeSchema } from '@core-studio/contracts';
import { z } from 'zod';
import { OidcService } from '../auth/oidc.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';

/** Sealed envelope fields sent to the runtime. Base64; the API cannot decrypt them (ADR-0010). */
export interface SealedPayload {
  kind: 'team' | 'platform';
  credentialId: string;
  envelopeVersion: number;
  ciphertext: string;
  iv: string;
  authTag: string;
  wrappedDek: string;
  kekId: string;
  kekVersion: string;
  wrapAlgorithm: string;
}

export interface ProbeRequest {
  provider: LlmProvider;
  endpoint: string | null;
  apiVersion: string | null;
  deployment: string | null;
  sealed: SealedPayload | null;
}

const probeResponseSchema = z.object({
  code: probeCodeSchema,
  message: z.string().max(300),
  latencyMs: z.number().int().min(0),
  models: z.array(z.string().max(200)).max(500),
});
export type ProbeResponse = z.infer<typeof probeResponseSchema>;

export const RUNTIME_UNAVAILABLE: ProbeResponse = {
  code: 'runtime_unavailable',
  message: 'The AI runtime is unavailable; try again shortly',
  latencyMs: 0,
  models: [],
};

const agentTestResponseSchema = z.object({
  code: z.string().max(60),
  output: z.string().max(1_000_000),
  valid: z.boolean(),
  model: z.string().max(200),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  durationMs: z.number().int().min(0),
});
export type AgentTestResponse = z.infer<typeof agentTestResponseSchema>;

const agentTestFailure = (code: string): AgentTestResponse => ({
  code,
  output: '',
  valid: false,
  model: '',
  inputTokens: 0,
  outputTokens: 0,
  durationMs: 0,
});

/** Calls the AI runtime's internal gateway with a service token (ADR-0011). */
@Injectable()
export class RuntimeClient {
  private readonly logger = new Logger(RuntimeClient.name);
  private cached: { token: string; expiresAt: number } | null = null;
  private azureCredential: DefaultAzureCredential | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly oidc: OidcService,
  ) {}

  private async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt - 60_000 > Date.now()) return this.cached.token;
    const scope = this.config.AI_RUNTIME_TOKEN_SCOPE;
    if (this.config.AI_RUNTIME_AUTH_MODE === 'managed-identity') {
      this.azureCredential ??= new DefaultAzureCredential();
      const access = await this.azureCredential.getToken(scope);
      this.cached = { token: access.token, expiresAt: access.expiresOnTimestamp };
    } else {
      const { token, expiresInSeconds } = await this.oidc.clientCredentialsToken(scope);
      this.cached = { token, expiresAt: Date.now() + expiresInSeconds * 1000 };
    }
    return this.cached.token;
  }

  async probe(request: ProbeRequest, correlationId: string): Promise<ProbeResponse> {
    try {
      const response = await fetch(
        new URL('/internal/v1/providers/probe', this.config.AI_RUNTIME_URL),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await this.token()}`,
            'content-type': 'application/json',
            [CORRELATION_ID_HEADER]: correlationId,
          },
          body: JSON.stringify(request),
          redirect: 'error',
          signal: AbortSignal.timeout(25_000),
        },
      );
      if (response.status === 401) this.cached = null;
      if (!response.ok) {
        this.logger.warn({ status: response.status, correlationId }, 'AI runtime probe failed');
        return RUNTIME_UNAVAILABLE;
      }
      return probeResponseSchema.parse(await response.json());
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.name : 'unknown', correlationId },
        'AI runtime unreachable',
      );
      return RUNTIME_UNAVAILABLE;
    }
  }

  /** Runs one agent once ("Test this agent"). Network/HTTP failures come back as `runtime_unavailable`. */
  async agentTest(
    body: Record<string, unknown>,
    correlationId: string,
  ): Promise<AgentTestResponse> {
    try {
      const response = await fetch(new URL('/internal/v1/agent-test', this.config.AI_RUNTIME_URL), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.token()}`,
          'content-type': 'application/json',
          [CORRELATION_ID_HEADER]: correlationId,
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.DESIGN_RUN_TIMEOUT_SECONDS * 1000),
      });
      if (response.status === 401) this.cached = null;
      if (!response.ok) {
        this.logger.warn(
          { status: response.status, correlationId },
          'AI runtime agent test failed',
        );
        return agentTestFailure('runtime_unavailable');
      }
      return agentTestResponseSchema.parse(await response.json());
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.name : 'unknown', correlationId },
        'AI runtime unreachable',
      );
      return agentTestFailure('runtime_unavailable');
    }
  }

  /**
   * Starts a design run in the AI runtime and calls `onEvent` for each NDJSON event as it streams.
   * Resolves when the stream ends; network/HTTP failures are reported as an `error` event.
   */
  async streamDesignRun(
    body: Record<string, unknown>,
    correlationId: string,
    onEvent: (event: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(new URL('/internal/v1/design-runs', this.config.AI_RUNTIME_URL), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.token()}`,
          'content-type': 'application/json',
          [CORRELATION_ID_HEADER]: correlationId,
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.DESIGN_RUN_TIMEOUT_SECONDS * 1000),
      });
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.name : 'unknown', correlationId },
        'AI runtime unreachable',
      );
      await onEvent({ type: 'error', code: 'runtime_unavailable' });
      return;
    }
    if (response.status === 401) this.cached = null;
    if (!response.ok || !response.body) {
      await onEvent({ type: 'error', code: 'runtime_unavailable' });
      return;
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        if (buffer.length > 8 * 1024 * 1024) throw new Error('Event too large');
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) await onEvent(JSON.parse(line) as Record<string, unknown>);
        }
      }
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.name : 'unknown', correlationId },
        'Design run stream failed',
      );
      await onEvent({ type: 'error', code: 'runtime_stream_failed' });
    }
  }
}
