resource "cloudflare_zero_trust_access_policy" "public_legal" {
  account_id = var.account_id
  name       = "public-legal"
  decision   = "bypass"

  include {
    everyone = true
  }
}

resource "cloudflare_zero_trust_access_application" "legal_privacy" {
  account_id           = var.account_id
  name                 = "ftops-legal-privacy"
  domain               = "ops.from-trees.com/legal/privacy"
  type                 = "self_hosted"
  app_launcher_visible = false
  policies             = [cloudflare_zero_trust_access_policy.public_legal.id]

  destinations {
    type = "public"
    uri  = "ops.from-trees.com/legal/privacy"
  }
}

resource "cloudflare_zero_trust_access_application" "legal_eula" {
  account_id           = var.account_id
  name                 = "ftops-legal-eula"
  domain               = "ops.from-trees.com/legal/eula"
  type                 = "self_hosted"
  app_launcher_visible = false
  policies             = [cloudflare_zero_trust_access_policy.public_legal.id]

  destinations {
    type = "public"
    uri  = "ops.from-trees.com/legal/eula"
  }
}
