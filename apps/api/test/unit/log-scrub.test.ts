import { describe, expect, it } from 'vitest';
import { scrubRequest, scrubUrl } from '../../src/common/log-scrub.js';

describe('log scrubbing', () => {
  it('redacts OAuth callback values from urls and queries', () => {
    const url = '/api/v1/auth/callback?code=abc123&state=xyz&iss=https%3A%2F%2Fidp';
    expect(scrubUrl(url)).toBe(
      '/api/v1/auth/callback?code=%5BREDACTED%5D&state=%5BREDACTED%5D&iss=https%3A%2F%2Fidp',
    );
    expect(scrubRequest({ url, query: { code: 'abc123', returnTo: '/x' } })).toMatchObject({
      query: { code: '[REDACTED]', returnTo: '/x' },
    });
    expect(scrubUrl('/api/v1/projects')).toBe('/api/v1/projects');
  });
});
