# ChargeBay Operations Console - Static Audit Report (Version 3)

## Verdict
- **Partial Pass**

## Confirmed High Finding
- **F-001 (High):** Date import validator can accept invalid calendar dates because parsed month/day are range-checked but overflow normalization from `new Date(...)` is not rejected.
- Evidence: `src/services/importService.ts:139`, `src/services/importService.ts:146`, `src/services/importService.ts:147`, `src/services/importService.ts:157`
- Impact: Prompt-required pre-import validation reliability is weakened.
- Minimum fix: Validate reconstructed date parts exactly match original parsed parts.

## Other Material Findings
- **M-001 (Medium):** Startup docs conflict with standalone frontend expectations by making Docker appear mandatory.  
  Evidence: `README.md:21`, `README.md:80`, `package.json:7`
- **M-002 (Medium):** Notification mutation APIs (`send`, `manualRetry`) are not consistently actor-guarded at service boundary.  
  Evidence: `src/services/notificationService.ts:156`, `src/services/notificationService.ts:295`
- **M-003 (Medium):** Some operational mutation errors are surfaced as broad fallback states, lowering troubleshooting quality.  
  Evidence: `src/pages/SessionsOrdersPage.tsx:256`, `src/pages/AdminDashboardPage.tsx:117`
- **M-004 (Medium):** Tests do not explicitly prove strict invalid-date rejection behavior.  
  Evidence: `src/__tests__/importService.test.ts:132`

## Static Boundary Notes
- Review was static-only; app/tests/Docker were not executed.
- Claims needing runtime/UI behavior confirmation remain manual-verification items.
