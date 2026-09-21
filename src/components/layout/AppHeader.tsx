import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, Search } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * The app bar.
 *
 * Two modes: a "home" bar carrying the brand and the global actions, and a
 * "page" bar carrying a back button and the screen's title. The back button is
 * on the left where Android users reach for it, and the destructive/primary
 * actions are never up here — they live in the sticky footer, within thumb
 * reach.
 */
export function AppHeader({
  title,
  subtitle,
  showBack,
  onBack,
  actions,
  unreadCount = 0,
  showBrand,
  className,
}: {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  actions?: React.ReactNode;
  unreadCount?: number;
  showBrand?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Regular app pages use the desktop sidebar for branding. On mobile that
  // sidebar disappears, so the compact app bar must carry the brand by
  // default. Focused flows keep their back button and step title instead.
  const displayBrand = showBrand ?? !showBack;

  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur',
        'pt-[env(safe-area-inset-top)]',
        className,
      )}
    >
      <div className="flex min-h-14 items-center gap-2 px-3">
        {showBack && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => (onBack ? onBack() : navigate(-1))}
            aria-label={t('actions.back')}
            className="-ml-1 shrink-0"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Button>
        )}

        {displayBrand ? (
          <Link
            to="/"
            className="flex min-w-0 items-center rounded-lg md:hidden"
            aria-label="trck"
          >
            <Logo markClassName="h-8 w-8" subtitle={subtitle} />
          </Link>
        ) : (
          <div className="min-w-0 flex-1">
            {title && <h1 className="truncate text-base font-bold leading-tight">{title}</h1>}
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {actions}
          <Button variant="ghost" size="icon" asChild aria-label={t('search.title')}>
            <Link to="/search">
              <Search className="size-5" aria-hidden />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" asChild className="relative">
            <Link
              to="/notifications"
              aria-label={t('a11y.notificationCount', { count: unreadCount })}
            >
              <Bell className="size-5" aria-hidden />
              {unreadCount > 0 && (
                <span
                  aria-hidden
                  className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full
                    bg-destructive px-1 text-[0.625rem] font-bold leading-4 text-destructive-foreground"
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
