import { describe, expect, it } from 'vitest';
import { correlationIdSchema, errorResponseSchema, paginationQuerySchema } from './http.js';

describe('contracts/http', () => {
  it('rejects unsafe correlation IDs', () => {
    expect(correlationIdSchema.safeParse('abc\nlog-injection').success).toBe(false);
    expect(correlationIdSchema.safeParse('3f2b9c1e-1a2b-4c3d-8e9f-001122334455').success).toBe(
      true,
    );
  });
  it('bounds pagination', () => {
    expect(paginationQuerySchema.parse({}).limit).toBe(25);
    expect(paginationQuerySchema.safeParse({ limit: 1000 }).success).toBe(false);
  });
  it('validates the error envelope', () => {
    expect(
      errorResponseSchema.safeParse({ error: { code: 'X', message: 'm', correlationId: 'c' } })
        .success,
    ).toBe(true);
  });
});
