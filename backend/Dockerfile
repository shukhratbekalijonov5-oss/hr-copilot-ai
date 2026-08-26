# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# HR Copilot AI — backend (NestJS)
#
# ## Alpine is safe here, because there is no native Prisma engine
#
# The schema uses the `prisma-client` generator with `@prisma/adapter-pg`, so
# database access goes through the pg driver rather than a platform-specific
# query-engine binary. That removes the usual musl/glibc trap: there is no
# `binaryTargets` to keep in step with the base image.
#
# ## The queue lives in this process, deliberately
#
# BullMQ processors are registered inside the Nest application, so this one
# image is both the API and the worker. Splitting them would need a second
# image, a second deployment and a shared Redis contract — none of which the
# product needs yet, and all of which would have to be undone to add later.
#
# ## Nothing is baked in
#
# No `.env`, no DATABASE_URL, no INTERNAL_SERVICE_TOKEN, no Redis or Kafka
# credential. Every one arrives from the environment at run time, and
# `.dockerignore` keeps the local `.env` out of the build context entirely.
# ---------------------------------------------------------------------------

# ---- Dependencies ---------------------------------------------------------
FROM node:22-alpine3.22 AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# The Prisma schema must be present: `postinstall` runs `prisma generate`, and
# without it the install fails rather than silently producing no client.
COPY prisma ./prisma

# `npm ci` for a reproducible tree from the lockfile. Dev dependencies are
# needed here because the Nest CLI and TypeScript compile the next stage.
RUN npm ci


# ---- Build ----------------------------------------------------------------
FROM node:22-alpine3.22 AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/generated ./src/generated
COPY . .

# `nest build` compiles src → dist, including the generated Prisma client that
# the generator wrote into `src/generated/prisma`.
RUN npm run build

# A second, production-only tree for the runtime stage. Installed separately
# rather than pruned in place so the lockfile still decides the result.
#
# `--ignore-scripts` is required, not cosmetic: `postinstall` runs
# `prisma generate`, and the Prisma CLI is a DEV dependency, so the script
# cannot run in a production-only tree. It does not need to — the generated
# client was compiled into `dist/generated/prisma` by the build above, and
# `@prisma/client` plus `@prisma/adapter-pg` are runtime dependencies that
# ship normally. No other dependency here has a meaningful install script:
# pg, ioredis and bullmq are all pure JavaScript.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force


# ---- Runtime --------------------------------------------------------------
FROM node:22-alpine3.22 AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001

# `dumb-init` is PID 1 so signals actually reach node. Without it a container
# stop sends SIGTERM to a shell that never forwards it, Nest's
# `enableShutdownHooks` never fires, and in-flight BullMQ jobs are killed
# rather than drained.
RUN apk add --no-cache dumb-init \
 && addgroup --system --gid 10001 nodejs \
 && adduser --system --uid 10001 --ingroup nodejs nest

# The bundled npm CLI is removed from the RUNTIME image.
#
# Nothing here runs npm — the entrypoint is node — and npm vendors its own
# copy of `tar`, which is where Trivy's only CRITICAL findings in this image
# came from. Deleting it removes a whole dependency tree we neither ship nor
# use, and shrinks the layer.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx


COPY --from=build --chown=nest:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nest:nodejs /app/dist ./dist
COPY --from=build --chown=nest:nodejs /app/package.json ./package.json
# Shipped so `prisma migrate deploy` can be run as a one-off Job against this
# same image; the container itself never migrates on boot.
COPY --from=build --chown=nest:nodejs /app/prisma ./prisma

USER nest

EXPOSE 3001

# Liveness only. `/api/health/ready` also checks Postgres and Redis, which is
# the orchestrator's readiness probe — using it here would restart a healthy
# container every time a dependency blipped.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3001,path:'/api/health/live'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]
