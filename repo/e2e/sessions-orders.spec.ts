import { expect, test } from '@playwright/test';

async function loginAs(page: import('@playwright/test').Page, username: string, password: string) {
  await page.goto('/login');
  await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(admin|kiosk)/, { timeout: 15_000 });
}

/**
 * Navigate to a page and dismiss the unlock modal if it appears.
 * The modal appears after a full-page reload restores a saved session.
 * We wait briefly for any async restoreSession to complete before checking.
 */
async function gotoAndUnlock(
  page: import('@playwright/test').Page,
  url: string,
  password: string
) {
  await page.goto(url);
  // Give the async restoreSession useEffect time to run and potentially show the overlay.
  await page.waitForTimeout(1_000);
  const unlockBtn = page.locator('button:has-text("Unlock")');
  const unlockVisible = await unlockBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  if (unlockVisible) {
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("Unlock")');
    // Wait for unlock modal to disappear
    await expect(unlockBtn).toHaveCount(0, { timeout: 10_000 });
  }
}

// Role-matrix: Sessions & Orders control visibility across all roles.
// Attendant and SiteManager access sessions via /kiosk/sessions;
// SystemAdministrator and Auditor access /admin/sessions.

test('attendant sees Actions column for sessions at kiosk route', async ({ page }) => {
  await loginAs(page, 'attendant', 'ChargeBay#Att01');
  await page.goto('/kiosk/sessions');
  await expect(page.locator('h1:has-text("Sessions & Orders")')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('th:has-text("Actions")')).toBeVisible();
});

test('manager sees Actions column for sessions at kiosk route', async ({ page }) => {
  await loginAs(page, 'manager', 'ChargeBay#Mgr01');
  await page.goto('/kiosk/sessions');
  await expect(page.locator('h1:has-text("Sessions & Orders")')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('th:has-text("Actions")')).toBeVisible();
});

test('sysadmin sees Actions column for sessions at admin route', async ({ page }) => {
  await loginAs(page, 'sysadmin', 'ChargeBay#Admin1');
  await page.goto('/admin/sessions');
  await expect(page.locator('h1:has-text("Sessions & Orders")')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('th:has-text("Actions")')).toBeVisible();
});

test('auditor sees sessions page in read-only mode', async ({ page }) => {
  await loginAs(page, 'auditor', 'ChargeBay#Aud01');
  await page.goto('/admin/sessions');
  await expect(page.locator('h1:has-text("Sessions & Orders")')).toBeVisible({ timeout: 15_000 });
  // Auditor should NOT see Actions column header
  const actionHeaders = page.locator('th:has-text("Actions")');
  await expect(actionHeaders).toHaveCount(0);
});

// Full workflow: reservation → check-in → active session → complete → order.
// Uses manager (SiteManager) who has access to all kiosk routes.
test('full workflow: reservation to active session to order', async ({ page }) => {
  const password = 'ChargeBay#Mgr01';
  await loginAs(page, 'manager', password);
  await gotoAndUnlock(page, '/kiosk/reservations', password);
  await expect(page.locator('h1:has-text("Reservations")')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.bay-grid')).toBeVisible();

  // Create a reservation
  await page.click('button:has-text("New Reservation")');
  await expect(page.locator('h3:has-text("New Reservation")')).toBeVisible({ timeout: 10_000 });

  // Select the first available bay
  const baySelect = page.locator('select').first();
  await baySelect.selectOption({ index: 1 });

  await page.fill('input[placeholder="Customer Name"]', 'Test Customer');
  await page.fill('input[placeholder="Customer Plate"]', 'ABC123');

  // Set start 10 minutes in the future and end 2 hours after that.
  // scheduledStart must be strictly greater than now per service validation.
  const pad = (n: number) => String(n).padStart(2, '0');
  const startDate = new Date(Date.now() + 10 * 60 * 1000);
  const startStr = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}T${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`;
  const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
  const endStr = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;

  const dtInputs = page.locator('input[type="datetime-local"]');
  await dtInputs.nth(0).fill(startStr);
  await dtInputs.nth(1).fill(endStr);

  await page.click('button:has-text("Save Reservation")');
  await expect(page.locator('h3:has-text("New Reservation")')).toHaveCount(0, { timeout: 10_000 });

  // The bay card should now have a Check In button
  const checkInBtn = page.locator('button:has-text("Check In")').first();
  await expect(checkInBtn).toBeVisible({ timeout: 10_000 });
  await checkInBtn.click();

  // Confirm arrival in the drawer
  await expect(page.locator('h3:has-text("Reservation Check-In")')).toBeVisible({ timeout: 10_000 });
  await page.click('button:has-text("Confirm Arrival")');
  await expect(page.locator('text=Arrival confirmed')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');

  // Navigate to sessions and complete the session
  await gotoAndUnlock(page, '/kiosk/sessions', password);
  await expect(page.locator('h1:has-text("Sessions & Orders")')).toBeVisible({ timeout: 15_000 });

  const completeBtn = page.locator('button:has-text("Complete Session")').first();
  await expect(completeBtn).toBeVisible({ timeout: 10_000 });
  await completeBtn.click();
  await expect(page.locator('button:has-text("Complete Session")')).toHaveCount(0, { timeout: 10_000 });

  // Switch to the Orders tab and verify an order was created
  await page.click('button:has-text("Orders")');
  await expect(page.locator('td:has-text("$")')).toBeVisible({ timeout: 10_000 });
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
