# syntax=docker/dockerfile:1
# Prism product API (Node runtime, self-hosted).
# Builds the bundled Node entry (dist-node) with esbuild and runs it as an
# unprivileged user. The image contains no secrets: configuration is
# injected at runtime through the environment.
FROM node:22-alpine AS builder
WORKDIR /repo
COPY package.json yarn.lock ./
COPY packages/types/package.json packages/types/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/email-templates/package.json packages/email-templates/package.json
COPY packages/prism-react/package.json packages/prism-react/package.json
COPY apps/api/package.json apps/api/package.json
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn workspace prism-api build:node

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
# Runtime needs only the production dependency tree (esbuild bundles the
# application code; node_modules stays external).
COPY package.json yarn.lock ./
COPY packages/types/package.json packages/types/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/email-templates/package.json packages/email-templates/package.json
COPY packages/prism-react/package.json packages/prism-react/package.json
COPY apps/api/package.json apps/api/package.json
RUN yarn install --frozen-lockfile --production --ignore-scripts && yarn cache clean
COPY --from=builder /repo/apps/api/dist-node ./apps/api/dist-node
WORKDIR /repo/apps/api
USER node
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist-node/index.node.js"]
