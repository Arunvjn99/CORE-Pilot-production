import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { useSession } from '../auth/use-session';

export const AI_PROVIDERS_PATH = '/settings/ai-providers';

export function stepUpUrl(returnTo = AI_PROVIDERS_PATH): string {
  return `/api/v1/auth/step-up?returnTo=${encodeURIComponent(returnTo)}`;
}

/** UI hint only; the API enforces the recent-authentication window on every change. */
export function useRecentAuth(): boolean {
  const { data } = useSession();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 15_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return data?.recentAuthUntil ? Date.parse(data.recentAuthUntil) > now : false;
}

export const isReauthError = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'REAUTH_REQUIRED';

/**
 * Credential changes need a sign-in from the last few minutes. Re-authentication is a full
 * redirect to the identity provider, so nothing typed here (including keys) is kept.
 */
export function StepUpNotice({ action }: { action: string }) {
  return (
    <div
      role="note"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4 text-sm sm:flex-row sm:items-center"
    >
      <ShieldCheck size={20} aria-hidden="true" className="shrink-0 text-accent" />
      <p className="flex-1">
        For security, confirm it’s you before you {action}. You’ll return here afterwards.
      </p>
      <a
        href={stepUpUrl()}
        className="inline-flex items-center justify-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Confirm identity
      </a>
    </div>
  );
}
