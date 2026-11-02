variable "location" {
  description = "Azure region. Southeast Asia is closest to the Philippines. If the free PostgreSQL server is refused there (\"LocationIsOfferRestricted\"), try eastasia or eastus."
  type        = string
  default     = "southeastasia"
}

variable "name_prefix" {
  description = "Prefix for resource names; a random suffix keeps global names unique."
  type        = string
  default     = "replypilot"
}

variable "image" {
  description = "Container image for the web app and the worker. The deploy workflow replaces it on each release."
  type        = string
  default     = "ghcr.io/zebbb01/replypilot:latest"
}

variable "github_oidc_subject_prefix" {
  description = "Start of the subject GitHub puts in the repository's OpenID Connect tokens. New repositories use immutable IDs (repo:OWNER@OWNER_ID/REPO@REPO_ID); print yours with: gh api repos/OWNER/REPO/actions/oidc/customization/sub"
  type        = string
}

variable "alert_email" {
  description = "Email for the cost alert (a 1-unit monthly budget that warns at the first cent spent). Empty skips the alert."
  type        = string
  default     = ""
}

variable "llm_api_key" {
  description = "Key for the model: a GitHub token with models:read for GitHub Models' free tier."
  type        = string
  sensitive   = true
}

variable "llm_endpoint" {
  description = "OpenAI-compatible endpoint with tool calling."
  type        = string
  default     = "https://models.github.ai/inference"
}

variable "llm_model" {
  description = "Model name at that endpoint."
  type        = string
  default     = "openai/gpt-4.1-mini"
}

variable "daily_draft_cap" {
  description = "Drafts per day across the whole app. GitHub Models' free tier allows about 150 requests a day, and a draft takes about three."
  type        = number
  default     = 40
}

# The live inbox (all optional). Without a store, live tickets use the sample orders.

variable "shopify_shop" {
  description = "Shopify dev store subdomain (the part before .myshopify.com)."
  type        = string
  default     = ""
}

variable "shopify_client_id" {
  description = "Client ID of the Dev Dashboard app installed on the store. Not a secret, but stored as one with the others."
  type        = string
  default     = ""
  sensitive   = true
}

variable "shopify_client_secret" {
  description = "Client secret of that app; it also verifies webhook signatures."
  type        = string
  default     = ""
  sensitive   = true
}

variable "inbound_email_secret" {
  description = "Password for the inbound email webhook (HTTP basic auth in the Postmark webhook URL)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "smtp_url" {
  description = "SMTP URL for sending approved live replies, such as smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465. Empty keeps them in the outbox."
  type        = string
  default     = ""
  sensitive   = true
}

variable "smtp_from" {
  description = "From address for live replies, such as \"Kettle & Pine Support <you@gmail.com>\"."
  type        = string
  default     = ""
}
