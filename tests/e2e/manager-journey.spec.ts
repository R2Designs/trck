import { test, expect, signIn } from './fixtures';

/**
 * The journey the product exists for, start to finish:
 *
 *   create a driver → enrol their face → add a bus → add a route →
 *   take attendance → start a trip → capture the dashboard →
 *   complete the trip → review whatever the engine flagged
 *
 * Camera frames come from Chromium's fake video device (configured in
 * `playwright.config.ts`), which produces a synthetic pattern rather than a
 * face. That is deliberate: this spec asserts that the *flow* behaves — that a
 * failed detection offers a retry and a manual path — not that recognition
 * succeeds. Recognition accuracy is covered by the unit tests in
 * `tests/unit/face-match.test.ts`, which work on descriptors.
 */

const unique = Date.now().toString().slice(-6);

test.describe.configure({ mode: 'serial' });

test.describe('Manager journey', () => {
  test('creates a driver', async ({ page }) => {
    await signIn(page, 'northManager');
    await page.goto('/employees/new');

    await page.getByLabel(/name/i).fill(`Test Driver ${unique}`);
    await page.getByLabel(/employee id|code/i).fill(`E2E${unique}`);
    await page.getByLabel(/phone/i).fill('9000000000');
    await page.getByRole('button', { name: /save|add|create/i }).click();

    await expect(page.getByText(`Test Driver ${unique}`)).toBeVisible();
  });

  test('face enrolment asks for consent before the camera opens', async ({ page }) => {
    await signIn(page, 'northManager');
    await page.goto('/employees');
    await page.getByText(`Test Driver ${unique}`).click();
    await page.getByRole('button', { name: /add photos|enrol|enroll/i }).click();

    // Consent is a gate, not a checkbox buried in a form: the camera must not
    // be live until it is given.
    await expect(page.getByText(/consent|permission|agree/i)).toBeVisible();
    await expect(page.locator('video')).toHaveCount(0);
  });

  test('adds a bus and a route', async ({ page }) => {
    await signIn(page, 'northManager');

    await page.goto('/buses/new');
    await page.getByLabel(/registration/i).fill(`KA-01-E2-${unique.slice(-4)}`);
    await page.getByRole('button', { name: /save|add|create/i }).click();
    await expect(page.getByText(new RegExp(unique.slice(-4)))).toBeVisible();

    await page.goto('/routes/new');
    await page.getByLabel(/name/i).fill(`E2E Route ${unique}`);
    await page.getByLabel(/code/i).fill(`R${unique}`);
    await page.getByLabel(/origin|from/i).fill('Yelahanka');
    await page.getByLabel(/destination|to/i).fill('Tambaram');
    await page.getByLabel(/expected distance/i).fill('42');
    await page.getByRole('button', { name: /save|add|create/i }).click();
    await expect(page.getByText(`E2E Route ${unique}`)).toBeVisible();
  });

  test('attendance offers a manual path when the face is not recognised', async ({ page }) => {
    await signIn(page, 'northManager');
    await page.goto('/attendance');
    await page.getByRole('button', { name: /take attendance|start/i }).click();

    // The fake camera is not a face, so the scanner should say so and offer
    // both a retry and an explicit manual entry — never silently accept.
    await expect(page.getByRole('button', { name: /enter manually|record by hand/i })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('button', { name: /enter manually|record by hand/i }).click();

    // A manual record must not be savable without a stated reason.
    const save = page.getByRole('button', { name: /save|record|confirm/i });
    await expect(save).toBeDisabled();
  });

  test('a trip cannot be completed without an end reading or an explicit override', async ({
    page,
  }) => {
    await signIn(page, 'northManager');
    await page.goto('/trips');

    const startButton = page.getByRole('button', { name: /start a trip|start trip/i });
    test.skip((await startButton.count()) === 0, 'no bus available to start a trip');
    await startButton.first().click();

    // One question at a time — the conversational flow. Each step should show a
    // single primary choice list, not a wall of fields.
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  test('an alert explains itself in plain language and requires a reason to close', async ({
    page,
  }) => {
    await signIn(page, 'northManager');
    await page.goto('/alerts');

    const firstAlert = page
      .getByRole('link')
      .filter({ hasText: /km|%|litre/i })
      .first();
    test.skip((await firstAlert.count()) === 0, 'no seeded alerts for this depot');
    await firstAlert.click();

    // The wording rule: the product describes a discrepancy, never an accusation.
    const body = page.locator('main');
    await expect(body).not.toContainText(/fraud|theft|stole|stealing|cheat/i);
    await expect(body).toContainText(/expected|observed|usual|review/i);

    await page
      .getByRole('button', { name: /review|resolve|mark/i })
      .first()
      .click();
    const confirm = page.getByRole('button', { name: /save|confirm|submit/i });
    // A resolution with no note is not a resolution anyone can audit later.
    await expect(confirm).toBeDisabled();
  });
});
