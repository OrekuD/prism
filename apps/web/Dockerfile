# syntax=docker/dockerfile:1
# Prism web application.
# Builds the static Vite bundle WITHOUT compile-time API URLs (the runtime
# talks to /api/* and /ws on the same origin), then serves it from nginx,
# which also proxies /api and /ws to the backend services — one public
# origin for browser, API, and WebSocket traffic.
FROM node:24-alpine AS builder
WORKDIR /repo
COPY package.json yarn.lock ./
COPY packages/config-typescript/package.json packages/config-typescript/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/browser/package.json packages/browser/package.json
COPY packages/email-templates/package.json packages/email-templates/package.json
COPY packages/prism-react/package.json packages/prism-react/package.json
COPY apps/web/package.json apps/web/package.json
RUN yarn install --frozen-lockfile && yarn cache clean
COPY . .
# Workspace packages ship no committed dist — build what the web app imports
RUN yarn workspace @prism-analytics/types build \
    && yarn workspace @prism-analytics/core build \
    && yarn workspace @prism-analytics/browser build \
    && yarn workspace @prism-analytics/react build
RUN yarn workspace prism-web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
