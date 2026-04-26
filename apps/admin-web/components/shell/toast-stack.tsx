'use client';

import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { StatusDot } from '@/components/ui/status';

export function ToastStack() {
  const { toasts, removeToast } = useStore();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex flex-col gap-2" data-testid="v2-toast">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          onClick={() => removeToast(toast.id)}
          className={cn(
            'pointer-events-auto inline-flex max-w-[360px] min-w-[240px] items-center gap-2.5 rounded-[10px] border bg-bg-2 px-3 py-2.5 text-[13px] shadow-[0_4px_24px_rgba(0,0,0,0.5)] [animation:pop-in_150ms_ease]',
            toast.tone === 'ok' && 'border-emerald-500/40',
            toast.tone === 'bad' && 'border-red-500/45',
            toast.tone === 'warn' && 'border-amber-500/45',
            !toast.tone && 'border-border-strong',
          )}
        >
          <StatusDot tone={toast.tone === 'ok' ? 'ok' : toast.tone === 'bad' ? 'bad' : toast.tone === 'warn' ? 'warn' : 'info'} />
          <span className="truncate">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
