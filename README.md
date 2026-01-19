# ftops monorepo

This repo contains the ftops API (Cloudflare Worker + D1) and UI (React Router SSR on a Cloudflare Worker), plus shared infrastructure as code.

## Repo layout

- `apps/api` - Cloudflare Worker API, D1 migrations, queues
- `apps/ui` - React Router SSR UI deployed as a Cloudflare Worker
- `infra/cloudflare/zero-trust` - Terraform for Cloudflare Zero Trust Access

## Getting started

```sh
npm install
```

## Local development

```sh
npm run dev
```

Or individually:

```sh
npm run dev:api
npm run dev:ui
```

## Verification

```sh
npm run verify
```

## Deploy

```sh
npm run deploy:api
npm run deploy:ui
```

## Infrastructure

From `infra/cloudflare/zero-trust`:

```sh
terraform init
terraform plan -var "account_id=..."
```

Access configs are managed via Terraform only.

## CI/CD secrets

Set these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN` - token with Workers and Zero Trust Access permissions
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account ID

## CI equivalents (local)

```sh
npm ci
npm run verify
cd infra/cloudflare/zero-trust
terraform fmt -check -recursive
terraform validate
terraform plan -var "account_id=..."
```
