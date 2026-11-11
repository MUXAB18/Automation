# syntax=docker/dockerfile:1.7
# Worker and database tooling (migrations, seed). Runs TypeScript with tsx; no build step.
# Build context: the repository root.
#   docker build -f docker/Dockerfile.app -t automation-app .

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# Create the user first and install as that user: no slow recursive chown of node_modules afterwards.
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app --create-home --home-dir /home/app app \
  && mkdir /app && chown app:app /app
USER app
WORKDIR /app
ENV NODE_ENV=production

COPY --chown=app:app package.json package-lock.json ./
COPY --chown=app:app apps/web/package.json apps/web/package.json
COPY --chown=app:app apps/worker/package.json apps/worker/package.json
COPY --chown=app:app packages/config/package.json packages/config/package.json
COPY --chown=app:app packages/db/package.json packages/db/package.json
COPY --chown=app:app packages/integrations/package.json packages/integrations/package.json
COPY --chown=app:app packages/reports/package.json packages/reports/package.json
COPY --chown=app:app prisma ./prisma
COPY --chown=app:app prisma.config.ts ./
# Dev dependencies are required on purpose: tsx and the prisma CLI run the worker, migrations and seed.
RUN --mount=type=cache,target=/home/app/.npm,uid=1001,gid=1001 npm ci --include=dev

COPY --chown=app:app apps/worker apps/worker
COPY --chown=app:app packages packages
COPY --chown=app:app tsconfig.base.json ./
RUN npm run db:generate

# Default: the worker. Overridden by the migrate and seed services.
CMD ["npx", "tsx", "apps/worker/src/index.ts"]
