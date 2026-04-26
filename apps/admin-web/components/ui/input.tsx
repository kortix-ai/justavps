'use client';

import { forwardRef } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const inputBase =
  'block w-full rounded-[8px] border border-border-strong bg-bg-1 px-3 text-fg placeholder:text-fg-disabled outline-none transition-[border-color,box-shadow] hover:border-border-focus focus:border-fg focus:ring-2 focus:ring-white/10 disabled:opacity-50';
const sizeMap = { sm: 'h-7 text-[12px] px-2', md: 'h-8 text-[13px]', lg: 'h-10 text-[14px]' };

type Size = keyof typeof sizeMap;

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { inputSize?: Size; leftIcon?: ReactNode };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, inputSize = 'md', leftIcon, ...rest }, ref) {
  if (leftIcon) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-disabled inline-flex size-3.5">
          {leftIcon}
        </span>
        <input
          ref={ref}
          className={cn(inputBase, sizeMap[inputSize], 'pl-8', className)}
          {...rest}
        />
      </div>
    );
  }
  return <input ref={ref} className={cn(inputBase, sizeMap[inputSize], className)} {...rest} />;
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { inputSize?: Size };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, inputSize = 'md', children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cn(inputBase, sizeMap[inputSize], 'appearance-none pr-7 bg-no-repeat', '[background-image:linear-gradient(45deg,transparent_50%,#a1a1aa_50%),linear-gradient(135deg,#a1a1aa_50%,transparent_50%)]', '[background-position:calc(100%-16px)_50%,calc(100%-11px)_50%]', '[background-size:5px_5px,5px_5px]', className)}
      {...rest}
    >
      {children}
    </select>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'block w-full rounded-[8px] border border-border-strong bg-bg-1 px-3 py-2 font-mono text-[12px] leading-[1.55] text-fg placeholder:text-fg-disabled outline-none transition-[border-color,box-shadow] hover:border-border-focus focus:border-fg focus:ring-2 focus:ring-white/10 min-h-[96px] resize-y',
        className,
      )}
      {...rest}
    />
  );
});
