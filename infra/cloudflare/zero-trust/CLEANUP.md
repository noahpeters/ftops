# Cleanup Checklist (Cloudflare Access)

Use this checklist only if discovery shows duplicates (multiple Access apps for the same hostname or duplicate policies).

## 1) Discover

```sh
node tools/discover-access.mjs --out ./.discovery.json
```

Review the output for duplicate hostnames or multiple policies with the same purpose.

## 2) Decide which resource to keep

Prefer the resource that:

- matches the hostname/path in production
- is referenced by current Access logs or known traffic
- has the expected policy attached

## 3) Import the correct resources

Ensure Terraform is managing the intended resources by importing the chosen IDs:

```sh
terraform plan -var "account_id=..."
```

If needed, use `terraform import ...` commands from `README.md`.

## 4) Remove accidental duplicates (only when identified)

If an accidental duplicate was created by Terraform and is not referenced by code/state:

1. Remove it from state (if present):

```sh
terraform state rm <resource_address>
```

2. Delete it from Cloudflare (CLI/API or Terraform once it is clearly isolated).

## 5) Verify

```sh
terraform plan -var "account_id=..."
```

Plan should be empty after cleanup.
