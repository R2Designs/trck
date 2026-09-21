import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  FileText,
  Globe,
  LogOut,
  ScrollText,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  UserCog,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { EntityCard, initialsOf } from '@/components/common/EntityCard';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth, useActiveDepot } from '@/features/auth/session';
import { currentLocale, LANGUAGES } from '@/i18n';

/**
 * The "More" tab.
 *
 * Everything that does not deserve a slot in the bottom bar but that a manager
 * still needs to reach in one tap — including the language switcher, which is
 * here as well as in Settings because it is the single setting most likely to
 * be needed urgently by someone who cannot read the current one.
 */
export default function MorePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { identity, isAdmin, can, signOut, setLocale } = useAuth();
  const depot = useActiveDepot();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const language = LANGUAGES.find((option) => option.code === currentLocale());

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.more')} />

      <Card>
        <CardContent className="flex items-center gap-3 pt-4">
          <span
            className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-base font-bold text-primary-foreground"
            aria-hidden
          >
            {initialsOf(identity?.profile.full_name ?? '?')}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{identity?.profile.full_name}</p>
            <p className="truncate text-sm text-muted-foreground">{identity?.profile.email}</p>
            {depot && <p className="truncate text-xs text-muted-foreground">{depot.name}</p>}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {can('report.view') && (
          <EntityCard to="/reports" icon={FileText} title={t('nav.reports')} />
        )}
        {can('anomaly.view') && (
          <EntityCard to="/alerts" icon={ShieldAlert} title={t('nav.alerts')} />
        )}
        <EntityCard to="/settings" icon={Settings} title={t('nav.settings')} />

        {isAdmin && (
          <>
            <EntityCard to="/admin/managers" icon={UserCog} title={t('nav.managers')} />
            <EntityCard to="/admin/depots" icon={Building2} title={t('nav.depots')} />
            <EntityCard
              to="/admin/thresholds"
              icon={SlidersHorizontal}
              title={t('settings.thresholds')}
            />
            <EntityCard to="/admin/audit" icon={ScrollText} title={t('nav.auditLog')} />
          </>
        )}
      </div>

      <Card>
        <CardContent className="flex items-center justify-between gap-3 pt-4">
          <span className="flex items-center gap-2.5">
            <Globe className="size-5 text-muted-foreground" aria-hidden />
            <span>
              <span className="block text-sm font-semibold">{t('language.label')}</span>
              <span className="block text-xs text-muted-foreground">{language?.label}</span>
            </span>
          </span>
          <LanguageSwitcher onChange={(locale) => setLocale(locale)} />
        </CardContent>
      </Card>

      <Button variant="outline" size="lg" block onClick={() => setConfirmSignOut(true)}>
        <LogOut className="size-5" aria-hidden />
        {t('nav.signOut')}
      </Button>

      <ConfirmDialog
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title={t('settings.signOutTitle')}
        description={t('settings.signOutBody')}
        confirmLabel={t('nav.signOut')}
        tone="destructive"
        onConfirm={async () => {
          await signOut();
          navigate('/login', { replace: true });
        }}
      />
    </div>
  );
}
