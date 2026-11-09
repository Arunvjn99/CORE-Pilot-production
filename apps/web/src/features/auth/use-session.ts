import { type SessionResponse, sessionResponseSchema } from '@core-studio/contracts';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet, setCsrfToken } from '../../lib/api-client';

export const SESSION_QUERY_KEY = ['auth', 'session'] as const;

/** null = signed out (401). Errors other than 401 surface as query errors. */
export function useSession() {
  return useQuery<SessionResponse | null>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async ({ signal }) => {
      try {
        const session = await apiGet('/api/v1/auth/session', sessionResponseSchema, signal);
        setCsrfToken(session.csrfToken);
        return session;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setCsrfToken(null);
          return null;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function signInUrl(returnTo: string): string {
  return `/api/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}
