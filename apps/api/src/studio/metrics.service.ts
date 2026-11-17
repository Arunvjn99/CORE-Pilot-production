import { Inject, Injectable } from '@nestjs/common';
import type { Metrics } from '@core-studio/contracts';
import { sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import { LibraryService } from './library.service.js';

type Row = Record<string, unknown>;
const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Math.round(Number(v)));

/** Usage, quality and speed metrics from our own run records (works with or without LangSmith). */
@Injectable()
export class MetricsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly library: LibraryService,
  ) {}

  metrics(auth: AuthContext, days: number): Promise<Metrics> {
    return withDbContext(this.db, this.library.ctx(auth), async (tx) => {
      const since = sql`now() - make_interval(days => ${days})`;
      const rows = async (query: ReturnType<typeof sql>) => (await tx.execute(query)).rows as Row[];

      const [totals] = await rows(sql`
        select count(*) as runs,
               count(*) filter (where status = 'succeeded') as succeeded,
               count(*) filter (where status = 'failed') as failed,
               coalesce(sum(screens), 0) as screens,
               coalesce(sum(input_tokens), 0) as input_tokens,
               coalesce(sum(output_tokens), 0) as output_tokens,
               avg(review_score) as avg_review,
               avg(extract(epoch from (finished_at - started_at)) * 1000) filter (where finished_at is not null) as avg_ms
        from generation_runs where started_at >= ${since}`);
      const byAgent = await rows(sql`
        select agent_key, count(*) as calls, count(*) filter (where status = 'failed') as failures,
               coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens,
               avg(duration_ms) as avg_ms
        from run_steps where created_at >= ${since} group by agent_key order by agent_key`);
      const byModel = await rows(sql`
        select model, count(*) as calls, coalesce(sum(input_tokens + output_tokens), 0) as tokens
        from run_steps where created_at >= ${since} and model is not null and model <> ''
        group by model order by tokens desc limit 20`);
      const byDay = await rows(sql`
        select to_char(date_trunc('day', started_at), 'YYYY-MM-DD') as day, count(*) as runs,
               coalesce(sum(input_tokens + output_tokens), 0) as tokens,
               count(*) filter (where status = 'failed') as failed
        from generation_runs where started_at >= ${since} group by 1 order by 1`);
      const byProject = await rows(sql`
        select r.project_id, p.name, count(*) as runs, coalesce(sum(r.input_tokens + r.output_tokens), 0) as tokens,
               coalesce(sum(r.screens), 0) as screens
        from generation_runs r join projects p on p.id = r.project_id
        where r.started_at >= ${since} group by r.project_id, p.name order by tokens desc limit 20`);
      const errors = await rows(sql`
        select error_code, count(*) as count from generation_runs
        where started_at >= ${since} and error_code is not null group by error_code order by count desc limit 20`);

      return {
        days,
        totals: {
          runs: num(totals?.['runs']),
          succeeded: num(totals?.['succeeded']),
          failed: num(totals?.['failed']),
          screens: num(totals?.['screens']),
          inputTokens: num(totals?.['input_tokens']),
          outputTokens: num(totals?.['output_tokens']),
          avgReviewScore: numOrNull(totals?.['avg_review']),
          avgDurationMs: numOrNull(totals?.['avg_ms']),
        },
        byAgent: byAgent
          .filter((r) => ['orchestrator', 'ux', 'ui', 'reviewer'].includes(String(r['agent_key'])))
          .map((r) => ({
            agent: String(r['agent_key']) as Metrics['byAgent'][number]['agent'],
            calls: num(r['calls']),
            failures: num(r['failures']),
            inputTokens: num(r['input_tokens']),
            outputTokens: num(r['output_tokens']),
            avgDurationMs: numOrNull(r['avg_ms']),
          })),
        byModel: byModel.map((r) => ({
          model: String(r['model']),
          calls: num(r['calls']),
          tokens: num(r['tokens']),
        })),
        byDay: byDay.map((r) => ({
          day: String(r['day']),
          runs: num(r['runs']),
          tokens: num(r['tokens']),
          failed: num(r['failed']),
        })),
        byProject: byProject.map((r) => ({
          projectId: String(r['project_id']),
          name: String(r['name']),
          runs: num(r['runs']),
          tokens: num(r['tokens']),
          screens: num(r['screens']),
        })),
        errors: errors.map((r) => ({ code: String(r['error_code']), count: num(r['count']) })),
      };
    });
  }
}
