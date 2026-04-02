# ── Stage 1: install deps (shared layer) ──────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── Stage 2: unit-test / tsc runner ───────────────────────────────────────────
FROM deps AS test-runner
COPY . .
CMD sh -c "\
  echo '=== TypeScript check ===' && npx tsc --noEmit && \
  echo '=== Unit & component tests ===' && npm run test -- --reporter=verbose && \
  echo '=== Unit tests passed ==='"

# ── Stage 3: build production assets ──────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN npm run build

# ── Stage 4: serve with Nginx ──────────────────────────────────────────────────
FROM nginx:1.27-alpine AS server
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
