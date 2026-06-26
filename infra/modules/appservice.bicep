param location string
param tags object
param planName string
param siteName string
param skuName string
param storageAccountName string
param fileShareName string
@secure()
param storageAccountKey string
param appInsightsConnectionString string
param logAnalyticsWorkspaceId string
param raceProvider string
@secure()
param raceMonitorToken string

var siteUrl = 'https://${siteName}.azurewebsites.net'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuName == 'F1' ? 'Free' : (startsWith(skuName, 'B') ? 'Basic' : 'PremiumV3')
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: siteName
  location: location
  tags: tags
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      alwaysOn: skuName != 'F1'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/api/health'
      appCommandLine: 'npm start'
      appSettings: [
        { name: 'WEBSITES_PORT', value: '8080' }
        { name: 'PORT', value: '8080' }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~22' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        { name: 'ENABLE_ORYX_BUILD', value: 'true' }
        { name: 'DATABASE_PATH', value: '/home/site/data/racing.sqlite' }
        { name: 'CLIENT_ORIGIN', value: siteUrl }
        { name: 'RACE_PROVIDER', value: raceProvider }
        { name: 'RACE_MONITOR_BASE_URL', value: 'https://api.race-monitor.com' }
        { name: 'RACE_MONITOR_TOKEN', value: raceMonitorToken }
        { name: 'JWT_SECRET', value: uniqueString(resourceGroup().id, siteName, 'jwt') }
        { name: 'JWT_EXPIRES_IN', value: '7d' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
      ]
    }
  }
}

// Mount the Azure Files share to /home/site/data so the SQLite file persists
// across restarts and deployments.
resource storageMount 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: site
  name: 'azurestorageaccounts'
  properties: {
    data: {
      type: 'AzureFiles'
      accountName: storageAccountName
      shareName: fileShareName
      accessKey: storageAccountKey
      mountPath: '/home/site/data'
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: site
  name: 'to-law'
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      { category: 'AppServiceHTTPLogs', enabled: true }
      { category: 'AppServiceConsoleLogs', enabled: true }
      { category: 'AppServiceAppLogs', enabled: true }
      { category: 'AppServicePlatformLogs', enabled: true }
    ]
    metrics: [
      { category: 'AllMetrics', enabled: true }
    ]
  }
}

output siteName string = site.name
output siteUrl string = siteUrl
output principalId string = site.identity.principalId
