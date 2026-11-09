import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { resolveCorrelationId } from '../../src/common/correlation-id.js';

const req = (value?: string) =>
  ({ headers: value === undefined ? {} : { 'x-correlation-id': value } }) as IncomingMessage;

describe('resolveCorrelationId', () => {
  it('keeps a well-formed inbound id', () => {
    expect(resolveCorrelationId(req('abcd-1234-efgh'))).toBe('abcd-1234-efgh');
  });
  it('replaces malformed or missing ids', () => {
    expect(resolveCorrelationId(req('bad\r\ninjected'))).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveCorrelationId(req())).toMatch(/^[0-9a-f-]{36}$/);
  });
});
