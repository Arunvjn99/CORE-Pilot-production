import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  AI_RUNTIME_URL: 'http://localhost:8000',
  PUBLIC_APP_ORIGIN: 'http://localhost:8080',
  OIDC_ISSUER_URL: 'http://localhost:8180/default',
  OIDC_CLIENT_ID: 'client',
  OIDC_CLIENT_SECRET: 'a-sufficiently-long-secret',
  OIDC_ALLOWED_TENANT_ID: '7d0c3a2e-0f4e-4b8a-9a35-1f6a2b3c4d5e',
  LOCAL_KEK: Buffer.alloc(32, 1).toString('base64'),
};

describe('loadConfig', () => {
  it('accepts a valid development environment', () => {
    const config = loadConfig(base);
    expect(config.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:5173']);
    expect(config.API_DOCS_ENABLED).toBe(false);
  });

  it('fails fast listing every missing variable', () => {
    expect(() => loadConfig({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  it('rejects wildcard CORS', () => {
    expect(() => loadConfig({ ...base, CORS_ALLOWED_ORIGINS: '*' })).toThrow(
      /CORS_ALLOWED_ORIGINS/,
    );
  });

  it('enforces TLS and disabled docs in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', API_DOCS_ENABLED: 'true' })).toThrow(
      /sslmode[\s\S]*rediss[\s\S]*https[\s\S]*docs/,
    );
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@db:5432/x?sslmode=verify-full',
        REDIS_URL: 'rediss://cache:6380',
        CORS_ALLOWED_ORIGINS: 'https://studio.example.com',
        PUBLIC_APP_ORIGIN: 'https://studio.example.com',
        OIDC_ISSUER_URL:
          'https://login.microsoftonline.com/7d0c3a2e-0f4e-4b8a-9a35-1f6a2b3c4d5e/v2.0',
        LOCAL_KEK: undefined,
        CREDENTIAL_KEK_PROVIDER: 'azure-key-vault',
        AZURE_KEY_VAULT_KEY_ID: 'https://vault.vault.azure.net/keys/llm-kek',
        AI_RUNTIME_URL: 'https://ai-runtime.internal.example.com',
        AI_RUNTIME_AUTH_MODE: 'managed-identity',
      }),
    ).not.toThrow();
  });

  it('refuses the local KEK in production and requires a valid KEK locally', () => {
    expect(() => loadConfig({ ...base, LOCAL_KEK: 'too-short' })).toThrow(/LOCAL_KEK/);
    expect(() => loadConfig({ ...base, LOCAL_KEK: undefined })).toThrow(/LOCAL_KEK/);
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@db:5432/x?sslmode=verify-full',
        REDIS_URL: 'rediss://cache:6380',
        CORS_ALLOWED_ORIGINS: 'https://studio.example.com',
        PUBLIC_APP_ORIGIN: 'https://studio.example.com',
        OIDC_ISSUER_URL:
          'https://login.microsoftonline.com/7d0c3a2e-0f4e-4b8a-9a35-1f6a2b3c4d5e/v2.0',
      }),
    ).toThrow(/CREDENTIAL_KEK_PROVIDER/);
  });

  it('only accepts the Entra issuer for the allowed tenant in production', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@db:5432/x?sslmode=verify-full',
        REDIS_URL: 'rediss://cache:6380',
        CORS_ALLOWED_ORIGINS: 'https://studio.example.com',
        PUBLIC_APP_ORIGIN: 'https://studio.example.com',
        OIDC_ISSUER_URL: 'https://evil.example.com/default',
      }),
    ).toThrow(/OIDC_ISSUER_URL/);
  });
});
