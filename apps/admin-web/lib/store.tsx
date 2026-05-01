'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  api,
  type ApiContext,
  type BackupItem,
  type ClusterRow,
  type Health,
  type HostMember,
  type ImageItem,
  type InventoryHost,
  type Machine,
  type SnapshotItem,
  type ToolboxRoutes,
} from './api';

type ToastTone = 'ok' | 'bad' | 'warn' | 'info';

export type Toast = { id: number; message: string; tone: ToastTone };
export type StatusState = { label: string; tone: 'ok' | 'bad' | 'warn' | 'idle' };
export type WorkflowEntry = { ts: string; text: string };

type State = {
  baseUrl: string;
  token: string;
  busy: boolean;
  status: StatusState;
  health: Health | null;
  regions: string[];
  clusters: ClusterRow[];
  hosts: HostMember[];
  inventory: InventoryHost[];
  machines: Machine[];
  images: ImageItem[];
  servers: unknown[];
  products: unknown[];
  snapshots: SnapshotItem[];
  backups: BackupItem[];
  selectedMachineId: string | null;
  workflowLog: WorkflowEntry[];
  toolbox: ToolboxRoutes | null;
  lastResult: { label: string; data: unknown } | null;
  lastRefreshAt: string | null;
};

type Setter = (updater: (s: State) => State) => void;

type StoreContext = {
  state: State;
  setState: Setter;
  setBaseUrl: (value: string) => void;
  setToken: (value: string) => void;
  setStatus: (status: StatusState) => void;
  setBusy: (busy: boolean) => void;
  pushToast: (message: string, tone?: ToastTone) => void;
  removeToast: (id: number) => void;
  toasts: Toast[];
  appendLog: (text: string) => void;
  showResult: (label: string, data: unknown) => void;
  request: <T = unknown>(path: string, opts?: Parameters<typeof api>[2]) => Promise<T>;
  runAction: <T>(label: string, fn: () => Promise<T>, options?: { silent?: boolean }) => Promise<T>;
  refreshAll: () => Promise<void>;
  setSelectedMachineId: (id: string | null) => void;
  setSnapshots: (snapshots: SnapshotItem[]) => void;
  setBackups: (backups: BackupItem[]) => void;
  setToolbox: (toolbox: ToolboxRoutes | null) => void;
  setProducts: (products: unknown[]) => void;
  setServers: (servers: unknown[]) => void;
};

const Context = createContext<StoreContext | null>(null);

const initialState: State = {
  baseUrl: '',
  token: '',
  busy: false,
  status: { label: 'idle', tone: 'idle' },
  health: null,
  regions: [],
  clusters: [],
  hosts: [],
  inventory: [],
  machines: [],
  images: [],
  servers: [],
  products: [],
  snapshots: [],
  backups: [],
  selectedMachineId: null,
  workflowLog: [],
  toolbox: null,
  lastResult: null,
  lastRefreshAt: null,
};

const STORAGE_KEYS = { baseUrl: 'v2-admin:url', token: 'v2-admin:token' };

function defaultBaseUrl() {
  if (typeof window === 'undefined') return '';
  // Build-time override (e.g., dev mode pointing at a separate API host).
  // Set via NEXT_PUBLIC_V2_API_URL in .env.local. Without it, the UI calls
  // its own origin — fine in production where v2-api serves /admin-ui static,
  // wrong in dev where admin-web on :4300 needs to hit the API on :4200.
  const envOverride = process.env.NEXT_PUBLIC_V2_API_URL?.trim();
  if (envOverride) return envOverride;
  return window.location.origin;
}

function defaultToken() {
  if (typeof window === 'undefined') return '';
  return process.env.NEXT_PUBLIC_V2_ADMIN_TOKEN?.trim() ?? '';
}

