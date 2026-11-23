import type { Screen } from '@core-studio/contracts';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVerifyChecks, VERIFY_TIMEOUT_MS } from './verify-checks';

const screen = (name: string, code: string): Screen => ({
  pageId:
    name === 'home'
      ? '88888888-8888-4888-8888-888888888888'
      : '99999999-9999-4999-8999-999999999999',
  name,
  route: `/${name}`,
  filePath: `src/pages/${name}.tsx`,
  code,
});
const HOME = 'src/pages/home.tsx';
const CHECKOUT = 'src/pages/checkout.tsx';
const result = {
  issues: [
    {
      id: 'image-alt',
      severity: 'critical' as const,
      category: 'accessibility' as const,
      message: 'm',
      help: 'h',
      line: 2,
      column: 0,
    },
  ],
  checkedAt: '2026-11-23T10:00:00.000Z',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('useVerifyChecks', () => {
  it('requests checks per screen and keeps results only for the code they were run on', () => {
    const { result: hook, rerender } = renderHook(({ screens }) => useVerifyChecks(screens), {
      initialProps: { screens: [screen('home', 'a'), screen('checkout', 'b')] },
    });
    act(() => {
      hook.current.run([HOME, CHECKOUT, 'src/pages/missing.tsx']);
    });
    expect(Object.keys(hook.current.requests).sort()).toEqual([CHECKOUT, HOME]);
    expect(hook.current.checks[HOME]).toEqual({ status: 'running' });
    const first = hook.current.requests[HOME];

    act(() => {
      hook.current.receive(HOME, result);
      hook.current.receive(CHECKOUT, { ...result, issues: [] });
    });
    expect(hook.current.checks[HOME]).toEqual({ status: 'done', result });

    // A second result for the same request is ignored.
    act(() => {
      hook.current.receive(HOME, { ...result, issues: [] });
    });
    expect(hook.current.checks[HOME]).toEqual({ status: 'done', result });

    // Editing a screen clears its results; the other screen keeps them.
    rerender({ screens: [screen('home', 'a2'), screen('checkout', 'b')] });
    expect(hook.current.checks[HOME]).toBeUndefined();
    expect(hook.current.checks[CHECKOUT]).toMatchObject({ status: 'done' });

    // Running again issues a new request number, so the frame runs the checks again.
    act(() => {
      hook.current.run([HOME]);
    });
    expect(hook.current.requests[HOME]).not.toBe(first);
    expect(hook.current.checks[HOME]).toEqual({ status: 'running' });
  });

  it('ignores results nobody asked for and reports checks that never finish', () => {
    vi.useFakeTimers();
    const { result: hook } = renderHook(() => useVerifyChecks([screen('home', 'a')]));
    act(() => {
      hook.current.receive(HOME, result);
    });
    expect(hook.current.checks[HOME]).toBeUndefined();

    act(() => {
      hook.current.run([HOME]);
    });
    act(() => {
      vi.advanceTimersByTime(VERIFY_TIMEOUT_MS);
    });
    expect(hook.current.checks[HOME]).toMatchObject({
      status: 'done',
      result: { issues: [], error: 'The checks did not finish. Try again.' },
    });
  });
});
