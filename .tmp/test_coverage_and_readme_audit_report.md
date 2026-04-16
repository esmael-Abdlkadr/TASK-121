# Test Coverage Audit

## Backend Endpoint Inventory

### Detected backend endpoints (`METHOD + PATH`)

No backend API endpoints were found.

Evidence:
- `repo/README.md` describes a fully offline SPA with no backend HTTP dependencies.
- `repo/src/router/index.tsx` defines React client routes only (`<Route path=...>`).
- Static search for server route registration patterns returned no matches:
  - `app.get/app.post/router.get/router.post/...`
  - HTTP client/server test patterns (`fetch`, `axios`, `supertest`, request API calls to backend handlers).

Client route surface (context only, not backend endpoints):
- `/`
- `/login`
- `/kiosk`
- `/kiosk/reservations`
- `/kiosk/sessions`
- `/kiosk/notifications`
- `/admin`
- `/admin/dashboard`
- `/admin/reservations`
- `/admin/sessions`
- `/admin/import`
- `/admin/quality`
- `/admin/audit`
- `/admin/config`
- `/admin/notifications`
- `/admin/users`

## API Test Mapping Table

| endpoint (`METHOD + PATH`) | covered | test type | test files | evidence |
|---|---|---|---|---|
| _None detected_ | no | unit-only / indirect | `repo/src/__tests__/*.test.ts(x)`, `repo/src/services/iteration*.spec.ts`, `repo/e2e/*.spec.ts` | tests exercise service/UI flows; no backend HTTP handler invocation paths exist |

## Coverage Summary

- Total endpoints: **0**
- Endpoints with HTTP tests: **0**
- Endpoints with TRUE no-mock tests: **0**
- HTTP coverage %: **N/A** (no backend endpoints present)
- True API coverage %: **N/A** (no backend endpoints present)

## Unit Test Summary

### Test files

- `repo/src/__tests__`: 27 files (`22` `.test.ts` + `5` `.test.tsx`)
- `repo/src/services/iteration*.spec.ts`: 6 files
- `repo/e2e/*.spec.ts`: 5 files

### Modules covered

- **Controllers:** N/A (no backend controller layer in repo).
- **Services:** broad direct coverage, including `authService`, `auditService`, `cryptoService`, `exportService`, `heartbeatService`, `importService`, `notificationService`, `orderService`, `qrService`, `qualityService`, `rateLimiter`, `reservationService`, `sessionService`, `siteConfigService`, `tieringService`, plus newly direct-covered `userService` and `storageService`.
- **Repositories/data access:** Dexie persistence paths are exercised through real table writes/reads in service tests (`db.*` usage across multiple suites).
- **Auth/guards/middleware:** `ProtectedRoute` behavior in `repo/src/__tests__/router.test.tsx`; login/session behavior in `repo/src/__tests__/authService.test.ts`; RBAC enforcement in `repo/src/__tests__/rbacAuditor.test.ts` and `repo/src/__tests__/rbacServiceLevel.test.ts`.

### Important modules not directly tested

- `repo/src/services/rbacService.ts` (covered indirectly through service-level RBAC tests, but no isolated direct test file for helper functions).
- `repo/src/hooks/useAuth.ts` (consumed/mocked by component/router tests; no direct hook-level test).
- `repo/src/db/seed.ts` (no direct test coverage observed).

## Tests Check

### API test classification

1. **True No-Mock HTTP:** none (no backend API endpoint surface detected).
2. **HTTP with Mocking:** none for backend API testing.
3. **Non-HTTP (unit/integration/UI/e2e without backend HTTP):** dominant and substantial.

### Mock detection

Detected mocking usage:
- `repo/src/__tests__/router.test.tsx`
  - mocks `../hooks/useAuth`
  - mocks `../pages/ForbiddenPage`
- `repo/src/__tests__/components/ReservationDrawer.test.tsx`
  - mocks `../../services/qrService`
  - mocks `../../hooks/useAuth`
  - mocks `../../services/reservationService`
  - mocks `dexie-react-hooks`
- `repo/src/__tests__/components/LoginPage.test.tsx`
  - mocks `../../hooks/useAuth`
  - mocks `react-router-dom`

### API observability check

- Backend API observability (method/path/request/response) is **not applicable** because backend HTTP endpoints are absent.
- UI flow observability is strong in Playwright tests (clear route navigation and assertions), but this does not qualify as backend API endpoint observability under the strict definition.

### Test quality & sufficiency

- **Success paths:** strong (auth success, reservation/session/order flows, import/export happy paths).
- **Failure paths:** strong (RBAC violations, duplicate import file detection, invalid row/date/rate checks, wrong password and lockout cases).
- **Edge/validation depth:** strong DB-state assertions and domain rule checks across service tests.
- **Auth/permission checks:** broad role-matrix and service-layer enforcement checks.
- **Integration boundaries:** strong for offline service + UI flows; no FE<->BE boundary because no backend.
- **`run_tests.sh` check:** Docker-based (`docker compose` orchestration + Playwright container) -> **OK**.

## Test Coverage Score (0-100)

**91**

## Score Rationale

- Strong overall test sufficiency for this architecture:
  - extensive service-level and persistence assertions,
  - broad RBAC/auth coverage,
  - realistic E2E route/workflow checks,
  - newly added direct tests for previously uncovered core modules (`userService`, `storageService`).
- Score is not maximal because:
  - strict backend API endpoint criteria are not exercisable in this repo (no backend endpoint surface),
  - some key behavior is validated indirectly rather than via direct unit targets (`rbacService`, `useAuth`).

## Key Gaps

- No backend API endpoint layer exists, so strict API endpoint coverage metrics remain N/A.
- No direct isolated tests for `rbacService` helper functions.
- No direct hook-level tests for `useAuth`.

## Confidence & Assumptions

- Confidence: **High**.
- Assumptions:
  - Repo is a web SPA (explicitly declared in README and consistent with source layout).
  - Backend endpoint inventory is intentionally empty, not missing due to partial scan.
- Constraint adherence:
  - Static inspection only (no execution for this audit run).

### Test Coverage Verdict

**PASS**

---

# README Audit

## Project Type Detection

- Declared at top of README: `web`.
- Result: **Pass**.

## README Location

- Required file exists at `repo/README.md`.
- Result: **Pass**.

## Hard Gate Evaluation

- **Formatting:** clean markdown with clear sectioning -> Pass.
- **Startup Instructions:** includes required `docker-compose up` command (`docker-compose up --build`) -> Pass.
- **Access Method:** includes URL + port (`http://localhost:5199`) -> Pass.
- **Verification Method:** includes explicit UI verification workflow -> Pass.
- **Environment Rules:** no disallowed local install/runtime setup commands found (`npm install`, `pip install`, `apt-get`, local Playwright install commands not present) -> Pass.
- **Demo Credentials:** auth exists and credentials are provided for all roles (`SystemAdministrator`, `SiteManager`, `Attendant`, `Auditor`) -> Pass.

## High Priority Issues

- None.

## Medium Priority Issues

- None.

## Low Priority Issues

- None.

## Hard Gate Failures

- None.

## README Verdict (PASS / PARTIAL PASS / FAIL)

**PASS**

### README Audit Verdict

**PASS**

---

## Final Verdicts

1. **Test Coverage Audit:** PASS (score 91)
2. **README Audit:** PASS
