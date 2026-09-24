import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { ErrorState } from '@/components/feedback/states';
import { useAuth } from './session';
import { changeLanguage } from '@/i18n';
import { toAppError } from '@/lib/errors';
import { emailSchema } from '@/lib/validation';

const schema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'validation.required'),
});

type FormValues = z.infer<typeof schema>;

/**
 * Sign in.
 *
 * The language switcher sits *above* the form on purpose: someone who cannot
 * read "Email address" cannot be expected to find a setting buried behind it.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const { signIn, status } = useAuth();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await signIn(values.email, values.password);
    } catch (error) {
      const appError = toAppError(error);
      // Never reveal whether it was the email or the password that was wrong.
      setSubmitError(
        appError.kind === 'AUTH' || appError.message.toLowerCase().includes('invalid')
          ? Object.assign(appError, { messageKey: 'errors.notAuthorised' })
          : appError,
      );
    }
  });

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="flex justify-end p-4 pt-[calc(1rem+env(safe-area-inset-top))]">
        {/* Before sign-in there is no profile to store the choice against, so
            it stays device-local; `session.tsx` adopts the profile's language
            the moment one is known. */}
        <LanguageSwitcher onChange={(locale) => changeLanguage(locale)} />
      </div>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 pb-10">
        <div className="mb-8 text-center">
          <Logo className="justify-center" markClassName="h-14 w-14" showWordmark={false} />
          <h1 className="mt-5 text-2xl font-bold tracking-tight">{t('auth.signInTitle')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('auth.signInSubtitle')}</p>
        </div>

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {submitError != null && <ErrorState error={submitError} compact />}

          <Field
            label={t('auth.email')}
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
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t('auth.emailPlaceholder')}
                invalid={Boolean(form.formState.errors.email)}
              />
            )}
          </Field>

          <Field
            label={t('auth.password')}
            error={
              form.formState.errors.password
                ? t(form.formState.errors.password.message as string)
                : undefined
            }
            required
            requiredLabel={t('a11y.requiredField')}
          >
            {(fieldProps) => (
              <div className="relative">
                <Input
                  {...fieldProps}
                  {...form.register('password')}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder={t('auth.passwordPlaceholder')}
                  className="pr-12"
                  invalid={Boolean(form.formState.errors.password)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center
                    rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none
                    focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? (
                    <EyeOff className="size-5" aria-hidden />
                  ) : (
                    <Eye className="size-5" aria-hidden />
                  )}
                </button>
              </div>
            )}
          </Field>

          <Button
            type="submit"
            size="lg"
            block
            loading={form.formState.isSubmitting}
            loadingLabel={t('auth.signingIn')}
          >
            <LogIn className="size-5" aria-hidden />
            {t('auth.signIn')}
          </Button>

          <div className="text-center">
            <Link
              to="/forgot-password"
              className="inline-block rounded px-2 py-1 text-sm font-medium text-primary hover:underline"
            >
              {t('auth.forgotPassword')}
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
