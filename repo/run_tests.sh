#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "========================================"
echo " ChargeBay — Docker test suite"
echo "========================================"

# Keep the workspace clean even on failures.
cleanup() {
  docker compose --profile test down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo ""
echo "=== [1/2] Unit tests · TypeScript check (Docker) ==="
docker compose --profile test run --rm --build test

echo ""
echo "=== [2/2] Playwright E2E (Docker) ==="
docker compose --profile test up -d --build chargebay
docker run --rm \
  --network=host \
  -v "$ROOT:/app" \
  -w /app \
  -e PLAYWRIGHT_BASE_URL=http://localhost:5199 \
  mcr.microsoft.com/playwright:v1.59.0-noble \
  sh -c "npm ci --prefer-offline --no-audit --no-fund && npx playwright test --project=chromium"

echo ""
echo "========================================"
echo " All tests passed"
echo "========================================"
