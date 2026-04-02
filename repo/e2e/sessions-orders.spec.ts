import { expect, test } from '@playwright/test';

async function loginAs(page: import('@playwright/test').Page, username: string, password: string) {
  await page.goto('/login');
  await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(admin|kiosk)/, { timeout: 15_000 });
}

test('auditor sees sessions page in read-only mode', async ({ page }) => {
  await loginAs(page, 'auditor', 'ChargeBay#Aud01');
  await page.goto('/admin/sessions');
  await expect(page.locator('h1:has-text("Sessions & Orders")')).toBeVisible({ timeout: 15_000 });
  // Auditor should NOT see Actions column header
  const actionHeaders = page.locator('th:has-text("Actions")');
  await expect(actionHeaders).toHaveCount(0);
});

test('auditor cannot access import page', async ({ page }) => {
  await loginAs(page, 'auditor', 'ChargeBay#Aud01');
  await page.goto('/admin/import');
  // Should show Forbidden
  await expect(page.locator('text=Forbidden')).toBeVisible({ timeout: 15_000 });
});

test('auditor sees read-only dashboard without mutation buttons', async ({ page }) => {
  await loginAs(page, 'auditor', 'ChargeBay#Aud01');
  await page.goto('/admin/dashboard');
  await expect(page.locator('h1:has-text("Admin Dashboard")')).toBeVisible({ timeout: 15_000 });
  // Should NOT see Export/Import/Archive buttons
  await expect(page.locator('button:has-text("Export Package")')).toHaveCount(0);
  await expect(page.locator('button:has-text("Import Package")')).toHaveCount(0);
  await expect(page.locator('button:has-text("Run Archiving")')).toHaveCount(0);
});
