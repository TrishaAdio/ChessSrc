import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import clsx from 'clsx';
import { SPRINGS } from '@/lib/motion/springs';

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  strong?: boolean;
  radius?: number;
}

/** Frosted panel: backdrop blur, gradient refraction edge, specular sheen and grain. */
export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(function GlassPanel(
  { strong, radius, className, style, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={clsx('glass', strong && 'glass-strong', className)}
      style={radius ? { ...style, ['--glass-radius' as string]: `${radius}px` } : style}
      {...rest}
    />
  );
});

type Variant = 'glass' | 'ghost' | 'accent' | 'danger';

export interface GlassButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  icon?: ReactNode;
  children?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const VARIANTS: Record<Variant, string> = {
  glass: 'bg-white/[0.07] hover:bg-white/[0.12] shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_6px_18px_-8px_rgb(0_0_0/0.6)] ring-1 ring-white/10',
  ghost: 'bg-transparent hover:bg-white/[0.08]',
  accent:
    'bg-gradient-to-b from-sky-300/40 to-cyan-500/30 hover:from-sky-300/55 hover:to-cyan-500/40 ring-1 ring-sky-200/40 shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_10px_28px_-10px_rgb(56_189_248/0.8)]',
  danger: 'bg-rose-500/15 hover:bg-rose-500/25 ring-1 ring-rose-300/25 text-rose-100',
};

const SIZES = {
  sm: 'h-8 px-3 text-[12.5px] gap-1.5 rounded-xl',
  md: 'h-10 px-4 text-[13.5px] gap-2 rounded-2xl',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-2xl',
} as const;

/** Glass button with an iOS-style spring press (scale + brightness). */
export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(function GlassButton(
  { variant = 'glass', size = 'md', icon, children, className, disabled, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      transition={SPRINGS.snappy}
      className={clsx(
        'inline-flex select-none items-center justify-center font-semibold backdrop-blur-md transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </motion.button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'style'> {
  label: string;
  children: ReactNode;
  active?: boolean;
}

export function IconButton({ label, children, active, className, disabled, ...rest }: IconButtonProps) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.88 }}
      transition={SPRINGS.snappy}
      className={clsx(
        'grid size-10 place-items-center rounded-2xl text-ink-dim transition-colors',
        'hover:bg-white/[0.09] hover:text-ink disabled:cursor-not-allowed disabled:opacity-30',
        active && 'bg-white/[0.12] text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]',
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
