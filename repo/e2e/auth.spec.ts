import { expect, test } from '@playwright/test';

test('app shell loads and redirects to login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/ChargeBay/i);
  // Wait for the login form to render after session restore completes
  await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
});

test('unauthenticated user cannot access admin routes', async ({ page }) => {
  await page.goto('/admin/users');
  // Should redirect to login
  await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
});

test('unauthenticated user cannot access kiosk routes', async ({ page }) => {
  await page.goto('/kiosk/reservations');
  await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
});

test('login with valid credentials succeeds', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
  await page.fill('#username', 'manager');
  await page.fill('#password', 'ChargeBay#Mgr01');
  await page.click('button[type="submit"]');
  // After login, SiteManager goes to kiosk - but first may see unlock modal
  // Since this is a fresh login (not restore), unlock modal should not appear
  await expect(page.locator('text=Kiosk Dashboard')).toBeVisible({ timeout: 15_000 });
});

test('login with invalid credentials shows error', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
  await page.fill('#username', 'manager');
  await page.fill('#password', 'wrongpassword1');
  await page.click('button[type="submit"]');
  await expect(page.locator('.error')).toBeVisible({ timeout: 10_000 });
});
