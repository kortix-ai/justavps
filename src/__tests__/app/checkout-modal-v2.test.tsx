// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const pushMock = vi.fn();
const mutateMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}));

vi.mock('@/hooks/v2/use-hosts-v2', () => ({
  useAvailableHosts: () => ({
    data: [{
      id: 'host-1',
      name: 'Host 1',
      region: 'hel1',
      location_label: 'HEL1',
      public_ipv4: '1.2.3.4',
      capacity: {
        free_vcpu: 8,
        free_memory_gb: 32,
        free_disk_gb: 400,
        used_vcpu: 4,
        total_vcpu: 12,
        used_memory_gb: 16,
        total_memory_gb: 48,
        used_disk_gb: 100,
        total_disk_gb: 500,
      },
    }],
    isLoading: false,
  }),
}));

vi.mock('@/hooks/v2/use-machines-v2', () => ({
  useCreateMachine: () => ({
    mutate: mutateMock,
    isPending: false,
  }),
}));

vi.mock('@/hooks/use-account', () => ({
  useAccountLimits: () => ({
    data: {
      usage: { machines: 0 },
      limits: { max_machines: 5 },
    },
  }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/slider', () => ({
  Slider: ({ value, onValueChange }: { value?: number[]; onValueChange?: (value: number[]) => void }) => (
    <input
      type="range"
      value={value?.[0] ?? 0}
      onChange={(event) => onValueChange?.([Number(event.currentTarget.value)])}
    />
  ),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('CheckoutModal Docker image flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits container mode with a user Docker image', async () => {
    const { CheckoutModal } = await import('@/components/v2/checkout-modal-v2');

    render(<CheckoutModal open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /container/i }));
    fireEvent.change(screen.getByPlaceholderText('nginx:latest or docker:nginx:latest'), {
      target: { value: 'nginx:latest' },
    });
    fireEvent.click(screen.getByRole('button', { name: /deploy machine/i }));

    expect(mutateMock).toHaveBeenCalledWith(expect.objectContaining({
      machine_mode: 'container',
      docker_image: 'nginx:latest',
      host_id: 'host-1',
      region: 'hel1',
    }), expect.any(Object));
  });
});
