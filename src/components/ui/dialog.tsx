import { forwardRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Dialogs and bottom sheets.
 *
 * On a phone a centred modal is the wrong shape: it lands under the thumb's
 * reach and leaves the keyboard covering half of it. `Sheet` slides up from the
 * bottom edge instead, which is where a one-handed thumb already is.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const Overlay = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] animate-fade-in',
        className,
      )}
      {...props}
    />
  );
});
export { Overlay as DialogOverlay };

export const DialogContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { closeLabel?: string }
>(function DialogContent({ className, children, closeLabel, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
          'max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl animate-fade-in',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-3 top-3 grid size-9 place-items-center rounded-lg text-muted-foreground
            transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-5" aria-hidden />
          <span className="sr-only">{closeLabel ?? 'Close'}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

/** Bottom sheet — the default modal shape on mobile. */
export const SheetContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { closeLabel?: string }
>(function SheetContent({ className, children, closeLabel, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-2xl border-t border-border',
          'bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl animate-slide-up',
          'sm:inset-x-auto sm:left-1/2 sm:bottom-auto sm:top-1/2 sm:w-full sm:max-w-lg',
          'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border',
          className,
        )}
        {...props}
      >
        {/* Grab handle: a purely visual affordance that the sheet is draggable
            territory on touch devices. */}
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border sm:hidden" aria-hidden />
        {children}
        <DialogPrimitive.Close
          className="absolute right-3 top-3 grid size-9 place-items-center rounded-lg text-muted-foreground
            transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-5" aria-hidden />
          <span className="sr-only">{closeLabel ?? 'Close'}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 space-y-1.5 pr-9', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export const DialogTitle = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-lg font-bold leading-tight', className)}
      {...props}
    />
  );
});

export const DialogDescription = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
});
