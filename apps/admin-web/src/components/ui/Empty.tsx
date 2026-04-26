import type { ReactNode } from 'react';

export function Empty({
  title,
  description,
  action,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {title ? <div className="empty-title">{title}</div> : null}
      {description ? <div className="empty-desc">{description}</div> : null}
      {action ? <div style={{ marginTop: 4 }}>{action}</div> : null}
    </div>
  );
}
