import { forwardRef } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from '../../lib/utils';

type Size = 'sm' | 'md' | 'lg';

const sizeClass: Record<Size, string> = {
  sm: 'input--sm',
  md: '',
  lg: 'input--lg',
};

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  inputSize?: Size;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, inputSize = 'md', ...rest },
  ref,
) {
  return <input ref={ref} className={cx('input', sizeClass[inputSize], className)} {...rest} />;
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  inputSize?: Size;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, inputSize = 'md', children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx('input', sizeClass[inputSize], className)} {...rest}>
      {children}
    </select>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx('input', className)} {...rest} />;
});
