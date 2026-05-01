'use client';

// UI preferences: theme (dark/light/system).
// Stored in localStorage; hydrated client-side.
// Sidebar state is handled by the shadcn <SidebarProvider> (cookie-backed) and Cmd+B is wired there.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light' | 'system';

type UiPrefs = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  defaultStatefulSnapshots: boolean;
  setDefaultStatefulSnapshots: (v: boolean) => void;
  defaultFullBackups: boolean;
  setDefaultFullBackups: (v: boolean) => void;
  defaultOptimizedBackups: boolean;
  setDefaultOptimizedBackups: (v: boolean) => void;
};

const Ctx = createContext<UiPrefs | null>(null);

const KEY_THEME = 'v2-admin:theme';
const KEY_DEFAULT_STATEFUL_SNAPSHOTS = 'v2-admin:default-stateful-snapshots';
const KEY_DEFAULT_FULL_BACKUPS = 'v2-admin:default-full-backups';
const KEY_DEFAULT_OPTIMIZED_BACKUPS = 'v2-admin:default-optimized-backups';

function storedBool(key: string, fallback: boolean) {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    if (value === 'true') return true;
    if (value === 'false') return false;
  } catch { /* SSR / private mode */ }
  return fallback;
}

function isTheme(value: string | null): value is Theme {
  return value === 'dark' || value === 'light' || value === 'system';
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  root.classList.toggle('dark', resolved === 'dark');
}

export function UiPrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [defaultStatefulSnapshots, setDefaultStatefulSnapshotsState] = useState(false);
  const [defaultFullBackups, setDefaultFullBackupsState] = useState(true);
  const [defaultOptimizedBackups, setDefaultOptimizedBackupsState] = useState(true);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const stored = window.localStorage.getItem(KEY_THEME);
        if (isTheme(stored)) setThemeState(stored);
      } catch { /* SSR / private mode */ }
      setDefaultStatefulSnapshotsState(storedBool(KEY_DEFAULT_STATEFUL_SNAPSHOTS, false));
      setDefaultFullBackupsState(storedBool(KEY_DEFAULT_FULL_BACKUPS, true));
      setDefaultOptimizedBackupsState(storedBool(KEY_DEFAULT_OPTIMIZED_BACKUPS, true));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { window.localStorage.setItem(KEY_THEME, t); } catch { /* */ }
  }, []);

  const setDefaultStatefulSnapshots = useCallback((v: boolean) => {
    setDefaultStatefulSnapshotsState(v);
    try { window.localStorage.setItem(KEY_DEFAULT_STATEFUL_SNAPSHOTS, String(v)); } catch { /* */ }
  }, []);

  const setDefaultFullBackups = useCallback((v: boolean) => {
    setDefaultFullBackupsState(v);
    try { window.localStorage.setItem(KEY_DEFAULT_FULL_BACKUPS, String(v)); } catch { /* */ }
  }, []);

  const setDefaultOptimizedBackups = useCallback((v: boolean) => {
    setDefaultOptimizedBackupsState(v);
    try { window.localStorage.setItem(KEY_DEFAULT_OPTIMIZED_BACKUPS, String(v)); } catch { /* */ }
  }, []);

  return (
    <Ctx.Provider value={{
      theme,
      setTheme,
      defaultStatefulSnapshots,
      setDefaultStatefulSnapshots,
      defaultFullBackups,
      setDefaultFullBackups,
      defaultOptimizedBackups,
      setDefaultOptimizedBackups,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useUiPrefs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUiPrefs() must be inside <UiPrefsProvider>');
  return ctx;
}
