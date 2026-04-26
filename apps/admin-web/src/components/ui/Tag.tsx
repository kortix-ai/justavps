import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/utils';

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'violet' | 'ghost';

export type TagProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  children?: ReactNode;
};

const toneClass: Record<Tone, string> = {
  neutral: '',
  ok: 'tag--ok',
  warn: 'tag--warn',
  bad: 'tag--bad',
  info: 'tag--info',
  violet: 'tag--violet',
  ghost: 'tag--ghost',
};

export function Tag({ className, tone = 'neutral', children, ...rest }: TagProps) {
  return (
    <span className={cx('tag', toneClass[tone], className)} {...rest}>
      {children}
    </span>
  );
}
