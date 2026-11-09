export interface StoredSession {
  userId: string;
  activeOrganizationId: string | null;
  csrfToken: string;
  createdAt: number;
  /** Epoch ms of the last forced re-authentication (prompt=login). Null until a step-up happens. */
  stepUpAt: number | null;
  /** IdP id_token for RP-initiated logout (id_token_hint); never sent to the browser. */
  idTokenHint: string | null;
}

export interface PendingLogin {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  bindingHash: string;
  /** For step-up: hash of the session that requested it (the raw id is never stored). */
  stepUpSessionHash: string | null;
}
