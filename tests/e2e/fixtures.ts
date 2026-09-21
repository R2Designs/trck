import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared fixtures.
 *
 * The seed (`supabase/seed.sql`) creates one organisation with two depots and
 * three accounts. Everything below refers to those, so a spec never has to
 * create its own fixture data and the tests stay readable.
 */

export const ACCOUNTS = {
  admin: { email: 'admin@trck.app', password: 'trck-demo-password' },
  northManager: { email: 'arun@trck.app', password: 'trck-demo-password' },
  southManager: { email: 'lakshmi@trck.app', password: 'trck-demo-password' },
} as const;

export type AccountName = keyof typeof ACCOUNTS;

export async function signIn(page: Page, account: AccountName): Promise<void> {
  const { email, password } = ACCOUNTS[account];
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/(home|admin)/);
}

export async function signOut(page: Page): Promise<void> {
  await page.goto('/more');
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Switches the interface language and waits for the change to take effect. */
export async function setLanguage(page: Page, label: RegExp): Promise<void> {
  await page.goto('/settings');
  await page.getByRole('combobox', { name: /language|மொழி|భాష|ಭಾಷೆ|भाषा/i }).click();
  await page.getByRole('option', { name: label }).click();
}

export const test = base.extend<{ signedInAs: AccountName }>({
  signedInAs: ['northManager', { option: true }],
});

export { expect };
