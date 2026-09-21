import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/feedback/states';
import { useToast } from '@/components/ui/toast';
import { routeSchema } from '@/lib/validation';
import type { RouteFormValues } from '@/lib/validation';
import { toAppError } from '@/lib/errors';
import { useActiveDepot, useAuth } from '@/features/auth/session';
import { useRoute, useSaveRoute } from '@/features/fleet/api';
import { ROUTE_STATUSES } from '@domain/types.ts';

/**
 * Add or edit a route.
 *
 * The expected distance and its tolerance are the two numbers the whole
 * anomaly engine hangs off, so the form explains what each one does rather
 * than just labelling them.
 */
export default function RouteFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { routeId } = useParams<{ routeId: string }>();
  const { toast } = useToast();
  const activeDepot = useActiveDepot();
  const { identity } = useAuth();

  const existing = useRoute(routeId);
  const save = useSaveRoute();
  const isEditing = Boolean(routeId);

  const form = useForm<RouteFormValues>({
    resolver: zodResolver(routeSchema),
    defaultValues: {
      name: '',
      code: '',
      depot_id: activeDepot?.id ?? '',
      origin: '',
      destination: '',
      expected_distance_km: '',
      distance_tolerance_pct: 10,
      typical_duration_minutes: '',
      status: 'ACTIVE',
      notes: '',
    },
  });

  useEffect(() => {
    if (!existing.data) return;
    const route = existing.data;
    form.reset({
      name: route.name,
      code: route.code,
      depot_id: route.depot_id,
      origin: route.origin,
      destination: route.destination,
      expected_distance_km: route.expected_distance_km,
      distance_tolerance_pct: route.distance_tolerance_pct,
      typical_duration_minutes: route.typical_duration_minutes ?? '',
      status: route.status,
      notes: route.notes ?? '',
    });
  }, [existing.data, form]);

  const error = (name: keyof RouteFormValues): string | undefined => {
    const message = form.formState.errors[name]?.message;
    return message ? t(message as string) : undefined;
  };

  const onSubmit = form.handleSubmit(async (raw) => {
    const values = routeSchema.parse(raw);
    try {
      await save.mutateAsync({ id: routeId, values });
      toast({
        tone: 'success',
        title: t(isEditing ? 'routes.updated' : 'routes.created', { name: values.name }),
      });
      navigate('/fleet/routes', { replace: true });
    } catch (caught) {
      const appError = toAppError(caught);
      if (appError.kind === 'CONFLICT') {
        form.setError('code', { message: 'validation.routeCodeTaken' });
        return;
      }
      toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
    }
  });

  if (isEditing && existing.isLoading) return <SkeletonList count={4} />;
  if (isEditing && existing.isError) {
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 pb-24">
      <PageHeader
        backTo="/fleet/routes"
        title={isEditing ? t('actions.edit') : t('routes.addTitle')}
        description={isEditing ? undefined : t('routes.addSubtitle')}
      />

      <Card>
        <CardContent className="space-y-4 pt-4">
          <Field
            label={t('routes.name')}
            hint={t('routes.nameHint')}
            error={error('name')}
            required
            requiredLabel={t('a11y.requiredField')}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('name')}
                invalid={Boolean(form.formState.errors.name)}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('routes.code')}
              error={error('code')}
              required
              requiredLabel={t('a11y.requiredField')}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  {...form.register('code')}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  invalid={Boolean(form.formState.errors.code)}
                />
              )}
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
                  <SelectTrigger
                    id={fieldProps.id}
                    invalid={Boolean(form.formState.errors.depot_id)}
                  >
                    <SelectValue placeholder={t('depots.selectDepot')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(identity?.depots ?? []).map((depot) => (
                      <SelectItem key={depot.id} value={depot.id}>
                        {depot.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('routes.origin')}
              error={error('origin')}
              required
              requiredLabel={t('a11y.requiredField')}
            >
              {(fieldProps) => <Input {...fieldProps} {...form.register('origin')} />}
            </Field>
            <Field
              label={t('routes.destination')}
              error={error('destination')}
              required
              requiredLabel={t('a11y.requiredField')}
            >
              {(fieldProps) => <Input {...fieldProps} {...form.register('destination')} />}
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-4">
          <Field
            label={t('routes.expectedDistance')}
            hint={t('routes.expectedDistanceHint')}
            error={error('expected_distance_km')}
            required
            requiredLabel={t('a11y.requiredField')}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('expected_distance_km')}
                inputMode="decimal"
                className="tabular"
                invalid={Boolean(form.formState.errors.expected_distance_km)}
              />
            )}
          </Field>

          <Field
            label={t('routes.tolerance')}
            hint={t('routes.toleranceHint')}
            error={error('distance_tolerance_pct')}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('distance_tolerance_pct')}
                inputMode="decimal"
                className="tabular"
              />
            )}
          </Field>

          <Field label={t('routes.typicalDuration')} error={error('typical_duration_minutes')}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('typical_duration_minutes')}
                inputMode="numeric"
                className="tabular"
              />
            )}
          </Field>

          <Field label={t('routes.status')} error={error('status')}>
            {(fieldProps) => (
              <Select
                value={form.watch('status')}
                onValueChange={(value) =>
                  form.setValue('status', value as RouteFormValues['status'])
                }
              >
                <SelectTrigger id={fieldProps.id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUTE_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`status.route.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field label={t('routes.notes')} error={error('notes')}>
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
