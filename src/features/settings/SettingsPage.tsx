import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Building2, LogOut, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { PageHeader, DetailList, DetailRow } from '@/components/common/PageHeader';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/controls';
import { Field } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { config } from '@/app/config';
import { useTheme } from '@/app/theme';
import { useAuth, useActiveDepot } from '@/features/auth/session';
import { useUpdateUserPreferences } from './api';
import { getConnectionState } from '@/lib/network';

/**
 * Settings.
 *
 * Personal preferences only — the organisation-wide thresholds live behind
 * `/admin/thresholds`, because changing them changes how every trip in the
 * fleet is judged and that is not a personal preference.
 */
export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { identity, signOut, setLocale, activeDepotId, setActiveDepotId } = useAuth();
  const depot = useActiveDepot();
  const { preference, reduceMotion, setReduceMotion } = useTheme();
  const savePreferences = useUpdateUserPreferences();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const depots = identity?.depots ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title={t('settings.title')} />

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.account')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList>
            <DetailRow
              label={t('admin.managers.fullName')}
              value={identity?.profile.full_name ?? ''}
            />
            <DetailRow label={t('auth.email')} value={identity?.profile.email ?? ''} />
            <DetailRow
              label={t('settings.organisation')}
              value={identity?.organizationName ?? ''}
            />
            <DetailRow label={t('depots.singular')} value={depot?.name ?? t('common.none')} />
          </DetailList>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.preferences')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-semibold">{t('language.label')}</p>
            <LanguageSwitcher
              variant="list"
              onChange={async (locale) => {
                await setLocale(locale);
                toast({
                  tone: 'success',
                  title: t('language.changed', {
                    language: locale === 'en' ? 'English' : locale,
                  }),
                });
              }}
            />
          </div>

          <div>
            <p className="text-sm font-semibold">{t('theme.label')}</p>
            <p className="mb-2 mt-0.5 text-xs text-muted-foreground">{t('theme.description')}</p>
            <ThemeToggle />
          </div>

          {depots.length > 1 && (
            <Field label={t('settings.defaultDepot')}>
              {(fieldProps) => (
                <Select
                  value={activeDepotId ?? ''}
                  onValueChange={(value) => {
                    setActiveDepotId(value);
                    savePreferences.mutate({ default_depot_id: value });
                  }}
                >
                  <SelectTrigger id={fieldProps.id}>
                    <SelectValue placeholder={t('depots.selectDepot')} />
                  </SelectTrigger>
                  <SelectContent>
                    {depots.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          )}

          {/* Radix's Switch renders a button, not a checkbox, so wrapping it in
              a <label> associates nothing at all. The label is linked by id. */}
          <div className="flex min-h-touch items-center justify-between gap-4">
            <span id="reduce-motion-label" className="text-sm font-semibold">
              {t('settings.reduceMotion')}
            </span>
            <Switch
              aria-labelledby="reduce-motion-label"
              checked={reduceMotion}
              onCheckedChange={(checked) => {
                setReduceMotion(checked);
                savePreferences.mutate({ reduce_motion: checked, theme: preference });
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            {t('privacy.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{t('privacy.useBody')}</p>
          <p>{t('privacy.storeBody')}</p>
          <p className="text-xs">{t('privacy.legalNote')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MonitorSmartphone className="size-4 text-muted-foreground" aria-hidden />
            {t('settings.appInfo')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DetailList>
            <DetailRow
              label={t('app.version', { version: '' }).trim()}
              value={config.appVersion}
              mono
            />
            <DetailRow label={t('settings.status')} value={t(`network.${getConnectionState()}`)} />
            <DetailRow
              label={t('nav.fleet')}
              value={
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="size-3.5 text-muted-foreground" aria-hidden />
                  {identity?.organizationName}
                </span>
              }
            />
          </DetailList>
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
