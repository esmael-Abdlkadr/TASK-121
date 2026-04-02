# Service Contracts — TASK-121 ChargeBay

> Pure frontend project. No HTTP endpoints. This document defines service layer function signatures, input validation rules, and error codes.

## Error Code Conventions
All errors thrown as: `{ code: string; message: string; details?: object }`

---

## Auth Service
```ts
authService.login(username, password): Promise<User>
authService.logout(): void
authService.restoreSession(): Promise<User | null>
```
| Error | Condition |
|---|---|
| `AUTH_WRONG_PASSWORD` | Password mismatch or user not found (same message) |
| `AUTH_LOCKED` | Account locked; `{ remainingMs }` in details |

---

## Reservation Service
```ts
reservationService.createReservation(data, actor): Promise<Reservation>
reservationService.confirmArrival(reservationId, method, qrPayload?, actor): Promise<ChargingSession>
reservationService.autoProcessNoShows(): void
reservationService.startTempLeave(sessionId, actor): Promise<void>
reservationService.endTempLeave(sessionId, actor): Promise<void>
reservationService.flagAnomaly(sessionId, reason, actor): Promise<void>
```
| Error | Condition |
|---|---|
| `RES_BAY_CONFLICT` | Bay has overlapping Scheduled/Active reservation |
| `RES_QR_MISMATCH` | QR payload `operationId` does not match reservation |
| `TEMPLEAVE_LIMIT_REACHED` | `tempLeaveCount >= siteConfig.tempLeaveMaxCount` |
| `RBAC_SCOPE_VIOLATION` | Actor's siteId does not match record's siteId |

---

## Session Service
```ts
sessionService.completeSession(sessionId, actor): Promise<void>
sessionService.resolveAnomaly(sessionId, resolution, reason, actor): Promise<void>
```
| Error | Condition |
|---|---|
| `SESSION_WRONG_STATUS` | Session not in required status for the operation |
| `SESSION_REASON_TOO_SHORT` | `reason.length < 10` for anomaly resolution |

---

## Order Service
```ts
orderService.generateOrder(sessionId, actor): Promise<Order>
orderService.submitOrder(orderId, actor): Promise<void>
orderService.approveCompensation(orderId, actor): Promise<void>
orderService.markPaid(orderId, actor): Promise<void>
orderService.refundOrder(orderId, reason, actor): Promise<void>
orderService.setReconciliationStatus(orderId, status, actor): Promise<void>
```
| Error | Condition |
|---|---|
| `ORDER_COMPENSATION_REQUIRES_APPROVAL` | Compensation order submitted by non-manager role |
| `ORDER_INVALID_TRANSITION` | Status transition not in allowed state machine |
| `ORDER_REFUND_REASON_REQUIRED` | `reason.length < 5` |
| `RBAC_AUDITOR_READ_ONLY` | Auditor attempted a write operation |

---

## Import Service
```ts
importService.downloadTemplate(type): void
importService.startImport(file, type, fieldMap, actor): Promise<ImportBatch>
```
| Error | Condition |
|---|---|
| `IMPORT_DUPLICATE_FILE` | Same SHA-256 file content already imported for this site |
| `IMPORT_REQUIRED_FIELD_MISSING` | Required CSV field absent for a row |
| `IMPORT_DATE_FORMAT_INVALID` | Date not in MM/DD/YYYY HH:mm |
| `IMPORT_DATE_RANGE_INVALID` | `scheduledStart >= scheduledEnd` |
| `IMPORT_BAY_NOT_FOUND` | `stationId + connectorId` not in site bays |
| `IMPORT_ROLLBACK` | One or more rows failed validation — zero records written |

---

## Tiering Service
```ts
tieringService.runTiering(siteId, actor): Promise<TieringResult>
tieringService.queryColdReservations(siteId, filters): Promise<Reservation[]>
```

---

## Export Service
```ts
exportService.exportPackage(siteId, dateRange, password, actor): Promise<Blob>
exportService.importPackage(file, password, actor): Promise<ImportResult>
```
| Error | Condition |
|---|---|
| `EXPORT_SIGNATURE_MISMATCH` | Signature verification failed during import |
| `IMPORT_VERSION_MISMATCH` | Package `version !== 1` |

---

## Rate Limiter
```ts
rateLimiter.check(userId, action, cap, windowMs): void   // throws if exceeded
rateLimiter.record(userId, action, count): void
```
| Error | Condition |
|---|---|
| `RATE_LIMIT_EXCEEDED` | Action count exceeded `cap` within `windowMs`; `{ action, cap, retryAfterMs }` |

Caps:
- Bulk order status updates: 200 rows / 60,000 ms
- Bulk reservation cancellations: 100 rows / 60,000 ms

---

## Notification Service
```ts
notificationService.send(recipientId, templateKey, templateData): Promise<Notification>
notificationService.deliver(notificationId): Promise<void>
notificationService.retryFailed(): Promise<void>
notificationService.markRead(notificationId, actor): Promise<void>
notificationService.archive(notificationId, actor): Promise<void>
```
Delivery failure: max 3 retries with 5s delay. After 3 failures → `status = 'Failed'` permanently until manual "Retry Now".

---

## Audit Service
```ts
auditService.log(actor, action, entityType, entityId, detail?): Promise<void>
auditService.verifyChain(siteId?): Promise<boolean>
```
- Append-only. No update or delete functions.
- Each record stores `chainHash = SHA-256(prevChainHash + record data)`.
