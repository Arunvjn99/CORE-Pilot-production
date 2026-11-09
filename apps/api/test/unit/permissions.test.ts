import { describe, expect, it } from 'vitest';
import { returnToSchema } from '../../src/auth/auth.controller.js';
import { canAssignRole, resolvePermissions } from '../../src/auth/permissions.js';
import { sanitizeMetadata } from '../../src/audit/audit.service.js';

describe('permissions', () => {
  it('builds cumulative role permissions', () => {
    expect(resolvePermissions('viewer', false).has('projects:write')).toBe(false);
    expect(resolvePermissions('designer', false).has('canvas:edit')).toBe(true);
    expect(resolvePermissions('org_admin', false).has('members:manage')).toBe(true);
    expect(resolvePermissions('org_admin', false).has('org:manage')).toBe(false);
    expect(resolvePermissions('org_owner', false).has('org:manage')).toBe(true);
    expect(resolvePermissions(null, false).size).toBe(0);
  });

  it('gives company admins company-wide permissions only', () => {
    const p = resolvePermissions(null, true);
    expect(p.has('orgs:create')).toBe(true);
    expect(p.has('canvas:edit')).toBe(false);
  });

  it('restricts owner-role assignment to owners and company admins', () => {
    expect(canAssignRole('org_admin', false, 'org_owner')).toBe(false);
    expect(canAssignRole('org_admin', false, 'designer')).toBe(true);
    expect(canAssignRole('org_owner', false, 'org_owner')).toBe(true);
    expect(canAssignRole('designer', false, 'viewer')).toBe(false);
    expect(canAssignRole(null, true, 'org_owner')).toBe(true);
  });
});

describe('returnTo', () => {
  it.each([
    ['/projects/1', '/projects/1'],
    ['//evil.test', '/'],
    ['/\\evil.test', '/'],
    ['https://evil.test', '/'],
    ['/ok path', '/'],
  ])('%s → %s', (input, expected) => {
    expect(returnToSchema.parse(input)).toBe(expected);
  });
});

describe('audit metadata', () => {
  it('drops credential-like keys', () => {
    expect(
      sanitizeMetadata({
        name: 'x',
        apiKey: 'k',
        client_secret: 's',
        Authorization: 'a',
        role: 'viewer',
      }),
    ).toEqual({ name: 'x', role: 'viewer' });
  });
});
