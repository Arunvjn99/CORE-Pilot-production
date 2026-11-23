import { ConflictException, HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { AgentKey, AgentTest, AgentTestResult } from '@core-studio/contracts';
import { DEFAULT_DESIGN_SYSTEM } from '@core-studio/studio-library';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { LlmSettingsService } from '../credentials/llm-settings.service.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import { RuntimeClient } from '../gateway/runtime-client.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { designContext } from './design-context.js';
import { LibraryService } from './library.service.js';

/** Runtime/provider failure codes and the fixed message shown for each (upstream text never is). */
const FAILURES: Record<string, string> = {
  unauthorized: 'The AI provider rejected the team key. Check it in Settings → AI providers.',
  rate_limited: 'The AI provider is rate limiting requests. Try again in a minute.',
  not_found: 'The AI provider does not know this model. Check the model name.',
  timeout: 'The AI provider did not answer in time.',
  unreachable: 'The AI provider could not be reached.',
  endpoint_blocked: 'The AI provider endpoint is not allowed.',
  endpoint_missing: 'The AI provider endpoint is not configured.',
  credential_unavailable:
    'The team key could not be used. Save it again in Settings → AI providers.',
  invalid_response: 'The AI provider returned an unreadable response.',
  provider_error: 'The AI provider returned an error.',
  runtime_unavailable: 'The AI runtime is unavailable. Try again shortly.',
  internal_error: 'The test could not be run.',
};

/**
 * "Test this agent" (Settings → Agents): runs one agent once with the AGENT.md text from the
 * editor (unsaved edits allowed), the team's key and model, a design system's DESIGN.md and the
 * team knowledge, exactly as a design run would build its prompt. Nothing is saved to any project.
 */
@Injectable()
export class AgentTestService {
  private readonly logger = new Logger(AgentTestService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly runtime: RuntimeClient,
    private readonly llm: LlmSettingsService,
    private readonly library: LibraryService,
    private readonly knowledge: KnowledgeService,
    private readonly audit: AuditService,
  ) {}

  async run(
    auth: AuthContext,
    key: AgentKey,
    input: AgentTest,
    correlationId: string,
  ): Promise<AgentTestResult> {
    const ctx = this.library.ctx(auth);
    const body = await withDbContext(this.db, ctx, async (tx) => {
      const target = await this.llm.defaultTarget(tx, ctx.organizationId);
      if (!target)
        throw new ConflictException({
          code: 'NO_DEFAULT_MODEL',
          message:
            'Choose the default model and key in Settings → AI providers before testing agents.',
        });
      const agent = (await this.library.resolveAgents(tx)).find((a) => a.key === key);
      const system = await this.library.resolveSystem(
        tx,
        input.designSystemSlug ?? DEFAULT_DESIGN_SYSTEM,
      );
      const knowledge = await this.knowledge.forAgents(tx);
      const model = agent?.model ?? target.model;
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorId: auth.userId,
        action: 'agent.tested',
        targetType: 'agent',
        targetId: key,
        correlationId,
        metadata: {
          provider: target.provider,
          model,
          designSystem: system.slug,
          knowledgeDocuments: knowledge.used.length,
        },
      });
      return {
        provider: target.provider,
        endpoint: target.endpoint,
        apiVersion: target.apiVersion,
        deployment: target.deployment,
        sealed: target.sealed,
        agent: key,
        instructions: input.instructions,
        model,
        prompt: input.prompt,
        designMd: designContext(system.designMd, system.tokensCss, knowledge.markdown),
      };
    });
    // The provider call runs outside the transaction (it can take minutes).
    const result = await this.runtime.agentTest(body, correlationId);
    if (result.code !== 'ok') {
      const code = result.code in FAILURES ? result.code : 'provider_error';
      this.logger.warn({ code: result.code, agent: key, correlationId }, 'Agent test failed');
      // 424: the request was fine, the AI provider (a dependency) failed. A 4xx keeps the fixed code.
      throw new HttpException(
        { code: `AGENT_TEST_${code.toUpperCase()}`, message: FAILURES[code] },
        424,
      );
    }
    return {
      output: result.output,
      valid: result.valid,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
    };
  }
}
