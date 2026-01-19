resource "cloudflare_zero_trust_access_policy" "admin" {
  account_id       = var.account_id
  name             = "admin"
  decision         = "allow"
  session_duration = "24h"

  include {
    email = var.allowed_emails
  }
}
