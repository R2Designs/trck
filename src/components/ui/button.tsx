import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Buttons.
 *
 * Sizing is driven by where the product is used: `lg` (56 px) is the outdoor
 * default for anything a manager taps while standing next to a bus, and the
 * smallest variant still clears the 44 px accessible minimum. There is no
 * "ghost on a photo" variant — over a camera preview we use `overlay`, which
 * carries its own backdrop so the label survives a bright sky behind it.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold ' +
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
    'disabled:pointer-events-none disabled:opacity-55 active:scale-[0.99] ' +
    '[&_svg]:pointer-events-none [&_svg]:size-[1.15em] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border-2 border-input bg-background hover:bg-muted text-foreground',
        ghost: 'hover:bg-muted text-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
        success: 'bg-success text-success-foreground hover:bg-success/90 shadow-sm',
        link: 'text-primary underline-offset-4 hover:underline',
        overlay:
          'bg-black/65 text-white backdrop-blur-sm hover:bg-black/75 border border-white/25 shadow-lg',
      },
      size: {
        sm: 'h-10 px-3 text-sm',
        md: 'h-touch px-4',
        lg: 'h-touch-lg px-6 text-base',
        icon: 'h-touch w-touch',
        'icon-lg': 'h-touch-lg w-touch-lg',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /** Visible label while `loading`; falls back to the normal children. */
  loadingLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, asChild, loading, loadingLabel, children, disabled, ...props },
  ref,
) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      ref={ref}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          {loadingLabel ?? children}
        </>
      ) : (
        children
      )}
    </Component>
  );
});

export { buttonVariants };