function readLocal(key: string): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(key) || '';
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, internalSet] = useState<State>(() => initialState);
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  // Hydrate from localStorage on first client render to avoid SSR mismatch.
  // Env override (NEXT_PUBLIC_V2_API_URL) wins over localStorage. localStorage
  // was the runtime override for the Settings dialog, but if the dev/prod
  // env deliberately points at a known API URL, a stale localStorage entry
  // (e.g. from a previous run on a different port) silently breaks every
  // request. Prefer env, fall back to localStorage, then origin.
  useEffect(() => {
    const env = process.env.NEXT_PUBLIC_V2_API_URL?.trim();
    const envToken = process.env.NEXT_PUBLIC_V2_ADMIN_TOKEN?.trim();
    const baseUrl = env || readLocal(STORAGE_KEYS.baseUrl) || defaultBaseUrl();
    if (env && readLocal(STORAGE_KEYS.baseUrl) && readLocal(STORAGE_KEYS.baseUrl) !== env) {
      window.localStorage.setItem(STORAGE_KEYS.baseUrl, env);
    }
    if (envToken && readLocal(STORAGE_KEYS.token) !== envToken) {
      window.localStorage.setItem(STORAGE_KEYS.token, envToken);
    }
    internalSet((prev) => ({
      ...prev,
      baseUrl,
      token: envToken || readLocal(STORAGE_KEYS.token) || defaultToken(),
    }));
    setHydrated(true);
  }, []);

  const setState: Setter = useCallback((updater) => {
    internalSet((prev) => updater(prev));
  }, []);

  const setBaseUrl = useCallback((value: string) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEYS.baseUrl, value);
    setState((prev) => ({ ...prev, baseUrl: value }));
  }, [setState]);

  const setToken = useCallback((value: string) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEYS.token, value);
    setState((prev) => ({ ...prev, token: value }));
  }, [setState]);

  const setStatus = useCallback((status: StatusState) => {
    setState((prev) => ({ ...prev, status }));
  }, [setState]);

  const setBusy = useCallback((busy: boolean) => {
    setState((prev) => ({ ...prev, busy }));
  }, [setState]);

  const pushToast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const appendLog = useCallback((text: string) => {
    setState((prev) => ({
      ...prev,
      workflowLog: [{ ts: new Date().toLocaleTimeString(), text }, ...prev.workflowLog].slice(0, 200),
    }));
  }, [setState]);

  const showResult = useCallback((label: string, data: unknown) => {
    setState((prev) => ({ ...prev, lastResult: { label, data } }));
  }, [setState]);

  const ctx = useCallback((): ApiContext => ({
    baseUrl: stateRef.current.baseUrl,
    token: stateRef.current.token,
  }), []);

  const request = useCallback(<T,>(path: string, opts?: Parameters<typeof api>[2]) => api<T>(ctx(), path, opts), [ctx]);

  const runAction = useCallback(
    async <T,>(label: string, fn: () => Promise<T>, options?: { silent?: boolean }): Promise<T> => {
      const silent = options?.silent ?? false;
      setBusy(true);
      setStatus({ label, tone: 'warn' });
      if (!silent) appendLog(label);
      try {
        const data = await fn();
        setStatus({ label: `${label} ok`, tone: 'ok' });
        if (!silent) {
          showResult(label, data);
          pushToast(`${label} ok`, 'ok');
        }
        return data;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus({ label: `${label} failed`, tone: 'bad' });
        appendLog(`${label} failed: ${message}`);
        showResult(`${label} failed`, { message });
        pushToast(message, 'bad');
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [appendLog, pushToast, setBusy, setStatus, showResult],
  );

  const refreshAll = useCallback(async () => {
    await runAction('refresh', async () => {
      const [health, regions, images, machines, clusters, hosts, inventory] = await Promise.all([
        request<Health>('/health', { auth: false }),
        request<{ regions: string[] }>('/regions', { auth: false }),
        request<{ images: ImageItem[] }>('/images', { auth: false }),
        request<{ machines: Machine[] }>('/machines', { auth: false }),
        request<{ clusters: ClusterRow[] }>('/admin/clusters'),
        request<{ hosts: HostMember[] }>('/admin/hosts'),
        request<{ hosts: InventoryHost[] }>('/admin/hosts/inventory'),
      ]);
      setState((prev) => ({
        ...prev,
        health,
        regions: regions.regions ?? [],
        images: images.images ?? [],
        machines: machines.machines ?? [],
        clusters: clusters.clusters ?? [],
        hosts: hosts.hosts ?? [],
        inventory: inventory.hosts ?? [],
        lastRefreshAt: new Date().toLocaleTimeString(),
      }));
      return {
        health,
        clusters: (clusters.clusters ?? []).length,
        hosts: (hosts.hosts ?? []).length,
        inventory: (inventory.hosts ?? []).length,
        machines: (machines.machines ?? []).length,
        images: (images.images ?? []).length,
      };
    });
  }, [request, runAction, setState]);

  const setSelectedMachineId = useCallback((id: string | null) => {
    setState((prev) => ({
      ...prev,
      selectedMachineId: id,
      snapshots: id === prev.selectedMachineId ? prev.snapshots : [],
      backups: id === prev.selectedMachineId ? prev.backups : [],
      toolbox: id === prev.selectedMachineId ? prev.toolbox : null,
    }));
  }, [setState]);

  const setSnapshots = useCallback((snapshots: SnapshotItem[]) => {
    setState((prev) => ({ ...prev, snapshots }));
  }, [setState]);

  const setBackups = useCallback((backups: BackupItem[]) => {
    setState((prev) => ({ ...prev, backups }));
  }, [setState]);

  const setToolbox = useCallback((toolbox: ToolboxRoutes | null) => {
    setState((prev) => ({ ...prev, toolbox }));
  }, [setState]);

  const setProducts = useCallback((products: unknown[]) => {
    setState((prev) => ({ ...prev, products }));
  }, [setState]);

  const setServers = useCallback((servers: unknown[]) => {
    setState((prev) => ({ ...prev, servers }));
  }, [setState]);

  // Auto-refresh on first hydration.
  useEffect(() => {
    if (!hydrated) return;
    refreshAll().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const value = useMemo<StoreContext>(
    () => ({
      state,
      setState,
      setBaseUrl,
      setToken,
      setStatus,
      setBusy,
      pushToast,
      removeToast,
      toasts,
      appendLog,
      showResult,
      request,
      runAction,
      refreshAll,
      setSelectedMachineId,
      setSnapshots,
      setBackups,
      setToolbox,
      setProducts,
      setServers,
    }),
    [
      state,
      setState,
      setBaseUrl,
      setToken,
      setStatus,
      setBusy,
      pushToast,
      removeToast,
      toasts,
      appendLog,
      showResult,
      request,
      runAction,
      refreshAll,
      setSelectedMachineId,
      setSnapshots,
      setBackups,
      setToolbox,
      setProducts,
      setServers,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useStore(): StoreContext {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
