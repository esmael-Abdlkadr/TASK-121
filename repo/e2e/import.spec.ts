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

async function gotoAndUnlock(
  page: import('@playwright/test').Page,
  url: string,
  password: string
) {
  await page.goto(url);
  await page.waitForTimeout(1_000);
  const unlockBtn = page.locator('button:has-text("Unlock")');
  const unlockVisible = await unlockBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  if (unlockVisible) {
    await page.fill('input[type="password"]', password);
    await unlockBtn.click();
    await expect(unlockBtn).toHaveCount(0, { timeout: 10_000 });
  }
}

function csvUpload(name: string, csv: string) {
  return `e2e/fixtures/${name}`;
}

test('import page shows validation error details for malformed CSV rows', async ({ page }) => {
  await loginAs(page, 'sysadmin', 'ChargeBay#Admin1');
  await gotoAndUnlock(page, '/admin/import', 'ChargeBay#Admin1');
  await expect(page.locator('h1:has-text("Bulk Import")')).toBeVisible({ timeout: 15_000 });

  await page.setInputFiles('input[type="file"]', csvUpload('invalid-reservations.csv', ''));
  await expect(page.locator('h2:has-text("Step 2 - Field Mapping")')).toBeVisible({ timeout: 10_000 });

  await page.click('button:has-text("Validate")');

  await expect(page.locator('text=Rows found: 1, valid: 0, invalid: 1')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('li:has-text("IMPORT_DATE_FORMAT_INVALID")')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('button:has-text("Start Import")')).toBeDisabled();
  await expect(page.locator('text=No import history yet.')).toBeVisible();
});

test('import success updates history and duplicate upload is rejected without new history rows', async ({ page }) => {
  await loginAs(page, 'sysadmin', 'ChargeBay#Admin1');
  await gotoAndUnlock(page, '/admin/import', 'ChargeBay#Admin1');
  await expect(page.locator('h1:has-text("Bulk Import")')).toBeVisible({ timeout: 15_000 });

  const upload = csvUpload('valid-reservations.csv', '');
  const historyRows = page.locator('h2:has-text("Import History") + table tbody tr');
  const initialHistoryCount = await historyRows.count();

  // First upload succeeds and writes a Complete history row.
  await page.setInputFiles('input[type="file"]', upload);
  await page.click('button:has-text("Validate")');
  await expect(page.locator('text=Rows found: 1, valid: 1, invalid: 0')).toBeVisible({ timeout: 10_000 });
  await page.click('button:has-text("Start Import")');

  await expect(historyRows).toHaveCount(initialHistoryCount + 1, { timeout: 10_000 });
  await expect(historyRows.first()).toContainText('reservations');
  await expect(historyRows.first()).toContainText('Complete');
  await expect(historyRows.first()).toContainText('1');

  // Re-upload identical file: dedupe must reject and keep history count unchanged.
  await page.setInputFiles('input[type="file"]', upload);
  await page.click('button:has-text("Validate")');
  await expect(page.locator('text=Rows found: 1, valid: 1, invalid: 0')).toBeVisible({ timeout: 10_000 });
  await page.click('button:has-text("Start Import")');

  await expect(page.locator('.error:has-text("IMPORT_DUPLICATE_FILE")')).toBeVisible({ timeout: 10_000 });
  await expect(historyRows).toHaveCount(initialHistoryCount + 1);
});
