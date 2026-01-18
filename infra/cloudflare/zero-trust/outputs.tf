output "api_application_id" {
  description = "Access application ID for api.from-trees.com."
  value       = cloudflare_zero_trust_access_application.api.id
}

output "admin_policy_id" {
  description = "Reusable Access policy ID shared across apps."
  value       = cloudflare_zero_trust_access_policy.admin.id
}
