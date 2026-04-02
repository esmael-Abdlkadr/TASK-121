# Questions & Ambiguities — TASK-121 ChargeBay

## 1. Delivery / Project Type
- **Question**: The prompt says "runs fully standalone in the browser." Is there no backend?
- **My Understanding**: Correct — IndexedDB is the sole database. No NestJS, no network calls. The NestJS/PostgreSQL mention is "designed to be compatible" for a future migration, not a current requirement.
- **Solution**: Deliver as `pure_frontend` (Vite + React + TypeScript). `npm run dev` is the only start command.

## 2. QR Code Generation Library
- **Question**: The prompt says "locally generated QR code" — should a QR library be used?
- **My Understanding**: A QR library is needed to generate scannable 2D barcodes. The `qrcode` package is pure JS with no network calls.
- **Solution**: Add `qrcode@^1` to package.json. Generate QR codes from `{ reservationId, operationId, siteCode }` JSON. Store as data URL in the reservation record.

## 3. "Kiosk Mode" vs "Admin Mode" — Are These Separate Apps?
- **Question**: The prompt mentions "kiosk-mode and admin-mode navigation" — are these separate URL roots or a mode toggle?
- **My Understanding**: Two separate React Router layouts under `/kiosk/*` and `/admin/*`, selected automatically by role on login.
- **Solution**: Attendant and Site Manager land on `/kiosk`. Administrator and Auditor land on `/admin`. Both are in the same SPA bundle.

## 4. "Site-Based Data Scope" — Multi-Site Support
- **Question**: Does each user belong to exactly one site, or can they manage multiple?
- **My Understanding**: SystemAdministrator has global access (all sites). All other roles are scoped to exactly one `siteId`. Accessing records from a different site throws a scope violation.
- **Solution**: `assertSiteScope(actor, recordSiteId)` helper enforced in every service method. `siteId` stored on the `User` record; null for SystemAdministrator.

## 5. Heartbeat — Who Updates It?
- **Question**: The prompt mentions "active session heartbeat update." In a browser SPA with no server, who sends the heartbeat?
- **My Understanding**: The browser itself updates heartbeat via a `setInterval` scheduler while the app is open. If the app is closed, no heartbeat fires — this is expected offline behavior.
- **Solution**: `heartbeatService.tick()` runs every 30 seconds via `setInterval` in `App.tsx`, updating `heartbeatAt` on all active sessions for the current site.

## 6. Excel/CSV Import — `.xlsx` Support
- **Question**: The prompt says "Excel/CSV bulk import." Does this require true `.xlsx` parsing?
- **My Understanding**: Yes — use the `xlsx` (SheetJS) package, which is pure JS with no network calls.
- **Solution**: Add `xlsx@^0.18` to `package.json`. Both `.csv` and `.xlsx` are accepted on the file picker.

## 7. Compensation Approval — Who Requests vs Who Approves
- **Question**: Any role can request a compensation order, or only specific roles?
- **My Understanding**: Attendants and Site Managers can flag a compensation adjustment on an order. Approval requires SiteManager or SystemAdministrator.
- **Solution**: Any authenticated user can set `billingType = 'Compensation'` on an order they're creating. Approval flow locks the order at `Pending` until a SiteManager/Administrator approves.

## 8. "Signed JSON Packages" — Signing Key
- **Question**: What is the signing key for the export package? A separate admin key, or the user's login password?
- **My Understanding**: A separately entered export password (not the login password) is used for both encryption and signature derivation, keeping the user's login credentials independent.
- **Solution**: Export/import modals prompt for a dedicated export password. Signature = SHA-256(JSON + exportPassword). AES-GCM key = PBKDF2(exportPassword + randomSalt).

## 9. Rate Limiting — Window Definition
- **Question**: "200 rows per minute" — is this a sliding window or a fixed 1-minute bucket?
- **My Understanding**: A fixed 1-minute bucket is simpler and sufficient for the offline use case.
- **Solution**: `RateLimiter` uses a fixed window: store `{ count, windowStart }` in LocalStorage; reset when `now - windowStart > 60_000`.

## 10. Auditor Role — Write Access
- **Question**: The prompt says Auditor has "read-only access to immutable logs and reports." Can Auditors do anything write?
- **My Understanding**: Auditors cannot create, update, or delete any business records. They can only view and export.
- **Solution**: All mutating service methods check `actor.role !== 'Auditor'` and throw `RBAC_AUDITOR_READ_ONLY` if violated.
