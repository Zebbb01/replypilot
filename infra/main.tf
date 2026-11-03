# ReplyPilot on Azure, using only free tiers and free monthly grants: Container Apps
# (consumption), Azure Database for PostgreSQL Flexible Server (B1ms, free for 12
# months on a free account), Log Analytics (daily cap under 5 GB/month).
#
# A Free Trial subscription allows one Container Apps environment per region, so a
# second app in the same region joins an existing one (container_app_environment_id).

terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {}
}

data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "random_password" "operator" {
  length  = 24
  special = false
}

locals {
  name = "${var.name_prefix}-${random_string.suffix.result}"
  tags = { app = "replypilot", cost = "free-tier" }

  own_environment = var.container_app_environment_id == ""
  environment_id  = local.own_environment ? azurerm_container_app_environment.main[0].id : var.container_app_environment_id

  database_url = "postgres://replypilot:${random_password.db.result}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/${azurerm_postgresql_flexible_server_database.app.name}?sslmode=verify-full"

  # Shared by the web app and the worker beside it.
  env = merge(
    {
      LLM_ENDPOINT    = var.llm_endpoint
      LLM_MODEL       = var.llm_model
      DAILY_DRAFT_CAP = tostring(var.daily_draft_cap)
    },
    var.shopify_shop == "" ? {} : { SHOPIFY_SHOP = var.shopify_shop },
    var.smtp_from == "" ? {} : { SMTP_FROM = var.smtp_from },
  )
  optional_secrets = {
    "llm-api-key"           = { env = "LLM_API_KEY", value = var.llm_api_key }
    "inbound-email-secret"  = { env = "INBOUND_EMAIL_SECRET", value = var.inbound_email_secret }
    "shopify-client-id"     = { env = "SHOPIFY_CLIENT_ID", value = var.shopify_client_id }
    "shopify-client-secret" = { env = "SHOPIFY_CLIENT_SECRET", value = var.shopify_client_secret }
    "smtp-url"              = { env = "SMTP_URL", value = var.smtp_url }
  }
  secrets = merge(
    {
      "database-url" = { env = "DATABASE_URL", value = local.database_url }
      "operator-key" = { env = "OPERATOR_KEY", value = random_password.operator.result }
    },
    # Only whether a secret is set leaves the sensitive values.
    { for k, s in local.optional_secrets : k => s if nonsensitive(s.value != "") },
  )
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}

resource "azurerm_log_analytics_workspace" "main" {
  count               = local.own_environment ? 1 : 0
  name                = "log-${local.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = 0.1 # about 3 GB a month, leaving room under the 5 GB free for other apps
  tags                = local.tags
}

# Free for 12 months on an Azure free account: 750 hours a month of B1ms (one
# server running all month), 32 GB of storage and 32 GB of backups.
resource "azurerm_postgresql_flexible_server" "main" {
  name                          = "psql-${local.name}"
  location                      = azurerm_resource_group.main.location
  resource_group_name           = azurerm_resource_group.main.name
  version                       = "16"
  sku_name                      = "B_Standard_B1ms"
  storage_mb                    = 32768
  storage_tier                  = "P4"
  auto_grow_enabled             = false
  backup_retention_days         = 7
  geo_redundant_backup_enabled  = false
  public_network_access_enabled = true
  administrator_login           = "replypilot"
  administrator_password        = random_password.db.result
  tags                          = local.tags

  lifecycle {
    ignore_changes = [zone] # Azure picks one
  }
}

# Lets Azure services (the Container App) connect; the server still requires TLS
# and the password.
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure" {
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = "replypilot"
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_container_app_environment" "main" {
  count                      = local.own_environment ? 1 : 0
  name                       = "cae-${local.name}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main[0].id
  logs_destination           = "log-analytics"
  tags                       = local.tags

  # Azure creates every environment with this serverless profile. It is billed
  # per second like the consumption plan and covered by the free grant.
  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

# One replica at most, scaled to zero when idle. The job worker runs as a second
# container in the same replica, so it is awake exactly when the app is.
resource "azurerm_container_app" "web" {
  name                         = "ca-${local.name}"
  container_app_environment_id = local.environment_id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = local.tags

  dynamic "secret" {
    for_each = local.secrets
    content {
      name  = secret.key
      value = secret.value.value
    }
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 0
    max_replicas = 1

    container {
      name   = "web"
      image  = var.image
      cpu    = 0.25
      memory = "0.5Gi"

      dynamic "env" {
        for_each = local.env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.secrets
        content {
          name        = env.value.env
          secret_name = env.key
        }
      }
    }

    container {
      name    = "worker"
      image   = var.image
      cpu     = 0.25
      memory  = "0.5Gi"
      command = ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "src/worker/run.ts", "--watch"]

      dynamic "env" {
        for_each = local.env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.secrets
        content {
          name        = env.value.env
          secret_name = env.key
        }
      }
    }
  }

  lifecycle {
    # The deploy workflow sets the images.
    ignore_changes = [template[0].container[0].image, template[0].container[1].image]
  }

  depends_on = [azurerm_postgresql_flexible_server_firewall_rule.azure]
}

# GitHub Actions signs in with OpenID Connect to roll out new images: no secret
# is stored in the repository.
resource "azurerm_user_assigned_identity" "deploy" {
  name                = "id-${local.name}-github"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "github_main" {
  name                      = "github-main"
  user_assigned_identity_id = azurerm_user_assigned_identity.deploy.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "${var.github_oidc_subject_prefix}:ref:refs/heads/main"
}

resource "azurerm_role_assignment" "deploy" {
  scope                = azurerm_resource_group.main.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.deploy.principal_id
}

# Rolling out a new revision checks the right to join the environment, which lives
# in another resource group when it is shared.
resource "azurerm_role_assignment" "deploy_environment" {
  count                = local.own_environment ? 0 : 1
  scope                = var.container_app_environment_id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.deploy.principal_id
}

# A 1-unit monthly budget on the resource group: an email goes out at the first
# cent of actual cost, so a change that leaves the free tiers is noticed at once.
resource "azurerm_consumption_budget_resource_group" "guard" {
  count             = var.alert_email == "" ? 0 : 1
  name              = "budget-${local.name}"
  resource_group_id = azurerm_resource_group.main.id
  amount            = 1
  time_grain        = "Monthly"

  time_period {
    start_date = formatdate("YYYY-MM-01'T'00:00:00Z", plantimestamp())
  }

  notification {
    enabled        = true
    threshold      = 1
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = [var.alert_email]
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Forecasted"
    contact_emails = [var.alert_email]
  }

  lifecycle {
    ignore_changes = [time_period]
  }
}
