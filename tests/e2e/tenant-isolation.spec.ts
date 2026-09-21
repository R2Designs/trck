import type { Page } from '@playwright/test';
import { test, expect, signIn } from './fixtures';

/**
 * The security specs.
 *
 * These deliberately attack the app rather than use it: they navigate straight
 * to another depot's records by id, and they call PostgREST directly with the
 * signed-in manager's own access token and a forged organisation id. Both must
 * fail, and both must fail at the *database* — which is why the second test
 * bypasses the React layer entirely. A route guard that happens to hide the
 * page is not the property under test.
 *
 * `supabase/tests/10_rls_test.sql` asserts the same invariants against plain
 * SQL. These exist in addition because a policy can be perfectly correct and
 * still be bypassed by an application that queries with the wrong client.
 */

const FOREIGN_ORG = '99999999-9999-9999-9999-999999999999';

/** Reads the access token supabase-js stores for the current session. */
async function accessToken(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? '{}') as {
          access_token?: string;
        };
        if (parsed.access_token) return parsed.access_token;
      } catch {
        /* not the entry we want */
      }
    }
    return null;
  });
}

test.describe('Tenant and depot isolation', () => {
  test('a manager cannot open a bus from a depot they do not run', async ({ page }) => {
    const southBusId = process.env.E2E_SOUTH_BUS_ID;
    test.skip(!southBusId, 'set E2E_SOUTH_BUS_ID to a bus id in the South depot');

    await signIn(page, 'northManager');
    await page.goto(`/buses/${southBusId}`);

    // RLS returns no row, so the app shows its not-found state. What must never
    // appear is the other depot's registration number.
    await expect(page.getByText(/not found|couldn.t find|no longer available/i)).toBeVisible();
  });

  test('a forged organisation_id is refused by the database, not the UI', async ({ page }) => {
    await signIn(page, 'northManager');

    const token = await accessToken(page);
    expect(token, 'the signed-in session should expose an access token').toBeTruthy();

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
    test.skip(!supabaseUrl || !anonKey, 'Supabase credentials not provided to the test runner');

    // A genuine, signed request — exactly what a manager could send from their
    // own browser console. The only thing wrong with it is the tenant.
    const response = await page.request.post(`${supabaseUrl}/rest/v1/buses`, {
      headers: {
        apikey: anonKey as string,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      data: {
        organization_id: FOREIGN_ORG,
        depot_id: FOREIGN_ORG,
        registration_number: 'KA-99-XX-9999',
      },
    });

    expect(response.status(), 'a cross-tenant insert must not succeed').toBeGreaterThanOrEqual(400);
    expect(await response.text()).toMatch(/row-level security|violates|permission/i);
  });

  test('reading another tenant’s trips returns nothing rather than an error', async ({ page }) => {
    await signIn(page, 'northManager');

    const token = await accessToken(page);
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
    test.skip(!supabaseUrl || !anonKey || !token, 'Supabase credentials not provided');

    const response = await page.request.get(
      `${supabaseUrl}/rest/v1/trips?organization_id=eq.${FOREIGN_ORG}&select=id`,
      {
        headers: { apikey: anonKey as string, Authorization: `Bearer ${token}` },
      },
    );

    // The important shape: an empty result, not a 403. A filter on a column the
    // caller may not see must simply match nothing.
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual([]);
  });

  test('the audit log is not reachable by a manager', async ({ page }) => {
    await signIn(page, 'northManager');
    await page.goto('/admin/audit');

    // Either the guard redirects away, or the page renders its refusal. Both
    // are acceptable; showing another role's data is not.
    await expect(
      page
        .getByText(/not permitted|don.t have access|forbidden/i)
        .or(page.getByRole('heading', { name: /home|today/i })),
    ).toBeVisible();
  });
});
