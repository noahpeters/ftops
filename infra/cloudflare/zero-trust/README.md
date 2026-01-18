# Cloudflare Zero Trust Access (Terraform)

This directory codifies Access configuration for:

- api.from-trees.com (Access application)
- shared Access policy used by api.from-trees.com and ops.from-trees.com

## Authenticate

Create a Cloudflare API token with permissions:

- Account: Zero Trust: Access: Apps (read/write)
- Account: Zero Trust: Access: Policies (read/write)

Export the token:

```sh
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID="..."
```

## Run Terraform

From this directory:

```sh
terraform init
terraform fmt
terraform validate
terraform plan \
  -var "account_id=YOUR_ACCOUNT_ID" \
  -var "environment=prod"
terraform apply \
  -var "account_id=YOUR_ACCOUNT_ID" \
  -var "environment=prod"
```

## Discovery

To inspect the current Access configuration:

```sh
node tools/discover-access.mjs --host api.from-trees.com
```

Add `--out ./.discovery.json` to save a local report.

## State audit

To inspect the current Terraform state:

```sh
node tools/state-audit.mjs
```

## Import existing Access config

Terraform 1.5+ supports import blocks (see `imports.tf`). Run `terraform plan` or `terraform apply` to execute the imports. If you prefer manual imports, use:

```sh
terraform import cloudflare_zero_trust_access_application.api 125d8016e23830dcaf86de127ce90576/9cbec375-71cf-48f0-b4c6-e93760644d13
terraform import cloudflare_zero_trust_access_policy.admin account/125d8016e23830dcaf86de127ce90576/26d82360-264b-4102-84ea-690dfe3411f8
```

If you prefer to bootstrap with cf-terraforming, use it to generate Access apps and policies for the account and then reconcile with the files here. Example (adjust for your installed cf-terraforming version):

```sh
cf-terraforming generate --resource-type access_application --account-id <account_id>
cf-terraforming generate --resource-type access_policy --account-id <account_id>
```

## No clickops

After this lands, update Access configuration via Terraform PRs only. Manual dashboard changes will be overwritten.
