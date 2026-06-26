targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment used to generate a short, unique hash for resources.')
param environmentName string

@minLength(1)
@description('Primary location for all resources.')
param location string

@description('Optional principal ID of the user/SP running azd; future use for Key Vault role assignments.')
param principalId string = ''

@allowed([
  'F1'
  'B1'
  'B2'
  'P0v3'
  'P1v3'
])
@description('App Service Plan SKU.')
param appServiceSku string = 'B1'

@description('Race provider mode: "mock" or "racemonitor".')
param raceProvider string = 'mock'

@secure()
@description('Optional Race Monitor API token. Leave blank to use the mock provider.')
param raceMonitorToken string = ''

var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var resourcePrefix = 'racing'
var tags = {
  'azd-env-name': environmentName
  workload: 'racing-app'
  department: 'DP'
  application: 'racing-app'
  environment: 'dev'
  Owner: 'epingel@vermeer.com'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: rg
  params: {
    location: location
    tags: tags
    logAnalyticsName: '${resourcePrefix}-logs-${resourceToken}'
    appInsightsName: '${resourcePrefix}-ai-${resourceToken}'
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  scope: rg
  params: {
    location: location
    tags: tags
    storageAccountName: take(toLower(replace('${resourcePrefix}data${resourceToken}', '-', '')), 24)
    fileShareName: 'data'
  }
}

module appservice 'modules/appservice.bicep' = {
  name: 'appservice'
  scope: rg
  params: {
    location: location
    tags: union(tags, { 'azd-service-name': 'web' })
    planName: '${resourcePrefix}-plan-${resourceToken}'
    siteName: '${resourcePrefix}-app-${resourceToken}'
    skuName: appServiceSku
    storageAccountName: storage.outputs.storageAccountName
    fileShareName: storage.outputs.fileShareName
    storageAccountKey: storage.outputs.primaryKey
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    logAnalyticsWorkspaceId: monitoring.outputs.workspaceId
    raceProvider: raceProvider
    raceMonitorToken: raceMonitorToken
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = rg.name
output WEB_APP_NAME string = appservice.outputs.siteName
output WEB_APP_URL string = appservice.outputs.siteUrl
output APPLICATIONINSIGHTS_CONNECTION_STRING string = monitoring.outputs.appInsightsConnectionString
