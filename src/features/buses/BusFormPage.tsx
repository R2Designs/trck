import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/feedback/states';
import { useToast } from '@/components/ui/toast';
import { busSchema } from '@/lib/validation';
import type { BusFormValues } from '@/lib/validation';
import { toAppError } from '@/lib/errors';
import { useActiveDepot, useAuth } from '@/features/auth/session';
import { useBus, useDepots, useSaveBus } from '@/features/fleet/api';
import { BUS_STATUSES, DASHBOARD_TYPES, FUEL_TYPES } from '@domain/types.ts';

/**
 * Add or edit a bus.
 *
 * Grouped into "what we need" and "what helps later": only the registration
 * number, depot and current odometer are required to get a bus into service.
 * Tank capacity and rated efficiency improve the anomaly engine, and the form
 * says so rather than demanding them.
 */
export default function BusFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { busId } = useParams<{ busId: string }>();
  const { toast } = useToast();
  const activeDepot = useActiveDepot();
  const { identity } = useAuth();

  const depots = useDepots();
  const existing = useBus(busId);
  const save = useSaveBus();

  const isEditing = Boolean(busId);

  const form = useForm<BusFormValues>({
    resolver: zodResolver(busSchema),
    defaultValues: {
      registration_number: '',
      fleet_number: '',
      depot_id: activeDepot?.id ?? '',
      make: '',
      model: '',
      manufacturing_year: '',
      fuel_type: 'DIESEL',
      dashboard_type: 'UNKNOWN',
      tank_capacity_litres: '',
      nominal_efficiency_kmpl: '',
      starting_odometer_km: '',
      status: 'AVAILABLE',
      notes: '',
    },
  });

  useEffect(() => {
    if (!existing.data) return;
    const bus = existing.data;
    form.reset({
      registration_number: bus.registration_number,
      fleet_number: bus.fleet_number ?? '',
      depot_id: bus.depot_id,
      make: bus.make ?? '',
      model: bus.model ?? '',
      manufacturing_year: bus.manufacturing_year ?? '',
      fuel_type: bus.fuel_type,
      dashboard_type: bus.dashboard_type,
      tank_capacity_litres: bus.tank_capacity_litres ?? '',
      nominal_efficiency_kmpl: bus.nominal_efficiency_kmpl ?? '',
      starting_odometer_km: bus.current_odometer_km,
      status: bus.status,
      notes: bus.notes ?? '',
    });
  }, [existing.data, form]);

  const error = (name: keyof BusFormValues): string | undefined => {
    const message = form.formState.errors[name]?.message;
    return message ? t(message as string) : undefined;
  };

  const onSubmit = form.handleSubmit(async (raw) => {
    const values = busSchema.parse(raw);
    try {
      const saved = await save.mutateAsync({
        id: busId,
        values: {
          registration_number: values.registration_number,
          fleet_number: values.fleet_number,
          depot_id: values.depot_id,
          make: values.make,
          model: values.model,
          manufacturing_year: values.manufacturing_year ?? null,
          fuel_type: values.fuel_type,
          dashboard_type: values.dashboard_type,
          tank_capacity_litres: values.tank_capacity_litres ?? null,
          nominal_efficiency_kmpl: values.nominal_efficiency_kmpl ?? null,
          status: values.status,
          notes: values.notes,
          ...(isEditing
            ? {}
            : {
                starting_odometer_km: values.starting_odometer_km,
                current_odometer_km: values.starting_odometer_km,
              }),
        },
      });

      toast({
        tone: 'success',
        title: t(isEditing ? 'buses.updated' : 'buses.created', {
          registration: values.registration_number,
        }),
      });
      navigate(saved ? `/fleet/buses/${saved.id}` : '/fleet/buses', { replace: true });
    } catch (caught) {
      const appError = toAppError(caught);
      // A duplicate registration is a field problem, not a page problem.
      if (appError.kind === 'CONFLICT') {
        form.setError('registration_number', { message: 'validation.registrationTaken' });
        return;
      }
      toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
    }
  });

  if (isEditing && existing.isLoading) return <SkeletonList count={4} />;
  if (isEditing && existing.isError) {
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  }

  const availableDepots = identity?.depots ?? depots.data ?? [];

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 pb-24">
      <PageHeader
        backTo={isEditing && busId ? `/fleet/buses/${busId}` : '/fleet/buses'}
        title={isEditing ? t('actions.edit') : t('buses.addTitle')}
        description={isEditing ? undefined : t('buses.addSubtitle')}
      />

      <Card>
        <CardContent className="space-y-4 pt-4">
          <Field
            label={t('buses.registrationNumber')}
            hint={t('buses.registrationHint')}
            error={error('registration_number')}
            required
            requiredLabel={t('a11y.requiredField')}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('registration_number')}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="TN 01 AB 1234"
                invalid={Boolean(form.formState.errors.registration_number)}
              />
            )}
          </Field>

          <Field
            label={t('buses.fleetNumber')}
            hint={t('buses.fleetNumberHint')}
            error={error('fleet_number')}
          >
            {(fieldProps) => <Input {...fieldProps} {...form.register('fleet_number')} />}
          </Field>

          <Field
            label={t('depots.singular')}
            error={error('depot_id')}
            required
            requiredLabel={t('a11y.requiredField')}
          >
            {(fieldProps) => (
              <Select
                value={form.watch('depot_id')}
                onValueChange={(value) =>
                  form.setValue('depot_id', value, { shouldValidate: true })
                }
              >
                <SelectTrigger id={fieldProps.id} invalid={Boolean(form.formState.errors.depot_id)}>
                  <SelectValue placeholder={t('depots.selectDepot')} />
                </SelectTrigger>
                <SelectContent>
                  {availableDepots.map((depot) => (
                    <SelectItem key={depot.id} value={depot.id}>
                      {depot.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          {!isEditing && (
            <Field
              label={t('buses.startingOdometer')}
              error={error('starting_odometer_km')}
              required
              requiredLabel={t('a11y.requiredField')}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  {...form.register('starting_odometer_km')}
                  inputMode="decimal"
                  className="tabular"
                  invalid={Boolean(form.formState.errors.starting_odometer_km)}
                />
              )}
            </Field>
          )}

          <Field label={t('buses.status')} error={error('status')}>
            {(fieldProps) => (
              <Select
                value={form.watch('status')}
                onValueChange={(value) => form.setValue('status', value as BusFormValues['status'])}
              >
                <SelectTrigger id={fieldProps.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUS_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`status.bus.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('buses.make')} error={error('make')}>
              {(fieldProps) => <Input {...fieldProps} {...form.register('make')} />}
            </Field>
            <Field label={t('buses.model')} error={error('model')}>
              {(fieldProps) => <Input {...fieldProps} {...form.register('model')} />}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('buses.manufacturingYear')} error={error('manufacturing_year')}>
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  {...form.register('manufacturing_year')}
                  inputMode="numeric"
                  className="tabular"
                />
              )}
            </Field>
            <Field label={t('buses.fuelType')} error={error('fuel_type')}>
              {(fieldProps) => (
                <Select
                  value={form.watch('fuel_type')}
                  onValueChange={(value) =>
                    form.setValue('fuel_type', value as BusFormValues['fuel_type'])
                  }
                >
                  <SelectTrigger id={fieldProps.id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FUEL_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`fuelType.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>

          <Field
            label={t('buses.dashboardType')}
            hint={t('buses.dashboardTypeHint')}
            error={error('dashboard_type')}
          >
            {(fieldProps) => (
              <Select
                value={form.watch('dashboard_type')}
                onValueChange={(value) =>
                  form.setValue('dashboard_type', value as BusFormValues['dashboard_type'])
                }
              >
                <SelectTrigger id={fieldProps.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DASHBOARD_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`dashboardType.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('buses.tankCapacity')} error={error('tank_capacity_litres')}>
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  {...form.register('tank_capacity_litres')}
                  inputMode="decimal"
                  className="tabular"
                />
              )}
            </Field>
            <Field
              label={t('buses.nominalEfficiency')}
              hint={t('buses.nominalEfficiencyHint')}
              error={error('nominal_efficiency_kmpl')}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  {...form.register('nominal_efficiency_kmpl')}
                  inputMode="decimal"
                  className="tabular"
                />
              )}
            </Field>
          </div>

          <Field label={t('buses.notes')} error={error('notes')}>
            {(fieldProps) => <Textarea {...fieldProps} {...form.register('notes')} rows={3} />}
          </Field>
        </CardContent>
      </Card>

      <div className="sticky-cta flex gap-2">
        <Button type="button" variant="outline" size="lg" onClick={() => navigate(-1)}>
          {t('actions.cancel')}
        </Button>
        <Button
          type="submit"
          size="lg"
          className="flex-1"
          loading={form.formState.isSubmitting || save.isPending}
          loadingLabel={t('actions.saving')}
        >
          {t('actions.save')}
        </Button>
      </div>
    </form>
  );
}
