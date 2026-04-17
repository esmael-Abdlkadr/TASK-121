# ChargeBay Operations Console - Static Audit Report (Version 2)

## 1. Verdict
- **Partial Pass**

## 2. Scope and Verification Boundary
- Static-only review of `repo/` code, routes, services, DB schema/seed, docs, and tests.
- Excluded: `./.tmp/**` as evidence source.
- Not executed: app runtime, tests, Docker, browser/manual flows.

## 3. High-Risk Outcome
- One confirmed **High** defect in prompt-critical validation:
  - `F-001`: import date parser can accept invalid calendar dates due to JS date rollover handling.
  - Evidence: `src/services/importService.ts:139`, `src/services/importService.ts:146`, `src/services/importService.ts:147`, `src/services/importService.ts:157`

## 4. Coverage Panel
- **Prompt-fit/completeness:** Partial Pass
- **Static delivery structure:** Pass
- **Frontend interaction/state:** Partial Pass
- **Data exposure/delivery risk:** Pass
- **Test-critical gaps:** Partial Pass

## 5. Severity-Rated Findings

### F-001 (High)
- **Conclusion:** Import date validation is not strict enough for MM/DD/YYYY semantics.
- **Impact:** Malformed date rows may bypass validation and contaminate imported data.
- **Minimum fix:** Enforce component round-trip validation after `new Date(...)`.

### M-001 (Medium)
- **Conclusion:** README over-emphasizes Docker as required path despite local scripts.
- **Evidence:** `README.md:21`, `README.md:70`, `package.json:7`
- **Minimum fix:** Add clear local run/test commands.

### M-002 (Medium)
- **Conclusion:** Notification service has mutation entry points with incomplete guard strategy.
- **Evidence:** `src/services/notificationService.ts:156`, `src/services/notificationService.ts:295`
- **Minimum fix:** Require actor checks or keep these APIs internal-only.

### M-003 (Medium)
- **Conclusion:** Some core page actions map errors to generic fallback UX.
- **Evidence:** `src/pages/SessionsOrdersPage.tsx:256`, `src/pages/SessionsOrdersPage.tsx:317`
- **Minimum fix:** Show code-specific failure messages.

### M-004 (Medium)
- **Conclusion:** Missing explicit tests for invalid calendar date rejection.
- **Evidence:** `src/__tests__/importService.test.ts:132`
- **Minimum fix:** Add parser boundary tests (`02/31`, `13/01`, invalid time).
