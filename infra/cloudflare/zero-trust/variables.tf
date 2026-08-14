variable "account_id" {
  type        = string
  description = "Cloudflare account ID that owns Zero Trust Access."
}

variable "allowed_emails" {
  type        = list(string)
  description = "Email addresses allowed to access protected apps."
  default     = ["noah@from-trees.com"]
}

variable "allowed_email_domains" {
  type        = list(string)
  description = "Email domains allowed to access protected apps."
  default     = ["fromtrees.studio"]
}
