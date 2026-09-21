import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { withTranslation } from 'react-i18next';
import type { WithTranslation } from 'react-i18next';
import { AlertOctagon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';
import { isProduction } from '@/app/config';

interface Props extends WithTranslation {
  children: ReactNode;
  /** Identifies which part of the tree failed, in the log. */
  boundary?: string;
}

interface State {
  error: Error | null;
  errorId: string | null;
}

/**
 * Top-level crash barrier.
 *
 * The manager sees a translated sentence and a Reload button; the stack trace
 * goes to the logger. The reference id is shown so that a phone call to
 * support can be matched to a log line.
 */
class ErrorBoundaryInner extends Component<Props, State> {
  override state: State = { error: null, errorId: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, errorId: crypto.randomUUID().slice(0, 8) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('Unhandled render error', {
      boundary: this.props.boundary ?? 'root',
      error,
      componentStack: info.componentStack?.split('\n').slice(0, 8).join('\n'),
      errorId: this.state.errorId,
    });
  }

  private reset = (): void => {
    this.setState({ error: null, errorId: null });
    window.location.reload();
  };

  override render(): ReactNode {
    const { error, errorId } = this.state;
    const { t, children } = this.props;
    if (!error) return children;

    return (
      <div
        role="alert"
        className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center"
      >
        <span className="grid size-14 place-items-center rounded-full bg-destructive-muted text-destructive">
          <AlertOctagon className="size-7" aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-bold">{t('errors.crashTitle')}</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">{t('errors.crashBody')}</p>
        <Button className="mt-6" onClick={this.reset}>
          {t('errors.reload')}
        </Button>
        {errorId && (
          <p className="mt-4 text-xs text-muted-foreground">
            {t('errors.errorReference', { id: errorId })}
          </p>
        )}
        {!isProduction && (
          <details className="mt-4 w-full max-w-lg text-left">
            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
              {t('errors.technicalDetails')}
            </summary>
            <pre className="mt-2 overflow-auto rounded-lg bg-muted p-3 text-left text-xs">
              {error.stack ?? error.message}
            </pre>
          </details>
        )}
      </div>
    );
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryInner);
