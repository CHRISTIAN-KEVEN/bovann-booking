# Bovann OCD Live — booking system

Online booking for the Bovann OCD Live live-stream studio in Lomé: customers choose in-studio or virtual, pick a date, book 1h30 slots or discounted packages, and pay by mobile money or card. Owners manage everything from an admin area.

- Requirements: [docs/requirements.md](docs/requirements.md)
- Architecture & data model: [docs/architecture.md](docs/architecture.md)
- Payment providers analysis: [docs/payment-providers-analysis.md](docs/payment-providers-analysis.md)
- API reference: [docs/api.md](docs/api.md)
- Progress & next steps: [docs/progress.md](docs/progress.md)

## Repository layout

```
apps/api          NestJS REST API (MySQL via Kysely)
apps/web          Next.js customer site + admin
packages/shared   Shared domain types and helpers
infra/            Docker Compose for local services
docs/             Product and technical documentation
```

## Prerequisites

- Node.js 22 (`.nvmrc`) and pnpm 10 (`corepack enable`)
- Docker (for local MySQL and Mailpit), or a local MySQL 8

## Getting started

```bash
pnpm install
docker compose -f infra/docker-compose.dev.yml up -d   # MySQL + Mailpit
cp apps/api/.env.example apps/api/.env
pnpm --filter @bovann/shared build
pnpm db:migrate        # create the t_ tables
pnpm db:seed           # studio, hours, packages, prices
pnpm dev:api           # http://localhost:3001/health/ready
pnpm dev:web           # http://localhost:3000
```

## Everyday commands

| Command                                                                        | What it does                                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm format`                                 | Code quality                                                                            |
| `pnpm test`                                                                    | Unit + integration tests (integration needs `DATABASE_URL_TEST`, a disposable database) |
| `pnpm db:migrate` / `pnpm db:rollback` / `pnpm --filter @bovann/api db:status` | Database migrations                                                                     |
| `pnpm db:seed`                                                                 | Re-apply reference data (safe to run repeatedly)                                        |
| `pnpm build`                                                                   | Production builds of all packages                                                       |

## Conventions

- All database tables are prefixed `t_`; times are stored in UTC; amounts are whole XOF.
- Critical business rules are enforced by the database (constraints), not only in code.
- Never edit a migration that has run outside your machine: add a new one.
- Every change goes through a pull request with green CI.
