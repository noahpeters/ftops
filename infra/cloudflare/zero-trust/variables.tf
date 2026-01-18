variable "account_id" {
  type        = string
  description = "Cloudflare account ID that owns Zero Trust Access."
}

variable "environment" {
  type        = string
  description = "Environment name used to prefix Access resources (e.g. prod, sandbox)."
  default     = "prod"
}

variable "allowed_emails" {
  type        = list(string)
  description = "Email addresses allowed to access protected apps."
  default     = ["noah@from-trees.com"]
}

variable "allowed_email_domains" {
  type        = list(string)
  description = "Email domains allowed to access protected apps."
  default     = []
}

variable "session_duration" {
  type        = string
  description = "Session duration for Access applications."
  default     = "24h"
}
