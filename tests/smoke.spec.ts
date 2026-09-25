import { test, expect } from '@playwright/test';

test('home page loads without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator('body')).toBeVisible();
  await page.screenshot({ path: 'test-results/home.png', fullPage: true });

  expect(errors).toEqual([]);
});
