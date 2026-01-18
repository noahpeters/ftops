# Contributing to ftops

**Do not finish unless `npm run verify` would pass.**

This rule applies to human-written changes, Codex / AI-assisted changes, schema migrations, API changes, and UI changes.

## Overview

ftops is a Cloudflare Workers + D1 ops system. We prioritize correctness, idempotency, and deterministic behavior across APIs, migrations, and workflows.

## The Golden Rule

**Do not finish unless `npm run verify` would pass.**

This rule matters because git hooks and deploy guards enforce it anyway. Following it early avoids wasted time and broken deploys.

## Key npm scripts (API repo)

Daily development:

- `wrangler dev`
- `npm run gen:migrations` (usually automatic via prebuild/pretest hooks)

Quality gates:

- `npm run format`
- `npm run format:check`
- `npm run lint`
- `npm run lint:fix`
- `npm run typecheck`

Tests:

- `npm run test`
- `npm run test:unit`
- `npm run test:int`
- `npm run test:watch`

Bundled workflows:

- `npm run tidy` (format:check + lint + typecheck + test:unit)
- `npm run verify` (tidy + test:int)

Deploy:

- `npm run deploy`
- `npm run deploy:dev`
- `npm run deploy:prod`
- `npm run deploy:unsafe` (bypasses tests; use only when explicitly necessary)

## Git hooks

This repo uses `simple-git-hooks`:

- pre-commit → `npm run tidy`
- pre-push → `npm run verify`

If hooks stop running, re-enable them:

```bash
npm run prepare
```

## Migrations

- `migrations/*.sql` is the source of truth.
- `src/generated/migrationsManifest.ts` is auto-generated.
- Run `npm run gen:migrations` whenever migrations change (prebuild/pretest run this automatically).

Create/list/apply migrations:

```bash
npm run db:migrations:create
npm run db:migrations:list:local
npm run db:migrations:list:remote
npm run db:migrate:local
npm run db:migrate:remote
```

## D1 helpers

```bash
npm run db:execute -- "SELECT 1;"
npm run db:execute:remote -- "SELECT 1;"
```

## Multi-tenancy conventions

- `workspace_id` is the tenant boundary.
- Integrations route provider webhooks to workspaces.
- Secrets are encrypted in D1, not stored per-tenant in env.
- One deployment serves many tenants.

## Working with Codex / AI

Every Codex prompt must include:

- “Do not finish unless `npm run verify` would pass.”

Recommended prompt structure:

- Validation Contract block
- VERIFY CHECKLIST at the end of prompts

## PR / change hygiene

- Keep changes small and scoped.
- Schema changes require migrations.
- Add tests for non-trivial logic.

## Troubleshooting

Manifest out of date:

- Run `npm run gen:migrations` and re-run `npm run verify`.

Commit/push blocked by hooks:

- Fix failing checks or run `npm run prepare` if hooks were disabled.

Local vs remote migration mismatch:

- Compare `db:migrations:list:local` vs `db:migrations:list:remote`, then apply missing migrations.

**Do not finish unless `npm run verify` would pass.**
