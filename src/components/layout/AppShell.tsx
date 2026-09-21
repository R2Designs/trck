import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import { AppHeader } from './AppHeader';
import { BottomNavigation } from './BottomNavigation';
import { DesktopSidebar } from './DesktopSidebar';
import { OfflineBanner } from '@/components/feedback/OfflineBanner';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { SkeletonList } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/session';
import { useUnreadNotificationCount } from '@/features/notifications/api';
import { useOpenAnomalyCount } from '@/features/anomalies/api';
import { cn } from '@/lib/cn';

/**
 * The authenticated frame.
 *
 * Mobile: header, scrolling content, bottom navigation.
 * Desktop (md+): sidebar, header, wider content, no bottom bar.
 *
 * The skip link is the first focusable element on the page, which is what
 * makes the app navigable by keyboard without tabbing through the whole nav.
 */
export function AppShell({
  title,
  subtitle,
  showBack,
  headerActions,
  showBrand,
  contentClassName,
  children,
}: {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  headerActions?: React.ReactNode;
  showBrand?: boolean;
  contentClassName?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { identity, isAdmin, can } = useAuth();
  const unread = useUnreadNotificationCount();
  const openAlerts = useOpenAnomalyCount();

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main-content"
        className="sr-only-focusable absolute left-3 top-3 z-50 rounded-lg bg-primary px-4 py-2
          text-sm font-semibold text-primary-foreground"
      >
        {t('nav.skipToContent')}
      </a>

      <DesktopSidebar
        isAdmin={isAdmin}
        can={can}
        organizationName={identity?.organizationName}
        alertCount={openAlerts.data ?? 0}
      />

      <div className="md:pl-64">
        <AppHeader
          title={title}
          subtitle={subtitle}
          showBack={showBack}
          actions={headerActions}
          unreadCount={unread}
          showBrand={showBrand}
        />
        <OfflineBanner />

        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            'mx-auto w-full max-w-3xl px-4 pb-safe-bottom pt-4 md:max-w-6xl md:pb-10',
            contentClassName,
          )}
        >
          <ErrorBoundary boundary="page">
            <Suspense fallback={<SkeletonList />}>{children ?? <Outlet />}</Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <BottomNavigation />
    </div>
  );
}

/**
 * A page frame for focused, single-purpose flows — attendance, trip capture,
 * face enrolment. Deliberately has *no* bottom navigation: a manager halfway
 * through a face scan should finish or cancel, not wander off to Reports.
 */
export function FlowShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <AppHeader title={title} subtitle={subtitle} showBack onBack={onClose} />
      <OfflineBanner />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-2xl flex-1 px-4 pb-4 pt-4"
      >
        <ErrorBoundary boundary="flow">{children}</ErrorBoundary>
      </main>
      {footer && <div className="mx-auto w-full max-w-2xl px-4">{footer}</div>}
    </div>
  );
}
