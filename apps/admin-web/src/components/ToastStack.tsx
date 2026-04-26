import { useStore } from '../lib/store';
import { cx } from '../lib/utils';
import { StatusDot } from './ui/Status';

export function ToastStack() {
  const { toasts, removeToast } = useStore();
  return (
    <div className="toast-stack" data-testid="v2-toast">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cx('toast', toast.tone === 'ok' && 'toast--ok', toast.tone === 'bad' && 'toast--bad', toast.tone === 'warn' && 'toast--warn')}
          role="status"
          onClick={() => removeToast(toast.id)}
        >
          <StatusDot tone={toast.tone === 'ok' ? 'ok' : toast.tone === 'bad' ? 'bad' : toast.tone === 'warn' ? 'warn' : 'info'} />
          <span className="text-truncate">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
