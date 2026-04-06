# ChargeBay Offline Operations Console

ChargeBay is a fully offline SPA used by EV charging site teams for reservations, check-in, sessions, orders, notifications, imports, data quality governance, and audit operations. The application runs entirely in the browser with no backend or HTTP dependencies, and persists state in IndexedDB (Dexie) plus small user/site preferences in LocalStorage.

The architecture is service-first: UI pages/components call typed service modules, services enforce RBAC and security checks, and all business events are logged in a tamper-evident audit chain. Sensitive fields are encrypted with AES-GCM using keys derived at login time and kept in memory only.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite 5 |
| Routing | React Router 6 |
| Local DB | Dexie.js 3 (IndexedDB hot/cold stores) |
| Crypto | WebCrypto (PBKDF2 + AES-GCM + SHA-256) |
| Import | CSV parser + xlsx |
| Testing | Vitest + React Testing Library + Playwright |

## Quick Start

```bash
npm install
npm run dev
```

App URL: `http://localhost:5173`

## Test Credentials

| Username | Password | Role | Mode |
|---|---|---|---|
| `sysadmin` | `ChargeBay#Admin1` | SystemAdministrator | Admin |
| `manager` | `ChargeBay#Mgr01` | SiteManager | Kiosk |
| `attendant` | `ChargeBay#Att01` | Attendant | Kiosk |
| `auditor` | `ChargeBay#Aud01` | Auditor | Admin (read-only) |

## Navigation Modes

- **Kiosk mode**: Attendant and SiteManager (`/kiosk/...`)
- **Admin mode**: SystemAdministrator and Auditor (`/admin/...`)

Route and UI access are role-gated, and site-scoped access is enforced in service-layer logic.

## Roles

- **SystemAdministrator**: Full global access to all features, configuration, users, import/export, archiving.
- **SiteManager**: Daily operations, pricing configuration, import for their assigned site.
- **Attendant**: Check-in, reservation creation, session management at their assigned site.
- **Auditor**: Read-only access to audit logs, quality reports, sessions/orders view, and notification send logs. Cannot perform any data mutations.

## Session Restore & Re-Unlock

The encryption key is derived from your password at login time and kept in memory only. If you refresh the page or your session is restored from localStorage, the app will show a **Re-Unlock** modal asking you to re-enter your password to derive the encryption key again. Until unlocked, pages that require encrypted data access will indicate that the key is not available.

You can also choose to **Logout** from the re-unlock modal.

## Theme

A light/dark theme toggle is available in the shell header. Your preference is persisted in LocalStorage.

## Storage Layout

### IndexedDB (primary persistence)
All business data, audit logs, site configuration (`siteConfigs` table), and rate-limit state (`rateLimits` table) are persisted in IndexedDB via Dexie.js.

### LocalStorage (lightweight UI/session pointers only)
- **Theme** (`cb_theme`): light or dark
- **Last selected site** (`cb_last_site`): used by SystemAdministrator for site-scoped operations
- **Notification preferences** (`cb_notif_prefs_{userId}`): per-user notification template toggles and desktop banner setting
- **Site config cache** (`cb_site_config_{siteId}`): synced mirror of IndexedDB site config for synchronous reads

## Build

```bash
npm run build
```

Output is written to `dist/`.

## Preview

```bash
npm run preview
```

Serves the production build locally.

## Run All Tests

### Local (no Docker required)

```bash
# Unit + Component tests (Vitest)
npm run test

# E2E tests (Playwright, uses managed dev server)
npx playwright install --with-deps
npx playwright test
```

### Docker full-suite (optional)

```bash
# Runs both Vitest and Playwright inside a container
bash run_tests.sh
```

## Export/Import Packages

Use **Admin Dashboard → Export & Archive** (SystemAdministrator only):

1. Pick date range + export password, click **Export Package**.
2. Transfer generated JSON package to another device.
3. Select package file + password, click **Import Package**.

Packages are AES-GCM encrypted and password-integrity-verified (`SHA-256(payload + password)`) before insertion.
> **Note:** The `signature` field is a password-bound integrity check, not an asymmetric cryptographic signature.
> It proves the package was created with the correct password and has not been tampered with, but does not establish signer identity.

## Bulk Import

Use **Bulk Import** page (SystemAdministrator, SiteManager):

1. Select import type (reservations, orders, sessions).
2. Upload CSV or XLSX file.
3. Map fields, validate, then import.

Imported sensitive fields (customer name, plate, invoice notes) are encrypted at rest when an encryption key is available.

## Architecture Notes

- **Service layer**: all mutation/query business logic in `src/services/*`
- **RBAC enforcement**: `assertCanMutate()` blocks Auditor from all data mutations; `assertManagerOrAdmin()` restricts sensitive operations (site config, export/import, tiering) to SystemAdministrator and SiteManager; `assertSiteScope()` enforces site-based row filtering on all service entry points including import validate/write paths, preventing cross-site operations by non-global roles
- **Hot/Cold tiering**: active tables + archived `_cold` tables; 90-day archival policy
- **Auth and key lifecycle**: PBKDF2 password verification, lockout handling, in-memory encryption key, key cleared on logout, re-unlock required after session restore
- **Audit chain**: append-only logs with chain hash verification
- **Encryption at rest**: customer name, customer plate, and invoice notes are encrypted via AES-GCM before storage in IndexedDB across all write paths (manual create, import, order generation)
