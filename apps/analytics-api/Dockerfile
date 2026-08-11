# syntax=docker/dockerfile:1
# Prism analytics API (Node/Hono, WebSocket support).
FROM node:22-alpine AS builder
WORKDIR /repo
COPY package.json yarn.lock ./
COPY packages/types/package.json packages/types/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/email-templates/package.json packages/email-templates/package.json
COPY packages/prism-react/package.json packages/prism-react/package.json
COPY apps/analytics-api/package.json apps/analytics-api/package.json
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn workspace prism-analytics-api build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json yarn.lock ./
COPY packages/types/package.json packages/types/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/email-templates/package.json packages/email-templates/package.json
COPY packages/prism-react/package.json packages/prism-react/package.json
COPY apps/analytics-api/package.json apps/analytics-api/package.json
RUN yarn install --frozen-lockfile --production --ignore-scripts && yarn cache clean
COPY --from=builder /repo/apps/analytics-api/dist ./apps/analytics-api/dist
COPY --from=builder /repo/apps/analytics-api/db ./apps/analytics-api/db
WORKDIR /repo/apps/analytics-api
USER node
EXPOSE 8080
# Idempotent analytics schema setup (never drops tables), then serve.
CMD ["sh", "-c", "node dist/src/database/setup.js && exec node dist/src/index.js"]
