import { Inject, Injectable } from '@nestjs/common';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';

const identityClaimsSchema = z.object({
  tid: z.uuid(),
  oid: z.uuid(),
  name: z.string().min(1).max(200).optional(),
  preferred_username: z.string().max(320).optional(),
  email: z.string().max(320).optional(),
});

export interface VerifiedIdentity {
  tenantId: string;
  objectId: string;
  displayName: string;
  email: string | null;
  idToken: string;
}

export class IdentityRejectedError extends Error {}

/** OIDC Authorization Code + PKCE, server-side (BFF). Tokens never reach the browser. */
@Injectable()
export class OidcService {
  private configuration: Promise<oidc.Configuration> | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get redirectUri(): string {
    return `${this.config.PUBLIC_APP_ORIGIN}/api/v1/auth/callback`;
  }

  /** Plain-HTTP issuers are only possible outside production (config validation enforces the Entra https issuer). */
  private discoveryOptions(): oidc.DiscoveryRequestOptions | undefined {
    if (this.config.NODE_ENV === 'production') return undefined;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- intentional, dev/test-only escape hatch
    return { execute: [oidc.allowInsecureRequests] };
  }

  private discover(): Promise<oidc.Configuration> {
    this.configuration ??= oidc
      .discovery(
        new URL(this.config.OIDC_ISSUER_URL),
        this.config.OIDC_CLIENT_ID,
        this.config.OIDC_CLIENT_SECRET,
        undefined,
        this.discoveryOptions(),
      )
      .catch((error: unknown) => {
        this.configuration = null;
        throw error;
      });
    return this.configuration;
  }

  async buildAuthorizationUrl(params: {
    state: string;
    nonce: string;
    codeVerifier: string;
    forceReauthentication: boolean;
    loginHint?: string;
  }): Promise<URL> {
    const configuration = await this.discover();
    const query: Record<string, string> = {
      redirect_uri: this.redirectUri,
      scope: this.config.OIDC_SCOPES,
      state: params.state,
      nonce: params.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(params.codeVerifier),
      code_challenge_method: 'S256',
    };
    if (params.forceReauthentication) query['prompt'] = 'login';
    if (params.loginHint) query['login_hint'] = params.loginHint;
    return oidc.buildAuthorizationUrl(configuration, query);
  }

  async completeLogin(
    callbackUrl: URL,
    expected: { state: string; nonce: string; codeVerifier: string },
  ): Promise<VerifiedIdentity> {
    const configuration = await this.discover();
    const tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
      pkceCodeVerifier: expected.codeVerifier,
      expectedState: expected.state,
      expectedNonce: expected.nonce,
      idTokenExpected: true,
    });
    const parsed = identityClaimsSchema.safeParse(tokens.claims());
    if (!parsed.success)
      throw new IdentityRejectedError('ID token is missing required identity claims');
    const claims = parsed.data;
    if (claims.tid !== this.config.OIDC_ALLOWED_TENANT_ID)
      throw new IdentityRejectedError('Identity is not from the allowed tenant');
    return {
      tenantId: claims.tid,
      objectId: claims.oid,
      displayName: claims.name ?? claims.preferred_username ?? 'Unknown user',
      email: claims.email ?? claims.preferred_username ?? null,
      idToken: tokens.id_token ?? '',
    };
  }

  async endSessionUrl(idTokenHint: string | null): Promise<string | null> {
    const configuration = await this.discover();
    if (!configuration.serverMetadata().end_session_endpoint) return null;
    const params: Record<string, string> = {
      post_logout_redirect_uri: `${this.config.PUBLIC_APP_ORIGIN}/`,
    };
    if (idTokenHint) params['id_token_hint'] = idTokenHint;
    return oidc.buildEndSessionUrl(configuration, params).href;
  }
}
