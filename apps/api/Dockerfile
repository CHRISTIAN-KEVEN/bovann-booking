# API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t bovann-api .
# Runs `node dist/main.js`; migrations: `node dist/database/cli.js latest`.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @bovann/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @bovann/api build \
 && pnpm --filter @bovann/api deploy --prod --legacy /out \
 && rm -rf /out/src /out/test /out/*.json.bak

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
