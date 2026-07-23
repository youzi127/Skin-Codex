[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PackagePath,
  [switch]$SetActive
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')

$operationLock = Enter-DreamSkinOperationLock
try {
  $imported = Import-DreamSkinThemePackage -PackagePath $PackagePath `
    -StateRoot (Get-DreamSkinDefaultStateRoot) -SetActive:$SetActive
  Write-Host "已导入主题：$($imported.Theme.name) [$($imported.Theme.id)]"
} finally {
  Exit-DreamSkinOperationLock -Mutex $operationLock
}
