# Cal, production image. One image runs both processes of the stack:
#   node dist/start.mjs     the web app (applies the database migrations first)   [default]
#   node dist/worker.mjs    the background worker (photo analysis, push messages)
#   node dist/cal.mjs ...   the server tool (invites, resets, food data)
# Built by deploy/Start.ps1 through docker compose; the Node version is pinned in deploy/.env.
ARG NODE_VERSION=24.22.1-alpine3.24

# ---- dependencies (reused while package.json and the lockfile stay the same) ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1 CI=true
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build: Next.js standalone server, the server scripts bundled with their libraries ----
# `pnpm run build` copies the barcode WebAssembly, builds Next.js and bundles dist/*.mjs.
# Source maps are deleted here so the final image never has them. The standalone trace also copies
# the sources of lib/photos (a dynamic file path); the compiled app does not need them.
FROM deps AS build
COPY . .
RUN pnpm run build \
 && find .next/standalone .next/static dist -name '*.map' -type f -delete \
 && rm -rf .next/standalone/.next/cache .next/standalone/lib

# ---- runtime: no package manager, no build tools, runs as the unprivileged node user ----
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 \
    PHOTO_ROOT=/data/photos FDC_CACHE_DIR=/var/cache/cal-fdc
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && mkdir -p /data/photos /var/cache/cal-fdc \
 && chown node:node /data/photos /var/cache/cal-fdc
WORKDIR /app
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
COPY --from=build /src/public ./public
COPY --from=build /src/drizzle ./drizzle
COPY --from=build /src/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/start.mjs"]
