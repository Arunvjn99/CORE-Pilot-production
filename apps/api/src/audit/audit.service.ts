import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE } from '../db/database.module.js';
import type { Database } from '../db/database.js';
import { auditEvents, securityEvents } from '../db/schema.js';

const FORBIDDEN_KEYS = /secret|password|token|apikey|api_key|authorization|cookie/i;

/** Defence in depth: drop any metadata key that looks like a credential before persisting. */
export function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !FORBIDDEN_KEYS.test(key)));
}

export interface AuditEntry {
  organizationId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  correlationId: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Must be called inside the caller's transaction so the audit row commits atomically with the change. */
  async record(tx: Database, entry: AuditEntry): Promise<void> {
    await tx.insert(auditEvents).values({
      organizationId: entry.organizationId,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      correlationId: entry.correlationId,
      metadata: sanitizeMetadata(entry.metadata ?? {}),
    });
  }

  /** Team-independent security events (sign-in/out, failures). Failures to record are logged, never swallowed silently. */
  async security(event: {
    eventType: string;
    outcome: 'success' | 'failure';
    userId?: string | null;
    correlationId: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.db.insert(securityEvents).values({
        eventType: event.eventType,
        outcome: event.outcome,
        userId: event.userId ?? null,
        correlationId: event.correlationId,
        details: sanitizeMetadata(event.details ?? {}),
      });
    } catch (error) {
      this.logger.error(
        { err: error, eventType: event.eventType },
        'Failed to record security event',
      );
      throw error;
    }
  }
}
