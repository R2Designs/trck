import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Plus, ShieldOff, UserCog } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { EntityCard, initialsOf } from '@/components/common/EntityCard';
import { Badge } from '@/components/common/StatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/controls';
import {
  Dialog,
  SheetContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { useToast } from '@/components/ui/toast';
import { formatDate, formatRelativeTime } from '@/lib/format';
import { inviteManagerSchema } from '@/lib/validation';
import { toAppError } from '@/lib/errors';
import { useDepots } from '@/features/fleet/api';
import { useInviteManager, useManagers, useResetManagerAccess, useSetManagerActive } from './api';
import type { ManagerRecord } from './api';
import type { z } from 'zod';

/**
 * Managers.
 *
 * Deactivation rather than deletion, always: a manager who recorded six months
 * of attendance cannot be removed without orphaning it. The depot assignment
 * here is the *only* thing that decides what a manager can see, so the form
 * says so plainly.
 */
export default function ManagersPage() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [includeInactive, setIncludeInactive] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirming, setConfirming] = useState<{
    manager: ManagerRecord;
    action: 'toggle' | 'reset';
  } | null>(null);

  const managers = useManagers({ includeInactive });
  const depots = useDepots();
  const invite = useInviteManager();
  const setActive = useSetManagerActive();
  const resetAccess = useResetManagerAccess();

  const form = useForm<z.input<typeof inviteManagerSchema>>({
    resolver: zodResolver(inviteManagerSchema),
    defaultValues: { full_name: '', email: '', depot_ids: [] },
  });

  const selectedDepots = form.watch('depot_ids') ?? [];

  const submitInvite = form.handleSubmit(async (values) => {
    try {
      await invite.mutateAsync({
        fullName: values.full_name,
        email: values.email,
        depotIds: values.depot_ids,
      });
      toast({ tone: 'success', title: t('admin.managers.inviteSent', { email: values.email }) });
      setInviteOpen(false);
      form.reset();
    } catch (caught) {
      const appError = toAppError(caught);
      toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
    }
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('admin.managers.title')}
        description={t('admin.managers.subtitle')}
        action={
          <Button size="md" onClick={() => setInviteOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('admin.managers.invite')}
          </Button>
        }
      />

      <label className="flex min-h-touch items-center gap-2.5 text-sm">
        <Checkbox
          checked={includeInactive}
          onCheckedChange={(checked) => setIncludeInactive(checked === true)}
        />
        {t('status.account.INACTIVE')}
      </label>

      {managers.isLoading && <SkeletonList count={3} />}
      {managers.isError && (
        <ErrorState error={managers.error} onRetry={() => void managers.refetch()} />
      )}

      {!managers.isLoading && (managers.data?.length ?? 0) === 0 && (
        <EmptyState
          icon={UserCog}
          title={t('admin.managers.title')}
          description={t('admin.managers.subtitle')}
          action={<Button onClick={() => setInviteOpen(true)}>{t('admin.managers.invite')}</Button>}
        />
      )}

      <ul className="space-y-3">
        {managers.data?.map((manager) => (
          <li key={manager.id}>
            <EntityCard
              avatarText={initialsOf(manager.full_name || manager.email)}
              title={manager.full_name || manager.email}
              subtitle={manager.email}
              meta={
                <>
                  <Badge tone={manager.status === 'ACTIVE' ? 'success' : 'neutral'} size="sm">
                    {t(`status.account.${manager.status}`)}
                  </Badge>
                  {manager.depots.map((depot) => (
                    <Badge key={depot.id} tone="primary" size="sm">
                      {depot.name}
                    </Badge>
                  ))}
                  <span className="text-xs text-muted-foreground">
                    {manager.last_login_at
                      ? `${t('admin.managers.lastLogin')}: ${formatRelativeTime(manager.last_login_at)}`
                      : t('admin.managers.neverSignedIn')}
                  </span>
                </>
              }
              trailing={
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('actions.resetAccess')}
                    onClick={() => setConfirming({ manager, action: 'reset' })}
                  >
                    <KeyRound className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={
                      manager.status === 'ACTIVE'
                        ? t('actions.deactivate')
                        : t('actions.reactivate')
                    }
                    onClick={() => setConfirming({ manager, action: 'toggle' })}
                  >
                    <ShieldOff className="size-4" aria-hidden />
                  </Button>
                </span>
              }
            />
            <p className="mt-1 px-3 text-xs text-muted-foreground">
              {t('admin.managers.created')}: {formatDate(manager.created_at)}
            </p>
          </li>
        ))}
      </ul>

      {/* --- Invite --------------------------------------------------- */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <SheetContent closeLabel={t('actions.close')}>
          <DialogHeader>
            <DialogTitle>{t('admin.managers.inviteTitle')}</DialogTitle>
            <DialogDescription>{t('admin.managers.inviteSubtitle')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={submitInvite} noValidate className="space-y-4">
            <Field
              label={t('admin.managers.fullName')}
              error={
                form.formState.errors.full_name
                  ? t(form.formState.errors.full_name.message as string)
                  : undefined
              }
              required
              requiredLabel={t('a11y.requiredField')}
            >
              {(fieldProps) => (
                <Input {...fieldProps} {...form.register('full_name')} autoComplete="name" />
              )}
            </Field>

            <Field
              label={t('admin.managers.email')}
              error={
                form.formState.errors.email
                  ? t(form.formState.errors.email.message as string)
                  : undefined
              }
              required
              requiredLabel={t('a11y.requiredField')}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  {...form.register('email')}
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                />
              )}
            </Field>

            <div>
              <p className="text-sm font-semibold">{t('admin.managers.depots')}</p>
              <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
                {t('admin.managers.depotsHint')}
              </p>
              <ul className="space-y-2">
                {(depots.data ?? []).map((depot) => {
                  const checked = selectedDepots.includes(depot.id);
                  return (
                    <li key={depot.id}>
                      <label className="flex min-h-touch cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(next) => {
                            const value = next === true;
                            form.setValue(
                              'depot_ids',
                              value
                                ? [...selectedDepots, depot.id]
                                : selectedDepots.filter((id) => id !== depot.id),
                              { shouldValidate: true },
                            );
                          }}
                        />
                        <span className="text-sm font-medium">{depot.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {form.formState.errors.depot_ids && (
                <p role="alert" className="mt-1.5 text-sm font-medium text-destructive">
                  {t(form.formState.errors.depot_ids.message as string)}
                </p>
              )}
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" size="lg">
                  {t('actions.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" size="lg" loading={invite.isPending}>
                {t('admin.managers.invite')}
              </Button>
            </DialogFooter>
          </form>
        </SheetContent>
      </Dialog>

      {/* --- Confirmations -------------------------------------------- */}
      <ConfirmDialog
        open={confirming?.action === 'toggle'}
        onOpenChange={(open) => !open && setConfirming(null)}
        tone={confirming?.manager.status === 'ACTIVE' ? 'destructive' : 'default'}
        title={t(
          confirming?.manager.status === 'ACTIVE'
            ? 'admin.managers.deactivateTitle'
            : 'admin.managers.reactivateTitle',
          { name: confirming?.manager.full_name ?? '' },
        )}
        description={t(
          confirming?.manager.status === 'ACTIVE'
            ? 'admin.managers.deactivateBody'
            : 'admin.managers.reactivateBody',
        )}
        loading={setActive.isPending}
        onConfirm={async () => {
          if (!confirming) return;
          try {
            await setActive.mutateAsync({
              userId: confirming.manager.id,
              active: confirming.manager.status !== 'ACTIVE',
            });
            toast({
              tone: 'success',
              title: t(
                confirming.manager.status === 'ACTIVE'
                  ? 'admin.managers.deactivated'
                  : 'admin.managers.reactivated',
                { name: confirming.manager.full_name },
              ),
            });
            setConfirming(null);
          } catch (caught) {
            const appError = toAppError(caught);
            toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
          }
        }}
      />

      <ConfirmDialog
        open={confirming?.action === 'reset'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t('admin.managers.resetAccessTitle', { name: confirming?.manager.full_name ?? '' })}
        description={t('admin.managers.resetAccessBody')}
        loading={resetAccess.isPending}
        onConfirm={async () => {
          if (!confirming) return;
          try {
            await resetAccess.mutateAsync({ userId: confirming.manager.id });
            toast({
              tone: 'success',
              title: t('admin.managers.resetSent', { email: confirming.manager.email }),
            });
            setConfirming(null);
          } catch (caught) {
            const appError = toAppError(caught);
            toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
          }
        }}
      />
    </div>
  );
}
