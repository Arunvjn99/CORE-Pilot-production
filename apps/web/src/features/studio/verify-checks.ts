import type { Screen, VerifyIssue } from '@core-studio/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** What the preview reported for one screen. */
export interface VerifyResult {
  issues: VerifyIssue[];
  checkedAt: string;
  error?: string;
}

/** The Verify checks of one screen: running, or finished with a result. */
export type ScreenCheck = { status: 'running' } | { status: 'done'; result: VerifyResult };

interface Entry {
  /** The screen's code when the checks were requested: results for older code are dropped. */
  code: string;
  request: number;
  check: ScreenCheck;
}

/** How long a screen may take before its checks are reported as not finished. */
export const VERIFY_TIMEOUT_MS = 30_000;

/**
 * Verify checks per screen. `requests` goes to the canvas (each screen's frame runs its checks when
 * its number changes) and `receive` takes the frame's results. `checks` only holds checks for each
 * screen's current code, so editing a screen clears its results.
 */
export function useVerifyChecks(screens: Screen[]) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [requests, setRequests] = useState<Record<string, number>>({});
  const counter = useRef(0);
  const latest = useRef(screens);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    latest.current = screens;
  });
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  const run = useCallback((paths: string[]) => {
    const next: Record<string, Entry> = {};
    for (const path of paths) {
      const screen = latest.current.find((s) => s.filePath === path);
      if (!screen) continue;
      counter.current += 1;
      next[path] = { code: screen.code, request: counter.current, check: { status: 'running' } };
    }
    if (Object.keys(next).length === 0) return;
    setEntries((current) => ({ ...current, ...next }));
    setRequests((current) => ({
      ...current,
      ...Object.fromEntries(Object.entries(next).map(([path, e]) => [path, e.request])),
    }));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setEntries((current) => {
        const updated = { ...current };
        let changed = false;
        for (const [path, e] of Object.entries(next)) {
          const now = current[path];
          if (now?.request !== e.request || now.check.status !== 'running') continue;
          updated[path] = {
            ...now,
            check: {
              status: 'done',
              result: {
                issues: [],
                checkedAt: new Date().toISOString(),
                error: 'The checks did not finish. Try again.',
              },
            },
          };
          changed = true;
        }
        return changed ? updated : current;
      });
    }, VERIFY_TIMEOUT_MS);
    timers.current.add(timer);
  }, []);

  const receive = useCallback((path: string, result: VerifyResult) => {
    setEntries((current) => {
      const entry = current[path];
      if (entry?.check.status !== 'running') return current;
      return { ...current, [path]: { ...entry, check: { status: 'done', result } } };
    });
  }, []);

  const checks = useMemo(() => {
    const out: Record<string, ScreenCheck> = {};
    for (const screen of screens) {
      const entry = entries[screen.filePath];
      if (entry && entry.code === screen.code) out[screen.filePath] = entry.check;
    }
    return out;
  }, [entries, screens]);

  return { checks, requests, run, receive };
}
