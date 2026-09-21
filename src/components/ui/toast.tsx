import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Transient messages.
 *
 * Toasts appear *above* the bottom navigation rather than over it, so the
 * confirmation of what just happened never hides the control the manager is
 * about to tap next. Errors stay until dismissed; successes fade.
 */
export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (message: Omit<ToastMessage, 'id'>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: 'border-success/40 bg-success-muted text-foreground' },
  error: { icon: XCircle, className: 'border-destructive/40 bg-destructive-muted text-foreground' },
  warning: { icon: AlertTriangle, className: 'border-warning/40 bg-warning-muted text-foreground' },
  info: { icon: Info, className: 'border-info/40 bg-info-muted text-foreground' },
};

const ICON_COLOURS: Record<ToastTone, string> = {
  success: 'text-success',
  error: 'text-destructive',
  warning: 'text-warning',
  info: 'text-info',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: string) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  const toast = useCallback((message: Omit<ToastMessage, 'id'>) => {
    setMessages((current) => [...current.slice(-2), { ...message, id: crypto.randomUUID() }]);
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="down" duration={5000}>
        {children}
        {messages.map((message) => {
          const { icon: Icon, className } = TONE_STYLES[message.tone];
          return (
            <ToastPrimitive.Root
              key={message.id}
              // Errors must not disappear while the manager is reading them.
              duration={message.tone === 'error' ? Infinity : 5000}
              onOpenChange={(open) => !open && dismiss(message.id)}
              className={cn(
                'pointer-events-auto flex w-full items-start gap-3 rounded-xl border-2 p-3.5 shadow-lg',
                'data-[state=open]:animate-slide-up',
                className,
              )}
            >
              <Icon
                className={cn('mt-0.5 size-5 shrink-0', ICON_COLOURS[message.tone])}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <ToastPrimitive.Title className="text-sm font-semibold">
                  {message.title}
                </ToastPrimitive.Title>
                {message.description && (
                  <ToastPrimitive.Description className="mt-0.5 text-sm text-muted-foreground">
                    {message.description}
                  </ToastPrimitive.Description>
                )}
                {message.action && (
                  <ToastPrimitive.Action
                    altText={message.action.label}
                    onClick={message.action.onClick}
                    className="mt-2 rounded-md text-sm font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    {message.action.label}
                  </ToastPrimitive.Action>
                )}
              </div>
              <ToastPrimitive.Close className="rounded-md p-1 text-muted-foreground hover:bg-black/5">
                <X className="size-4" aria-hidden />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport
          className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))]
            z-[60] mx-auto flex w-full max-w-md flex-col gap-2 px-4 outline-none
            md:bottom-4 md:right-4 md:left-auto md:mx-0 md:max-w-sm"
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
