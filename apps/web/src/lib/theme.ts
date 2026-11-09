import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'core-studio.theme';
const listeners = new Set<() => void>();

/** A display preference only (no user data); storage failures fall back to the system theme. */
function read(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(preference: ThemePreference = read()): void {
  const root = document.documentElement;
  if (preference === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = preference;
}

export function setTheme(preference: ThemePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Private mode or blocked storage: still apply for this page view.
  }
  applyTheme(preference);
  for (const listener of listeners) listener();
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read,
    () => 'system',
  );
}
