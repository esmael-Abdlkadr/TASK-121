#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=== Installing dependencies ==="
npm ci

echo "=== TypeScript check ==="
npx tsc --noEmit

echo "=== Unit & component tests (Vitest) ==="
npm run test -- --reporter=verbose

echo "=== E2E tests (Playwright with managed web server) ==="
npx playwright install --with-deps chromium
npx playwright test --project=chromium

echo "=== All tests passed ==="
