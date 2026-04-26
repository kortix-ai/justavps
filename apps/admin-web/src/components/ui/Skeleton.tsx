import type { CSSProperties } from 'react';

export function Skeleton({ width, height = 12, style }: { width?: string | number; height?: string | number; style?: CSSProperties }) {
  return (
    <div
      className="skeleton"
      style={{ width: width ?? '100%', height, display: 'block', ...style }}
      aria-hidden
    />
  );
}
