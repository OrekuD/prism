# syntax=docker/dockerfile:1
# Prism analytics API (Node/Hono, WebSocket support).
FROM node:24-alpine AS builder
WORKDIR /repo
COPY package.json yarn.lock ./
COPY packages/config-typescript/package.json packages/config-typescript/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/browser/package.json packages/browser/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/email-templates/package.json packages/email-templates/package.json
COPY packages/prism-react/package.json packages/prism-react/package.json
COPY apps/analytics-api/package.json apps/analytics-api/package.json
RUN yarn install --frozen-lockfile && yarn cache clean
COPY . .
# Workspace packages ship no committed dist — build @prism/types and
# @prism/core first (the analytics API validates against core's shared
# ingestion limits and sanitizer)
RUN yarn workspace @prism/types build
RUN yarn workspace @prism/core build
RUN yarn workspace prism-analytics-api build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json yarn.lock ./
COPY packages/types/package.json packages/types/package.json
COPY packages/browser/package.json packages/browser/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/email-templates/package.json packages/email-templates/package.json
COPY packages/prism-react/package.json packages/prism-react/package.json
COPY apps/analytics-api/package.json apps/analytics-api/package.json
RUN yarn install --frozen-lockfile --production --ignore-scripts && yarn cache clean
# Runtime imports of @prism/types and @prism/core resolve through the
# workspace symlinks.
COPY --from=builder /repo/packages/types/dist ./packages/types/dist
COPY --from=builder /repo/packages/core/dist ./packages/core/dist
COPY --from=builder /repo/apps/analytics-api/dist ./apps/analytics-api/dist
COPY --from=builder /repo/apps/analytics-api/db ./apps/analytics-api/db
WORKDIR /repo/apps/analytics-api
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8080/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
# Ordered forward migrations with a journal, then serve.
CMD ["sh", "-c", "node dist/src/database/migrate.js && exec node dist/src/index.js"]
