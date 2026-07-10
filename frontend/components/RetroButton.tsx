'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

interface RetroButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  asLink?: boolean;
  href?: string;
}

const VARIANT_CLASS: Record<string, string> = {
  primary:
    'border-secondary text-secondary hover:bg-secondary hover:text-black hover:shadow-[0_0_20px_rgba(76,215,246,0.4)]',
  secondary:
    'border-hot-pink text-hot-pink hover:bg-hot-pink hover:text-black hover:shadow-[0_0_20px_rgba(244,114,182,0.4)]',
  danger:
    'border-danger-red text-danger-red hover:bg-danger-red hover:text-white hover:shadow-[0_0_20px_rgba(239,68,68,0.4)]',
};

const SIZE_CLASS: Record<string, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-8 py-3 text-base',
};

export const RetroButton = forwardRef<HTMLButtonElement, RetroButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex min-h-[44px] items-center justify-center gap-2 border-2 font-mono font-bold uppercase tracking-wider transition-all duration-200 active:translate-y-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

RetroButton.displayName = 'RetroButton';
