# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# HR Copilot AI — frontend (Next.js)
#
# Three stages: dependencies, build, runtime. The runtime image contains the
# traced standalone output and nothing else — no source, no dev dependencies,
# no package manager, no build toolchain.
#
# ## NEXT_PUBLIC_API_BASE_URL is a BUILD-time value
#
# Anything prefixed `NEXT_PUBLIC_` is inlined into the client bundle by the
# compiler, so it must be present when `next build` runs; setting it only at
# `docker run` would leave the browser code pointing at whatever was baked in.
# It is passed as a build ARG for exactly that reason.
#
# It is the API ORIGIN, with no `/api` suffix — `lib/config.ts` appends the
# prefix itself, and a value ending in `/api` produces `/api/api/...`.
#
# This is not a secret: it is a public URL that ships to every browser anyway.
# No real secret may ever be passed this way.
# ---------------------------------------------------------------------------

# ---- Dependencies ---------------------------------------------------------
FROM node:22-alpine3.22 AS deps
WORKDIR /app

# Only the manifests, so this layer is reused whenever source changes but
# dependencies do not.
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000


# ---- Build ----------------------------------------------------------------
FROM node:22-alpine3.22 AS build
WORKDIR /app

ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
# Skips Next's anonymous build-time telemetry ping.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN yarn build


# ---- Runtime --------------------------------------------------------------
FROM node:22-alpine3.22 AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The bundled npm CLI is removed from the RUNTIME image.
#
# Nothing here runs npm — the entrypoint is node — and npm vendors its own
# copy of `tar`, which is where Trivy's only CRITICAL findings in this image
# came from. Deleting it removes a whole dependency tree we neither ship nor
# use, and shrinks the layer.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# A dedicated unprivileged user. `--system` because nothing ever logs in as it.
RUN addgroup --system --gid 10001 nodejs \
 && adduser --system --uid 10001 --ingroup nodejs nextjs

# The traced server, then the two trees Next deliberately leaves out of it.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# `public/` carries the PWA surface — manifest icons, sw.js, the offline page's
# assets. Without this copy the app would build, start, and quietly not be
# installable.
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# Liveness only. The frontend has no readiness dependency of its own: it
# proxies to the API, and a failing API must surface as the API's problem
# rather than as this container flapping.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/offline'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# The minimal server standalone output emits. `next start` is not available
# here — its CLI lives in the dev dependencies this image does not carry.
CMD ["node", "server.js"]
