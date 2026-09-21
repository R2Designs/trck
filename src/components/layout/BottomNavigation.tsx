import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { Bus, CalendarCheck, Home, MoreHorizontal, Route as RouteIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Bottom navigation — the primary way around the app on a phone.
 *
 * Five destinations, matching the five things a manager actually does. Labels
 * are always visible (icon-only navigation is unusable for anyone who does not
 * already know the icons) and are allowed to wrap to two lines, because
 * "ಹಾಜರಾತಿ" and "హాజరు" are not the same width as "Attendance".
 */
interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
}

const ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: Home, end: true },
  { to: '/attendance', labelKey: 'nav.attendance', icon: CalendarCheck },
  { to: '/trips', labelKey: 'nav.trips', icon: RouteIcon },
  { to: '/fleet', labelKey: 'nav.fleet', icon: Bus },
  { to: '/more', labelKey: 'nav.more', icon: MoreHorizontal },
];

export function BottomNavigation({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('nav.mainMenu')}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/97 backdrop-blur',
        'pb-[env(safe-area-inset-bottom)] md:hidden',
        className,
      )}
    >
      <ul className="flex">
        {ITEMS.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-touch-lg flex-col items-center justify-center gap-1 px-1 py-2',
                  'text-[0.6875rem] font-semibold leading-tight transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={cn('size-5 shrink-0', isActive && 'stroke-[2.5]')}
                    aria-hidden
                  />
                  <span className="line-clamp-2 text-center">{t(item.labelKey)}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
