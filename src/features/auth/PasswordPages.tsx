import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, MailCheck } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { ErrorState } from '@/components/feedback/states';
import { useAuth } from './session';
import { emailSchema, passwordSchema } from '@/lib/validation';

const requestSchema = z.object({
  email: emailSchema,
});

function AuthPageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        <Logo className="mb-8 justify-center" markClassName="h-12 w-12" showWordmark={false} />
        {children}
      </main>
    </div>
  );
}

/**
 * "I forgot my password".
 *
 * The confirmation is deliberately the same whether or not the address exists:
 * telling an attacker which emails are registered is an account-enumeration
 * hole, and the copy ("if that email is registered…") says so honestly.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const { requestPasswordReset } = useAuth();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const form = useForm<z.infer<typeof requestSchema>>({
    resolver: zodResolver(requestSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await requestPasswordReset(values.email);
      setSent(true);
    } catch (caught) {
      setError(caught);
    }
  });

  if (sent) {
    return (
      <AuthPageFrame>
        <div className="rounded-xl border border-success/35 bg-success-muted p-5 text-center">
          <MailCheck className="mx-auto size-8 text-success" aria-hidden />
          <p className="mt-3 text-sm">{t('auth.resetLinkSent')}</p>
        </div>
        <Button asChild variant="outline" block className="mt-5">
          <Link to="/login">{t('auth.backToSignIn')}</Link>
        </Button>
      </AuthPageFrame>
    );
  }

  return (
    <AuthPageFrame>
      <h1 className="text-xl font-bold">{t('auth.resetTitle')}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{t('auth.resetSubtitle')}</p>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {error != null && <ErrorState error={error} compact />}
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
              placeholder={t('auth.emailPlaceholder')}
              invalid={Boolean(form.formState.errors.email)}
            />
          )}
        </Field>
        <Button type="submit" size="lg" block loading={form.formState.isSubmitting}>
          {t('auth.sendResetLink')}
        </Button>
        <Button asChild variant="ghost" block>
          <Link to="/login">{t('auth.backToSignIn')}</Link>
        </Button>
      </form>
    </AuthPageFrame>
  );
}

const resetSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'validation.passwordMatch',
  });

/** Landing page for the emailed reset link. */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const { updatePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await updatePassword(values.password);
      setDone(true);
      // Force a fresh sign-in so every other device's session is invalidated.
      await signOut();
      setTimeout(() => navigate('/login', { replace: true }), 1800);
    } catch (caught) {
      setError(caught);
    }
  });

  if (done) {
    return (
      <AuthPageFrame>
        <div className="rounded-xl border border-success/35 bg-success-muted p-5 text-center">
          <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden />
          <p className="mt-3 text-sm">{t('auth.passwordUpdated')}</p>
        </div>
      </AuthPageFrame>
    );
  }

  return (
    <AuthPageFrame>
      <h1 className="text-xl font-bold">{t('auth.newPasswordTitle')}</h1>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {error != null && <ErrorState error={error} compact />}

        <Field
          label={t('auth.newPassword')}
          error={
            form.formState.errors.password
              ? t(form.formState.errors.password.message as string)
              : undefined
          }
          required
          requiredLabel={t('a11y.requiredField')}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              {...form.register('password')}
              type="password"
              autoComplete="new-password"
              invalid={Boolean(form.formState.errors.password)}
            />
          )}
        </Field>

        <Field
          label={t('auth.confirmPassword')}
          error={
            form.formState.errors.confirmPassword
              ? t(form.formState.errors.confirmPassword.message as string)
              : undefined
          }
          required
          requiredLabel={t('a11y.requiredField')}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              {...form.register('confirmPassword')}
              type="password"
              autoComplete="new-password"
              invalid={Boolean(form.formState.errors.confirmPassword)}
            />
          )}
        </Field>

        <Button type="submit" size="lg" block loading={form.formState.isSubmitting}>
          {t('auth.updatePassword')}
        </Button>
      </form>
    </AuthPageFrame>
  );
}
