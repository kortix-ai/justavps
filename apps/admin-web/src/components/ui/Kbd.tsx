import type { ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function KbdRow({ keys }: { keys: ReactNode[] }) {
  return (
    <span className="kbd-row">
      {keys.map((k, i) => (
        <Kbd key={i}>{k}</Kbd>
      ))}
    </span>
  );
}
