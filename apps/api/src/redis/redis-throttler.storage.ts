import { Inject, Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { REDIS } from './redis.tokens.js';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

// Atomic fixed-window counter with block support. Returns [hits, ttlMs, blockedTtlMs].
const SCRIPT = `
local hits_key = KEYS[1]
local block_key = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local block = tonumber(ARGV[3])
local blocked = redis.call('PTTL', block_key)
if blocked > 0 then return {limit + 1, redis.call('PTTL', hits_key), blocked} end
local hits = redis.call('INCR', hits_key)
if hits == 1 then redis.call('PEXPIRE', hits_key, ttl) end
local remaining = redis.call('PTTL', hits_key)
if hits > limit then
  redis.call('SET', block_key, '1', 'PX', block)
  return {hits, remaining, block}
end
return {hits, remaining, 0}
`;

/** Shared rate-limit state so limits hold across API replicas (in-memory storage would not). */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const prefix = `throttle:${throttlerName}:${key}`;
    const [hits, ttlMs, blockMs] = (await this.redis.eval(
      SCRIPT,
      2,
      `${prefix}:hits`,
      `${prefix}:block`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number];
    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
      isBlocked: blockMs > 0,
      timeToBlockExpire: Math.max(0, Math.ceil(blockMs / 1000)),
    };
  }
}
