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
import { employeeSchema } from '@/lib/validation';
import type { EmployeeFormValues } from '@/lib/validation';
import { toAppError } from '@/lib/errors';
import { useActiveDepot, useAuth } from '@/features/auth/session';
import { useEmployee, useSaveEmployee } from '@/features/fleet/api';
import { EMPLOYEE_TYPES, EMPLOYMENT_STATUSES } from '@domain/types.ts';

/**
 * Add or edit a driver.
 *
 * Only four things are required — name, staff number, role and depot — because
 * a manager adding someone at 6 a.m. should not be blocked on a licence expiry
 * date they will look up later. After saving a new driver the flow continues
 * straight into face enrolment, which is the step that is easy to forget and
 * expensive to forget.
 */
export default function EmployeeFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { employeeId } = useParams<{ employeeId: string }>();
  const { toast } = useToast();
  const activeDepot = useActiveDepot();
  const { identity } = useAuth();

  const existing = useEmployee(employeeId);
  const save = useSaveEmployee();
  const isEditing = Boolean(employeeId);

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      employee_code: '',
      full_name: '',
      employee_type: 'DRIVER',
      depot_id: activeDepot?.id ?? '',
      phone: '',
      employment_status: 'ACTIVE',
      joining_date: '',
      licence_number: '',
      licence_expiry: '',
      emergency_contact_name: '',
      emergency_contact_phone: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (!existing.data) return;
    const employee = existing.data;
    form.reset({
      employee_code: employee.employee_code,
      full_name: employee.full_name,
      employee_type: employee.employee_type,
      depot_id: employee.depot_id,
      phone: employee.phone ?? '',
      employment_status: employee.employment_status,
      joining_date: employee.joining_date ?? '',
      licence_number: employee.licence_number ?? '',
      licence_expiry: employee.licence_expiry ?? '',
      emergency_contact_name: employee.emergency_contact_name ?? '',
      emergency_contact_phone: employee.emergency_contact_phone ?? '',
      notes: employee.notes ?? '',
    });
  }, [existing.data, form]);

  const error = (name: keyof EmployeeFormValues): string | undefined => {
    const message = form.formState.errors[name]?.message;
    return message ? t(message as string) : undefined;
  };

  const isDriver = form.watch('employee_type') === 'DRIVER';

  const onSubmit = form.handleSubmit(async (raw) => {
    const values = employeeSchema.parse(raw);
    try {
      const saved = await save.mutateAsync({ id: employeeId, values });
      toast({
        tone: 'success',
        title: t(isEditing ? 'employees.updated' : 'employees.created', { name: values.full_name }),
      });

      // New drivers go straight to face photos: adding them later is the step
      // that quietly never happens.
      if (!isEditing && saved && saved.employee_type === 'DRIVER') {
        navigate(`/fleet/drivers/${saved.id}/faces`, { replace: true });
        return;
      }
      navigate(saved ? `/fleet/drivers/${saved.id}` : '/fleet/drivers', { replace: true });
    } catch (caught) {
      const appError = toAppError(caught);
      if (appError.kind === 'CONFLICT') {
        form.setError('employee_code', { message: 'validation.employeeCodeTaken' });
        return;
      }
      toast({ tone: 'error', title: t(appError.messageKey, appError.messageParams) });
    }
  });

  if (isEditing && existing.isLoading) return <SkeletonList count={4} />;
  if (isEditing && existing.isError) {
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  }

  const depots = identity?.depots ?? [];

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 pb-24">
      <PageHeader
        backTo={isEditing && employeeId ? `/fleet/drivers/${employeeId}` : '/fleet/drivers'}
        title={isEditing ? t('employees.edit') : t('employees.addTitle')}
        description={isEditing ? undefined : t('employees.addSubtitle')}
      />

      {!isEditing && isDriver && (
        <ol className="grid grid-cols-2 gap-2" aria-label={t('employees.add')}>
          <li className="flex items-center gap-2 rounded-lg border border-primary/50 bg-primary/10 px-3 py-2 text-sm font-semibold">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              1
            </span>
            {t('employees.tabs.details')}
          </li>
          <li className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm text-muted-foreground">
            <span className="flex size-6 items-center justify-center rounded-full border border-border text-xs font-semibold">
              2
            </span>
            {t('employees.faceEnrolment')}
          </li>
        </ol>
      )}

      <Card>
        <CardContent className="space-y-4 pt-4">
          <Field
            label={t('employees.fullName')}
            error={error('full_name')}
            required
            requiredLabel={t('a11y.requiredField')}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('full_name')}
                autoComplete="name"
                invalid={Boolean(form.formState.errors.full_name)}
              />
            )}
          </Field>

          <Field
            label={t('employees.employeeCode')}
            hint={t('employees.employeeCodeHint')}
            error={error('employee_code')}
            required
            requiredLabel={t('a11y.requiredField')}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('employee_code')}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                invalid={Boolean(form.formState.errors.employee_code)}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('employees.type')} error={error('employee_type')}>
              {(fieldProps) => (
                <Select
                  value={form.watch('employee_type')}
                  onValueChange={(value) =>
                    form.setValue('employee_type', value as EmployeeFormValues['employee_type'])
                  }
                >
                  <SelectTrigger id={fieldProps.id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYEE_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`employeeType.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <Field
              label={t('employees.depot')}
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
                    {depots.map((depot) => (
                      <SelectItem key={depot.id} value={depot.id}>
                        {depot.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>

          <Field label={t('employees.phone')} error={error('phone')}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...form.register('phone')}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
              />
            )}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('employees.employmentStatus')} error={error('employment_status')}>
              {(fieldProps) => (
                <Select
                  value={form.watch('employment_status')}
                  onValueChange={(value) =>
                    form.setValue(
                      'employment_status',
                      value as EmployeeFormValues['employment_status'],
                    )
                  }
                >
                  <SelectTrigger id={fieldProps.id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`status.employment.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label={t('employees.joiningDate')} error={error('joining_date')}>
              {(fieldProps) => (
                <Input {...fieldProps} {...form.register('joining_date')} type="date" />
              )}
            </Field>
          </div>

          {isDriver && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('employees.licenceNumber')} error={error('licence_number')}>
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    {...form.register('licence_number')}
                    autoCapitalize="characters"
                    autoCorrect="off"
                  />
                )}
              </Field>
              <Field label={t('employees.licenceExpiry')} error={error('licence_expiry')}>
                {(fieldProps) => (
                  <Input {...fieldProps} {...form.register('licence_expiry')} type="date" />
                )}
              </Field>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('employees.emergencyContactName')}
              error={error('emergency_contact_name')}
            >
              {(fieldProps) => (
                <Input {...fieldProps} {...form.register('emergency_contact_name')} />
              )}
            </Field>
            <Field
              label={t('employees.emergencyContactPhone')}
              error={error('emergency_contact_phone')}
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  {...form.register('emergency_contact_phone')}
                  type="tel"
                  inputMode="tel"
                />
              )}
            </Field>
          </div>

          <Field label={t('employees.notes')} error={error('notes')}>
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
          {!isEditing && isDriver ? t('employees.saveAndAddPhotos') : t('actions.save')}
        </Button>
      </div>
    </form>
  );
}
