import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldOff, UserX } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { useAuth } from './session';
import type { Permission } from '@domain/roles.ts';

/**
 * Route guards.
 *
 * These decide what to *render*. They are not the security boundary — RLS and
 * the RPC guards are. Removing a guard in devtools gets you an empty screen
 * and a 401, not somebody else's data.
 */

function FullPageMessage({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof ShieldOff;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Logo className="mb-8" markClassName="h-11 w-11" showWordmark={false} />
      <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-7" aria-hidden />
      </span>
      <h1 className="mt-4 text-lg font-bold">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Splash shown while the session and identity are resolving. */
export function AuthLoading() {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4"
      role="status"
      aria-live="polite"
    >
      <Logo markClassName="h-12 w-12" showWordmark={false} />
      <p className="text-sm text-muted-foreground">{t('app.loading')}</p>
    </div>
  );
}

export function RequireAuth() {
  const { status, signOut } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (status === 'loading') return <AuthLoading />;

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (status === 'no-access') {
    return (
      <FullPageMessage
        icon={UserX}
        title={t('auth.noAccessTitle')}
        body={t('auth.noAccessBody')}
        action={<Button onClick={() => void signOut()}>{t('nav.signOut')}</Button>}
      />
    );
  }

  if (status === 'deactivated') {
    return (
      <FullPageMessage
        icon={ShieldOff}
        title={t('auth.deactivatedTitle')}
        body={t('auth.deactivatedBody')}
        action={<Button onClick={() => void signOut()}>{t('nav.signOut')}</Button>}
      />
    );
  }

  return <Outlet />;
}

/** Guards a subtree behind a permission; redirects home when it is absent. */
export function RequirePermission({ permission }: { permission: Permission }) {
  const { can } = useAuth();
  return can(permission) ? <Outlet /> : <Navigate to="/" replace />;
}

export function RequireAdmin() {
  const { isAdmin } = useAuth();
  return isAdmin ? <Outlet /> : <Navigate to="/" replace />;
}
