import { test, expect, signIn, signOut, ACCOUNTS } from './fixtures';

test.describe('Authentication', () => {
  test('an administrator signs in and lands on the organisation dashboard', async ({ page }) => {
    await signIn(page, 'admin');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The admin dashboard shows depot-level totals; a manager's home does not.
    await expect(page.getByText(/depots/i).first()).toBeVisible();
  });

  test('a wrong password is refused with a translated message, not a raw error', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(ACCOUNTS.admin.email);
    await page.getByLabel(/password/i).fill('not-the-password');
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    // A raw Supabase/Postgres string leaking through would contain these.
    await expect(alert).not.toContainText(/invalid_grant|AuthApiError|PGRST/i);
  });

  test('a protected route bounces an anonymous visitor to sign-in', async ({ page }) => {
    await page.goto('/trips');
    await expect(page).toHaveURL(/\/login/);
  });

  test('signing out clears the session for the back button too', async ({ page }) => {
    await signIn(page, 'northManager');
    await signOut(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
  });
});
