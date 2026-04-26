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
    <div className="flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-border-strong bg-bg-1 p-12 text-center">
      {title ? <div className="text-[14px] font-medium text-fg">{title}</div> : null}
      {description ? <div className="max-w-[420px] text-[12.5px] text-fg-muted">{description}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
