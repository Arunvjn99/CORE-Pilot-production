import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { REDIS } from '../redis/redis.tokens.js';
import type { PendingLogin, StoredSession } from './session.types.js';

const LOGIN_TTL_SECONDS = 600;
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;

export const newOpaqueToken = (): string => randomBytes(32).toString('base64url');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Server-side sessions in Redis. Keys hold hashes of session IDs, so a Redis dump does not yield
 * usable cookies. Idle timeout slides; absolute timeout is fixed at creation.
 */
@Injectable()
export class SessionStore {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get idleSeconds(): number {
    return this.config.SESSION_IDLE_TIMEOUT_MINUTES * 60;
  }

  private absoluteMs(): number {
    return this.config.SESSION_ABSOLUTE_TIMEOUT_HOURS * 3_600_000;
  }

  async create(
    data: Omit<StoredSession, 'createdAt' | 'csrfToken'>,
  ): Promise<{ id: string; session: StoredSession }> {
    const id = newOpaqueToken();
    const session: StoredSession = { ...data, csrfToken: newOpaqueToken(), createdAt: Date.now() };
    await this.redis
      .multi()
      .set(this.key(id), JSON.stringify(session), 'EX', this.idleSeconds)
      .sadd(this.userKey(data.userId), sha256(id))
      .expire(this.userKey(data.userId), Math.ceil(this.absoluteMs() / 1000))
      .exec();
    return { id, session };
  }

  /** Loads and slides the idle timeout; returns null when missing, malformed or past absolute lifetime. */
  async touch(id: string | undefined): Promise<StoredSession | null> {
    if (!id || !SESSION_ID.test(id)) return null;
    const raw = await this.redis.get(this.key(id));
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredSession;
    if (Date.now() - session.createdAt > this.absoluteMs()) {
      await this.destroy(id, session.userId);
      return null;
    }
    await this.redis.expire(this.key(id), this.idleSeconds);
    return session;
  }

  async update(id: string, session: StoredSession): Promise<void> {
    await this.redis.set(this.key(id), JSON.stringify(session), 'KEEPTTL');
  }

  async destroy(id: string, userId: string): Promise<void> {
    await this.redis.multi().del(this.key(id)).srem(this.userKey(userId), sha256(id)).exec();
  }

  /** Revokes every session of a user (e.g. removal from the company directory). */
  async destroyAllForUser(userId: string): Promise<void> {
    const hashes = await this.redis.smembers(this.userKey(userId));
    const pipeline = this.redis.multi();
    for (const hash of hashes) pipeline.del(`session:${hash}`);
    await pipeline.del(this.userKey(userId)).exec();
  }

  async savePendingLogin(state: string, pending: PendingLogin): Promise<void> {
    await this.redis.set(
      `login:${sha256(state)}`,
      JSON.stringify(pending),
      'EX',
      LOGIN_TTL_SECONDS,
    );
  }

  /** Single use: the pending login is deleted as it is read. */
  async takePendingLogin(state: string): Promise<PendingLogin | null> {
    const raw = await this.redis.getdel(`login:${sha256(state)}`);
    return raw ? (JSON.parse(raw) as PendingLogin) : null;
  }

  private key(id: string): string {
    return `session:${sha256(id)}`;
  }

  private userKey(userId: string): string {
    return `user-sessions:${userId}`;
  }
}
