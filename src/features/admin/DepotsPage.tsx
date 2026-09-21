import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Plus } from 'lucide-react';
import type { z } from 'zod';
import { PageHeader } from '@/components/common/PageHeader';
import { EntityCard } from '@/components/common/EntityCard';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  SheetContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { useToast } from '@/components/ui/toast';
import { depotSchema } from '@/lib/validation';
import { toAppError } from '@/lib/errors';
import { useBuses, useDepots, useEmployees } from '@/features/fleet/api';
import { useSaveDepot } from './api';

export default function DepotsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const depots = useDepots();
  const buses = useBuses();
  const employees = useEmployees();
  const save = useSaveDepot();

  const form = useForm<z.input<typeof depotSchema>>({
    resolver: zodResolver(depotSchema),
    defaultValues: { name: '', code: '', city: '', state: '', address_line: '' },
  });

  const submit = form.handleSubmit(async (raw) => {
    const values = depotSchema.parse(raw);
    try {
      await save.mutateAsync({ id: editingId ?? undefined, values });
      toast({
        tone: 'success',
        title: t(editingId ? 'depots.updated' : 'depots.created', { name: values.name }),
      });
      setOpen(false);
      setEditingId(null);
      form.reset();
    } catch (caught) {
      const appError = toAppError(caught);
      toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
    }
  });

  const error = (name: keyof z.input<typeof depotSchema>): string | undefined => {
    const message = form.formState.errors[name]?.message;
    return message ? t(message as string) : undefined;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('depots.title')}
        action={
          <Button
            size="md"
            onClick={() => {
              setEditingId(null);
              form.reset({ name: '', code: '', city: '', state: '', address_line: '' });
              setOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden />
            {t('depots.add')}
          </Button>
        }
      />

      {depots.isLoading && <SkeletonList count={2} />}
      {depots.isError && <ErrorState error={depots.error} onRetry={() => void depots.refetch()} />}

      {!depots.isLoading && (depots.data?.length ?? 0) === 0 && (
        <EmptyState icon={Building2} title={t('depots.title')} description={t('depots.add')} />
      )}

      <ul className="space-y-3">
        {depots.data?.map((depot) => {
          const busCount = (buses.data ?? []).filter((bus) => bus.depot_id === depot.id).length;
          const staffCount = (employees.data ?? []).filter(
            (employee) => employee.depot_id === depot.id,
          ).length;

          return (
            <li key={depot.id}>
              <EntityCard
                icon={Building2}
                title={depot.name}
                subtitle={[depot.code, depot.city].filter(Boolean).join(' · ')}
                meta={
                  <span className="text-xs text-muted-foreground">
                    {t('nav.buses')}: {busCount} · {t('nav.drivers')}: {staffCount}
                  </span>
                }
                onClick={() => {
                  setEditingId(depot.id);
                  form.reset({
                    name: depot.name,
                    code: depot.code,
                    city: depot.city ?? '',
                    state: depot.state ?? '',
                    address_line: depot.address_line ?? '',
                  });
                  setOpen(true);
                }}
              />
            </li>
          );
        })}
      </ul>

      <Dialog open={open} onOpenChange={setOpen}>
        <SheetContent closeLabel={t('actions.close')}>
          <DialogHeader>
            <DialogTitle>{editingId ? t('actions.edit') : t('depots.add')}</DialogTitle>
          </DialogHeader>

          <form onSubmit={submit} noValidate className="space-y-4">
            <Field
              label={t('depots.name')}
              error={error('name')}
              required
              requiredLabel={t('a11y.requiredField')}
            >
              {(fieldProps) => <Input {...fieldProps} {...form.register('name')} />}
            </Field>

            <Field
              label={t('depots.code')}
              hint={t('depots.codeHint')}
              error={error('code')}
              required
              requiredLabel={t('a11y.requiredField')}
            >
              {(fieldProps) => (
                <Input {...fieldProps} {...form.register('code')} autoCapitalize="characters" />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('depots.city')} error={error('city')}>
                {(fieldProps) => <Input {...fieldProps} {...form.register('city')} />}
              </Field>
              <Field label={t('depots.state')} error={error('state')}>
                {(fieldProps) => <Input {...fieldProps} {...form.register('state')} />}
              </Field>
            </div>

            <Field label={t('depots.address')} error={error('address_line')}>
              {(fieldProps) => <Input {...fieldProps} {...form.register('address_line')} />}
            </Field>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" size="lg">
                  {t('actions.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" size="lg" loading={save.isPending}>
                {t('actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </SheetContent>
      </Dialog>
    </div>
  );
}
