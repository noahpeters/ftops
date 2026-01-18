resource "cloudflare_zero_trust_access_application" "ops" {
  account_id                = var.account_id
  name                      = "ftops-ui"
  domain                    = "ops.from-trees.com/*"
  type                      = "self_hosted"
  session_duration          = "24h"
  app_launcher_visible      = true
  auto_redirect_to_identity = false
  options_preflight_bypass  = false
  policies                  = [cloudflare_zero_trust_access_policy.admin.id]

  destinations {
    type = "public"
    uri  = "ops.from-trees.com/*"
  }
}
