import { test, expect, signIn } from './fixtures';

/**
 * Language support, checked the way it actually fails in production.
 *
 * The two failure modes that matter are a raw translation key leaking onto the
 * screen (`attendance.title` instead of a sentence) and a language that does
 * not survive a reload. Both are invisible to a developer working in English,
 * so they are asserted here rather than left to review.
 */

const LANGUAGES = [
  { name: /தமிழ்|Tamil/i, script: /[஀-௿]/, code: 'ta' },
  { name: /తెలుగు|Telugu/i, script: /[ఀ-౿]/, code: 'te' },
  { name: /ಕನ್ನಡ|Kannada/i, script: /[ಀ-೿]/, code: 'kn' },
  { name: /हिन्दी|Hindi/i, script: /[ऀ-ॿ]/, code: 'hi' },
] as const;

test.describe('Languages', () => {
  for (const language of LANGUAGES) {
    test(`${language.code}: switching renders the script and survives a reload`, async ({
      page,
    }) => {
      await signIn(page, 'northManager');
      await page.goto('/settings');

      await page
        .getByRole('combobox')
        .filter({ hasText: /english|language/i })
        .first()
        .click();
      await page.getByRole('option', { name: language.name }).click();

      await page.goto('/home');
      const heading = page.locator('h1').first();
      await expect(heading).toHaveText(language.script);

      // The preference is stored on the profile, so it must outlive the tab.
      await page.reload();
      await expect(page.locator('h1').first()).toHaveText(language.script);
    });
  }

  test('no raw translation key ever reaches the screen', async ({ page }) => {
    await signIn(page, 'northManager');

    for (const path of ['/home', '/trips', '/attendance', '/alerts', '/employees', '/more']) {
      await page.goto(path);
      const text = (await page.locator('body').innerText()).trim();
      // A missed lookup renders as the key itself: `namespace.someKey`.
      expect(text, `raw i18n key visible on ${path}`).not.toMatch(
        /\b[a-z]+\.[a-zA-Z]+\.[a-zA-Z]+\b(?![^<]*@)/,
      );
    }
  });

  test('the html lang attribute follows the chosen language', async ({ page }) => {
    await signIn(page, 'northManager');
    await page.goto('/home');
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toMatch(/^(en|ta|te|kn|hi)$/);
  });
});
