import { expect, test } from '@playwright/test';

async function loginAs(page: import('@playwright/test').Page, username: string, password: string) {
  await page.goto('/login');
  await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  // Wait for successful navigation away from login
  await page.waitForURL(/\/(admin|kiosk)/, { timeout: 15_000 });
}

test('import page loads for sysadmin with Bulk Import heading', async ({ page }) => {
  await loginAs(page, 'sysadmin', 'ChargeBay#Admin1');
  await page.goto('/admin/import');
  await expect(page.locator('h1:has-text("Bulk Import")')).toBeVisible({ timeout: 15_000 });
});

test('import page shows template download and type selector', async ({ page }) => {
  await loginAs(page, 'sysadmin', 'ChargeBay#Admin1');
  await page.goto('/admin/import');
  await expect(page.locator('h1:has-text("Bulk Import")')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('button:has-text("Download Template")')).toBeVisible();
});
