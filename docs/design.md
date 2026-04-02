# Design Document — TASK-121 ChargeBay Offline Operations Console

## 1. Project Overview
A fully offline, browser-based React SPA for EV charging site teams. All data lives in IndexedDB (via Dexie.js) with hot/cold tiering. No backend, no network calls. Designed for single-device kiosk deployment.

## 2. Tech Stack

| Layer | Library | Version | Purpose |
|---|---|---|---|
| Framework | React | 18.x | Component model |
| Routing | React Router | 6.x | Kiosk + admin SPA navigation |
| Local DB | Dexie.js | 3.x | IndexedDB wrapper (hot + cold stores) |
| QR Code | qrcode | 1.x | Local QR code generation |
| Excel Parse | xlsx (SheetJS) | 0.18.x | .xlsx bulk import |
| Crypto | WebCrypto (built-in) | — | PBKDF2, AES-GCM |
| Testing | Vitest | 1.x | Unit & component tests |
| Testing | React Testing Library | 14.x | Component interaction tests |
| Testing | Playwright | 1.x | E2E smoke tests |
| Build | Vite | 5.x | Dev server + bundle |
| Language | TypeScript | 5.x | Type safety |

## 3. Architecture

### 3.1 Navigation Modes
```
/login
  → Attendant / Site Manager → /kiosk  (KioskShell: full-screen, tab-bar)
  → Administrator / Auditor  → /admin  (AdminShell: sidebar)
```

### 3.2 Service Layer Pattern
```
UI (Pages + Components)
        ↓
  React Hooks / Context (useAuth, useNotifications)
        ↓
  Service Layer (pure async TS — no React imports)
        ↓
  Dexie DB Layer (hot store + cold store)
```

Services accept `actor: User` for RBAC and audit logging. Independently unit-testable.

### 3.3 RBAC Matrix

| Feature | SysAdmin | SiteManager | Attendant | Auditor |
|---|---|---|---|---|
| Create/manage reservations | ✓ | ✓ | ✓ | — |
| Check in (confirm arrival) | ✓ | ✓ | ✓ | — |
| Complete sessions | ✓ | ✓ | ✓ | — |
| Approve compensation | ✓ | ✓ | — | — |
| Refund orders | ✓ | ✓ | — | — |
| Bulk import | ✓ | ✓ | — | — |
| Site configuration | ✓ | ✓ | — | — |
| User management | ✓ | — | — | — |
| Audit log + verify chain | ✓ | — | — | ✓ |
| Data quality reports | ✓ | ✓ | — | ✓ |
| Export/import packages | ✓ | — | — | — |
| Reconciliation status | ✓ | — | — | ✓ |

### 3.4 Encryption Key Lifecycle
- Derived with PBKDF2 (100,000 iterations, SHA-256) from login password on login
- Held only in React auth context memory (`CryptoKey` object)
- Never serialized or written to disk
- Cleared on logout or 8-hour session expiry
- Required for read/write of `customerName`, `customerPlate`, `invoiceNotes`

## 4. IndexedDB Schema (Dexie v1)

### Hot Store (Active — last 90 days)
```
users              ++id, &username, role, siteId
sessions_auth      ++id, userId, createdAt, lastActiveAt
sites              ++id, &siteCode, name
bays               ++id, siteId, stationId, connectorId, status
reservations       ++id, bayId, siteId, userId, status, scheduledStart, &operationId
sessions_charging  ++id, reservationId, bayId, siteId, status, heartbeatAt, version
orders             ++id, sessionId, siteId, &orderNumber, status, version
notifications      ++id, recipientId, templateKey, status, isRead, createdAt, retries
auditLogs          ++id, actor, action, entityType, entityId, siteId, timestamp
importBatches      ++id, siteId, status, createdAt, dedupeHash
importRows         ++id, batchId, rowIndex, status
qualityReports     ++id, siteId, generatedAt, type
```

### Cold Store (Archived — records > 90 days)
```
reservations_cold  ++id, bayId, siteId, originalId, archivedAt
sessions_cold      ++id, bayId, siteId, originalId, archivedAt
orders_cold        ++id, siteId, originalId, archivedAt
```

## 5. Key Workflows

### 5.1 Reservation → Check-In → Session → Order
```
Create Reservation (Scheduled, QR generated)
    → 10-min window passes without check-in → NoShow (auto-cancel)
    → Attendant checks in (manual or QR scan) → CheckedIn → Active session starts
        → Heartbeat updates every 30s
        → Temp leave (optional, within limits)
        → 30+ min no heartbeat → Anomaly flagged
        → Complete session → order auto-generated (Draft)
            → Submit → Paid (standard) or approval flow (compensation)
```

### 5.2 Hot/Cold Tiering
```
App boot / every 24h:
  Records > 90 days old:
    hot.reservations → cold.reservations_cold
    hot.sessions_charging → cold.sessions_cold
    hot.orders → cold.orders_cold
```

### 5.3 Bulk Import
```
Upload CSV/Excel
  → Deduplicate file (SHA-256 of content)
  → Validate all rows (collect all errors)
  → If ANY error → reject ALL, show error list, write zero records
  → If all valid → dedup rows, insert in single transaction
  → Notify actor: IMPORT_COMPLETE or IMPORT_FAILED
```

## 6. Schedulers (App.tsx setInterval)

| Interval | Function | Purpose |
|---|---|---|
| 30s | `heartbeatService.tick()` | Update heartbeat on all active sessions |
| 60s | `heartbeatService.checkAnomalies()` | Flag sessions missing heartbeat or over temp-leave limit |
| 60s | `reservationService.autoProcessNoShows()` | Cancel reservations past 10-min no-show deadline |
| 60s | `notificationService.retryFailed()` (via 30s) | Retry failed notifications |
| 60s | Due reminder / overdue alert checks | Fire DUE_REMINDER (15min before) and OVERDUE_ALERT (+5min) |
| 24h | `tieringService.runTiering()` | Move old records to cold store |
| Weekly (boot check) | `qualityService.runReport()` | Generate weekly data quality report |
