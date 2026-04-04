import { expect, test } from '@playwright/test';

async function loginAs(page: import('@playwright/test').Page, username: string, password: string) {
  await page.goto('/login');
  await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
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
    await page.locator('input[type="password"]').fill(password, { force: true });
    await unlockBtn.click({ force: true });
    await expect(unlockBtn).toHaveCount(0, { timeout: 10_000 });
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const DB_NAME = 'chargebayOfflineConsole';

async function waitForSchedulerTick(page: import('@playwright/test').Page, ms = 65_000) {
  // Runtime scheduler intervals are 60s/30s; wait one full cycle with buffer.
  await page.waitForTimeout(ms);
}

async function markReservationPastNoShowDeadline(page: import('@playwright/test').Page, plate: string) {
  await page.evaluate(async ({ dbName, plateValue }) => {
    const openDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const tx = openDb.transaction('reservations', 'readwrite');
      const store = tx.objectStore('reservations');
      const reservations = await new Promise<any[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as any[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      const target = reservations.find((r) => r.customerPlate === plateValue || r.status === 'Scheduled');
      if (target) {
        target.noShowDeadline = Date.now() - 5_000;
        await new Promise<void>((resolve, reject) => {
          const req = store.put(target);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      openDb.close();
    }
  }, { dbName: DB_NAME, plateValue: plate });
}

async function backdateActiveSessionHeartbeat(page: import('@playwright/test').Page, ageMinutes: number) {
  await page.evaluate(async ({ dbName, minutes }) => {
    const openDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const tx = openDb.transaction('sessions_charging', 'readwrite');
      const store = tx.objectStore('sessions_charging');
      const sessions = await new Promise<any[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as any[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      for (const s of sessions) {
        if (s.status === 'Active') {
          s.heartbeatAt = Date.now() - minutes * 60_000;
          await new Promise<void>((resolve, reject) => {
            const req = store.put(s);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
        }
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      openDb.close();
    }
  }, { dbName: DB_NAME, minutes: ageMinutes });
}

async function getFirstReservationNoShowStatus(page: import('@playwright/test').Page) {
  return page.evaluate(async (dbName) => {
    const openDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const tx = openDb.transaction('reservations', 'readonly');
      const store = tx.objectStore('reservations');
      const reservations = await new Promise<any[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as any[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      return reservations.find((r) => r.status === 'NoShow')?.status ?? 'not found';
    } finally {
      openDb.close();
    }
  }, DB_NAME);
}

async function getFirstBayStatus(page: import('@playwright/test').Page) {
  return page.evaluate(async (dbName) => {
    const openDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const tx = openDb.transaction('bays', 'readonly');
      const store = tx.objectStore('bays');
      const bays = await new Promise<any[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as any[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      return bays[0]?.status ?? 'unknown';
    } finally {
      openDb.close();
    }
  }, DB_NAME);
}

// ─── 1. No-show auto-cancel scheduler: bay released, status → NoShow ──────
test('no-show auto-cancel timer releases bay and marks reservation NoShow', async ({ page }) => {
  test.setTimeout(180_000);
  const password = 'ChargeBay#Mgr01';
  await loginAs(page, 'manager', password);
  await gotoAndUnlock(page, '/kiosk/reservations', password);
  await expect(page.locator('h1:has-text("Reservations")')).toBeVisible({ timeout: 15_000 });

  // Create a reservation
  await page.click('button:has-text("New Reservation")');
  await expect(page.locator('h3:has-text("New Reservation")')).toBeVisible({ timeout: 10_000 });
  const baySelect = page.locator('select').first();
  await baySelect.selectOption({ index: 1 });
  await page.fill('input[placeholder="Customer Name"]', 'NoShow Timer');
  await page.fill('input[placeholder="Customer Plate"]', 'NS001');

  const startDate = new Date(Date.now() + 10 * 60 * 1000);
  const startStr = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}T${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`;
  const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
  const endStr = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;
  const dtInputs = page.locator('input[type="datetime-local"]');
  await dtInputs.nth(0).fill(startStr);
  await dtInputs.nth(1).fill(endStr);
  await page.click('button:has-text("Save Reservation")');
  await expect(page.locator('h3:has-text("New Reservation")')).toHaveCount(0, { timeout: 10_000 });

  // Backdate noShowDeadline and wait for 60s runtime scheduler cycle.
  await markReservationPastNoShowDeadline(page, 'NS001');
  await waitForSchedulerTick(page);

  // Verify: bay should be Available and reservation should be NoShow
  // Reload the page to see updated bay state
  await gotoAndUnlock(page, '/kiosk/reservations', password);
  await expect(page.locator('h1:has-text("Reservations")')).toBeVisible({ timeout: 15_000 });

  // The bay card should show Available (no "Check In" button since reservation is gone)
  // Verify via IndexedDB that the reservation is NoShow
  const status = await getFirstReservationNoShowStatus(page);
  expect(status).toBe('NoShow');

  // Verify the bay was freed
  const bayStatus = await getFirstBayStatus(page);
  expect(bayStatus).toBe('Available');
});

// ─── 2. Heartbeat-timeout anomaly escalation + visible UI outcome ─────────
test('heartbeat timeout escalates session to Anomaly with visible Resolve button', async ({ page }) => {
  test.setTimeout(180_000);
  const password = 'ChargeBay#Mgr01';
  await loginAs(page, 'manager', password);
  await gotoAndUnlock(page, '/kiosk/reservations', password);
  await expect(page.locator('h1:has-text("Reservations")')).toBeVisible({ timeout: 15_000 });

  // Create a reservation
  await page.click('button:has-text("New Reservation")');
  await expect(page.locator('h3:has-text("New Reservation")')).toBeVisible({ timeout: 10_000 });
  const baySelect = page.locator('select').first();
  await baySelect.selectOption({ index: 1 });
  await page.fill('input[placeholder="Customer Name"]', 'Anomaly Timer');
  await page.fill('input[placeholder="Customer Plate"]', 'ANM001');

  const startDate = new Date(Date.now() + 10 * 60 * 1000);
  const startStr = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}T${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`;
  const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
  const endStr = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;
  const dtInputs = page.locator('input[type="datetime-local"]');
  await dtInputs.nth(0).fill(startStr);
  await dtInputs.nth(1).fill(endStr);
  await page.click('button:has-text("Save Reservation")');
  await expect(page.locator('h3:has-text("New Reservation")')).toHaveCount(0, { timeout: 10_000 });

  // Check in the reservation
  const checkInBtn = page.locator('button:has-text("Check In")').first();
  await expect(checkInBtn).toBeVisible({ timeout: 10_000 });
  await checkInBtn.click();
  await expect(page.locator('h3:has-text("Reservation Check-In")')).toBeVisible({ timeout: 10_000 });
  await page.click('button:has-text("Confirm Arrival")');
  await expect(page.locator('text=Arrival confirmed')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');

  // Backdate heartbeat and wait for runtime anomaly scheduler cycle (60s).
  await backdateActiveSessionHeartbeat(page, 31);
  await waitForSchedulerTick(page);

  // Navigate to sessions page and verify Anomaly status is visible
  await gotoAndUnlock(page, '/kiosk/sessions', password);
  await expect(page.locator('h1:has-text("Sessions & Orders")')).toBeVisible({ timeout: 15_000 });

  // Filter to Anomaly sessions
  await page.selectOption('select', 'Anomaly');
  await expect(page.locator('td:has-text("Anomaly")')).toBeVisible({ timeout: 10_000 });

  // Manager should see the Resolve button
  await expect(page.locator('button:has-text("Resolve")')).toBeVisible({ timeout: 5_000 });
});

// ─── 3. Notification retry flow: Failed → retryFailed → Delivered ─────────
test('notification retry: failed notification is retried and becomes Delivered', async ({ page }) => {
  test.setTimeout(180_000);
  const password = 'ChargeBay#Mgr01';
  await loginAs(page, 'manager', password);

  // Insert a Failed notification directly via IndexedDB
  await page.evaluate(async (dbName) => {
    const openDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const userTx = openDb.transaction('users', 'readonly');
      const usersStore = userTx.objectStore('users');
      const users = await new Promise<any[]>((resolve, reject) => {
        const req = usersStore.getAll();
        req.onsuccess = () => resolve((req.result as any[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      const manager = users.find((u) => u.username === 'manager');
      if (!manager) return;

      const tx = openDb.transaction('notifications', 'readwrite');
      const store = tx.objectStore('notifications');
      await new Promise<void>((resolve, reject) => {
        const req = store.add({
          recipientId: manager.id,
          templateKey: 'DUE_REMINDER',
          templateData: { bayLabel: 'Bay 1', startTime: '10:00 AM' },
          renderedSubject: '',
          renderedBody: '',
          status: 'Failed',
          isRead: false,
          retries: 1,
          createdAt: Date.now(),
          failureReason: 'Transient simulated error'
        });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      openDb.close();
    }
  }, DB_NAME);

  // Wait for runtime retry scheduler cycle (30s).
  await waitForSchedulerTick(page, 35_000);

  // Verify the notification was successfully delivered (check IndexedDB state)
  const result = await page.evaluate(async (dbName) => {
    const openDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const tx = openDb.transaction('notifications', 'readonly');
      const store = tx.objectStore('notifications');
      const all = await new Promise<any[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as any[]) ?? []);
        req.onerror = () => reject(req.error);
      });
    const retried = all.find(n => n.templateKey === 'DUE_REMINDER' && n.renderedSubject !== '');
    return { status: retried?.status, subject: retried?.renderedSubject };
    } finally {
      openDb.close();
    }
  }, DB_NAME);
  expect(result.status).toBe('Delivered');
  expect(result.subject).toContain('due soon');

  // Verify notification count increased in IndexedDB (observable outcome)
  const totalDelivered = await page.evaluate(async (dbName) => {
    const openDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const tx = openDb.transaction('notifications', 'readonly');
      const store = tx.objectStore('notifications');
      const all = await new Promise<any[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as any[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      return all.filter((n) => n.status === 'Delivered').length;
    } finally {
      openDb.close();
    }
  }, DB_NAME);
  expect(totalDelivered).toBeGreaterThanOrEqual(1);
});
