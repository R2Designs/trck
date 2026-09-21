import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { createQueryClient } from './query-client';
import { ThemeProvider } from './theme';
import { ToastProvider } from '@/components/ui/toast';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { AuthProvider } from '@/features/auth/session';

/**
 * Provider stack, outermost first.
 *
 * Order matters: the error boundary sits outside everything that can throw
 * during render, the router outside anything that navigates, and auth inside
 * the query client because loading an identity issues queries.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const routerBase = import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL;

  return (
    <ErrorBoundary boundary="root">
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter basename={routerBase}>
            <AuthProvider>
              <ToastProvider>{children}</ToastProvider>
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
