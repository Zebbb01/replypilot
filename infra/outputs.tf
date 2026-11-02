output "app_url" {
  value = "https://${azurerm_container_app.web.ingress[0].fqdn}"
}

output "resource_group" {
  value = azurerm_resource_group.main.name
}

output "container_app" {
  value = azurerm_container_app.web.name
}

output "operator_key" {
  description = "Signs in to the live inbox. Print it with: terraform output -raw operator_key"
  value       = random_password.operator.result
  sensitive   = true
}

# Repository variables for the deploy workflow (none of these is a secret).
output "github_variables" {
  value = {
    AZURE_CLIENT_ID       = azurerm_user_assigned_identity.deploy.client_id
    AZURE_TENANT_ID       = data.azurerm_client_config.current.tenant_id
    AZURE_SUBSCRIPTION_ID = data.azurerm_client_config.current.subscription_id
    AZURE_RESOURCE_GROUP  = azurerm_resource_group.main.name
    AZURE_CONTAINER_APP   = azurerm_container_app.web.name
  }
}
