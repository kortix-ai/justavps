import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const invalidateQueriesMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

vi.mock('@/shared/hooks/use-account', () => ({
  useAccount: () => ({ data: { is_admin: true }, isLoading: false }),
}));

vi.mock('@/shared/hooks/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/shared/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/shared/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/shared/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/shared/ui/skeleton', () => ({
  Skeleton: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
}));

vi.mock('@/shared/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

vi.mock('@/shared/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('admin machines page safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
  });

  it('re-exports the canonical admin machines page from the /v2 alias route', async () => {
    const canonical = (await import('@/app/(dashboard)/admin/machines/page')).default;
    const aliased = (await import('@/app/v2/admin/machines/page')).default;

    expect(aliased).toBe(canonical);
  });

  it('renders malformed admin payload numbers without leaking NaN state', async () => {
    useQueryMock.mockReturnValue({
      data: {
        total: 'bad',
        limit: 100,
        offset: 'oops',
        summary: { by_status: {}, by_source: {} },
        machines: [{
          id: 'machine-1',
          slug: 'agent-box',
          name: 'Agent Box',
          status: 'ready',
          provisioning_stage: null,
          provider: 'baremetal',
          server_type: 'custom',
          region: 'hel1',
          ip: null,
          source: 'user',
          kortix_sandbox_id: null,
          price_monthly: 20,
          backups_enabled: false,
          provider_server_id: 'srv-1',
          daemon_version: null,
          created_at: '2026-04-10T00:00:00.000Z',
          ready_at: '2026-04-10T00:01:00.000Z',
          deleted_at: null,
          last_heartbeat_at: '2026-04-10T00:02:00.000Z',
          health: { cpu: Number.NaN, memory: undefined, disk: 'bad' },
          owner: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
          account: { id: 'account-1', name: 'Acme', slug: 'acme', type: 'organization' },
          subscription: null,
        }],
      },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    });

    const Page = (await import('@/app/(dashboard)/admin/machines/page')).default;
    const markup = renderToStaticMarkup(<Page />);

    expect(markup).toContain('Showing 1–1 of 1');
    expect(markup).toContain('CPU 0%');
    expect(markup).toContain('RAM 0%');
    expect(markup).toContain('Disk 0%');
    expect(markup).not.toContain('NaN');
  });

  it('shows the load error without falling through to the empty state', async () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('admin machines exploded'),
      isFetching: false,
      refetch: vi.fn(),
    });

    const Page = (await import('@/app/(dashboard)/admin/machines/page')).default;
    const markup = renderToStaticMarkup(<Page />);

    expect(markup).toContain('Failed to load: admin machines exploded');
    expect(markup).not.toContain('No machines found matching your filters');
  });
});
