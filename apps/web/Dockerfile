# Website image (Next.js standalone). Build from the repository root:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_PAYMENT_SIMULATION=true -t bovann-web .
# NEXT_PUBLIC_* values are read at BUILD time: one image per environment.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_PAYMENT_SIMULATION=false
ARG NEXT_PUBLIC_SPACE_SLUG=studio-principal-lome
ARG NEXT_PUBLIC_STUDIO_CONTACT_PHONE=
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ENV NEXT_PUBLIC_API_URL= \
    NEXT_PUBLIC_PAYMENT_SIMULATION=$NEXT_PUBLIC_PAYMENT_SIMULATION \
    NEXT_PUBLIC_SPACE_SLUG=$NEXT_PUBLIC_SPACE_SLUG \
    NEXT_PUBLIC_STUDIO_CONTACT_PHONE=$NEXT_PUBLIC_STUDIO_CONTACT_PHONE \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @bovann/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @bovann/web build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
