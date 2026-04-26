import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/utils';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'danger-ghost' | 'success';
type Size = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  iconOnly?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
};

const variantClass: Record<Variant, string> = {
  primary: '',
  secondary: 'btn--secondary',
  outline: 'btn--outline',
  ghost: 'btn--ghost',
  danger: 'btn--danger',
  'danger-ghost': 'btn--danger-ghost',
  success: 'btn--success',
};

const sizeClass: Record<Size, string> = {
  sm: 'btn--sm',
  md: '',
  lg: 'btn--lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', iconOnly = false, leftIcon, rightIcon, loading, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      className={cx('btn', variantClass[variant], sizeClass[size], iconOnly && 'btn--icon', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {leftIcon ? <span aria-hidden>{leftIcon}</span> : null}
      {children}
      {rightIcon ? <span aria-hidden>{rightIcon}</span> : null}
    </button>
  );
});
