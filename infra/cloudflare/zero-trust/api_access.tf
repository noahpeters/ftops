resource "cloudflare_zero_trust_access_policy" "admin" {
  account_id       = var.account_id
  name             = "admin"
  decision         = "allow"
  session_duration = "24h"

  include {
    email = var.allowed_emails
  }
}

resource "cloudflare_zero_trust_access_application" "api" {
  account_id                = var.account_id
  name                      = "ftops-api-admin"
  domain                    = "api.from-trees.com/events*"
  type                      = "self_hosted"
  session_duration          = "24h"
  app_launcher_visible      = true
  auto_redirect_to_identity = false
  options_preflight_bypass  = true
  policies                  = [cloudflare_zero_trust_access_policy.admin.id]

  destinations {
    type = "public"
    uri  = "api.from-trees.com/events*"
  }

  destinations {
    type = "public"
    uri  = "api.from-trees.com/plan/*"
  }
}
