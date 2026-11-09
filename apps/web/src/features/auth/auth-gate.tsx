import type { ReactNode } from 'react';
import { SignInPage } from './sign-in-page';
import { useSession } from './use-session';

export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.isPending) {
    return (
      <p role="status" className="grid min-h-dvh place-items-center text-sm text-text-muted">
        Loading…
      </p>
    );
  }
  if (session.isError) {
    return (
      <p role="alert" className="grid min-h-dvh place-items-center text-sm text-danger">
        The platform is unavailable. Please retry shortly.
      </p>
    );
  }
  if (!session.data) return <SignInPage />;
  return children;
}
