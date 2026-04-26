import { useStore } from '../lib/store';
import { cx } from '../lib/utils';

export function ToastStack() {
  const { toasts, removeToast } = useStore();
  return (
    <div aria-live="polite" data-testid="v2-toast">
      {toasts.map((toast, index) => (
        <div
          key={toast.id}
          className={cx('toast', toast.tone === 'ok' && 'ok', toast.tone === 'bad' && 'bad')}
          style={{ bottom: 18 + index * 64 }}
          onClick={() => removeToast(toast.id)}
          role="status"
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
