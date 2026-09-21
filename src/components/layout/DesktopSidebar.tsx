import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import {
  Bus,
  Building2,
  CalendarCheck,
  Home,
  Route as RouteIcon,
  Settings,
  ShieldAlert,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { cn } from '@/lib/cn';
import type { Permission } from '@domain/roles.ts';

/**
 * Desktop navigation.
 *
 * Administrators do their oversight work at a desk, so on `md` and up the
 * bottom bar is replaced by a sidebar with the full, grouped destination list
 * — including the admin-only sections a manager never sees.
 */
interface Item {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
  permission?: Permission;
  adminOnly?: boolean;
}

const GROUPS: Array<{ labelKey?: string; items: Item[] }> = [
  {
    items: [{ to: '/', labelKey: 'nav.home', icon: Home, end: true }],
  },
  {
    labelKey: 'nav.attendance',
    items: [
      { to: '/attendance', labelKey: 'nav.attendance', icon: CalendarCheck },
      { to: '/trips', labelKey: 'nav.trips', icon: RouteIcon },
      { to: '/alerts', labelKey: 'nav.alerts', icon: ShieldAlert, permission: 'anomaly.view' },
    ],
  },
  {
    labelKey: 'nav.fleet',
    items: [
      { to: '/fleet/buses', labelKey: 'nav.buses', icon: Bus, permission: 'bus.view' },
      { to: '/fleet/drivers', labelKey: 'nav.drivers', icon: Users, permission: 'employee.view' },
      { to: '/fleet/routes', labelKey: 'nav.routes', icon: RouteIcon, permission: 'route.view' },
      { to: '/admin/depots', labelKey: 'nav.depots', icon: Building2, adminOnly: true },
    ],
  },
  { items: [{ to: '/settings', labelKey: 'nav.settings', icon: Settings }] },
];

export function DesktopSidebar({
  isAdmin,
  can,
  organizationName,
  alertCount,
}: {
  isAdmin: boolean;
  can: (permission: Permission) => boolean;
  organizationName?: string;
  alertCount?: number;
}) {
  const { t } = useTranslation();

  return (
    <aside
      aria-label={t('nav.mainMenu')}
      className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-card md:flex"
    >
      <div className="flex h-16 shrink-0 items-center border-b border-border px-4">
        <Logo markClassName="h-8 w-8" subtitle={organizationName} />
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto p-3">
        {GROUPS.map((group, index) => {
          const items = group.items.filter((item) => {
            if (item.adminOnly && !isAdmin) return false;
            if (item.permission && !can(item.permission)) return false;
            return true;
          });
          if (items.length === 0) return null;

          return (
            <div key={group.labelKey ?? index}>
              {group.labelKey && (
                <p className="px-3 pb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {t(group.labelKey)}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          'flex min-h-touch items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          isActive
                            ? 'bg-primary-muted font-semibold text-primary'
                            : 'text-foreground hover:bg-muted',
                        )
                      }
                    >
                      <item.icon className="size-[1.125rem] shrink-0" aria-hidden />
                      <span className="truncate">{t(item.labelKey)}</span>
                      {item.to === '/alerts' && (alertCount ?? 0) > 0 && (
                        <span
                          className="tabular ml-auto min-w-5 rounded-full bg-warning px-1.5 py-0.5 text-center text-[0.6875rem] font-bold leading-none text-warning-foreground"
                          aria-label={`${t('nav.alerts')}: ${alertCount}`}
                        >
                          {(alertCount ?? 0) > 99 ? '99+' : alertCount}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
