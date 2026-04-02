import { expect, test } from '@playwright/test';

async function loginAs(page: import('@playwright/test').Page, username: string, password: string) {
  await page.goto('/login');
  await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(admin|kiosk)/, { timeout: 15_000 });
}

test('kiosk reservation page shows bay grid', async ({ page }) => {
  await loginAs(page, 'attendant', 'ChargeBay#Att01');
  await page.goto('/kiosk/reservations');
  await expect(page.locator('h1:has-text("Reservations")')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.bay-grid')).toBeVisible();
});

test('attendant can see New Reservation button', async ({ page }) => {
  await loginAs(page, 'attendant', 'ChargeBay#Att01');
  await page.goto('/kiosk/reservations');
  await expect(page.locator('button:has-text("New Reservation")')).toBeVisible({ timeout: 15_000 });
});
