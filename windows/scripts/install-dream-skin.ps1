[CmdletBinding()]
param(
  [int]$Port = 9335,
  [switch]$NoShortcuts,
  [string]$InstallProfilePath
)

$ErrorActionPreference = 'Stop'
$PortExplicit = $PSBoundParameters.ContainsKey('Port')
$SkillRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')

$operationLock = Enter-DreamSkinOperationLock
try {
  Assert-DreamSkinPort -Port $Port
  $StateRoot = Get-DreamSkinDefaultStateRoot
  $null = Get-DreamSkinNodeRuntime
  $registeredInstalls = @(Get-DreamSkinRegisteredCodexInstalls)
  if ($registeredInstalls.Count -eq 0) {
    throw 'The official OpenAI.Codex Store package is not installed or its identity cannot be validated.'
  }

  $themePaths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  Ensure-DreamSkinManagedDirectory -Path $themePaths.Root -Root $themePaths.Root
  $StatePath = Join-Path $StateRoot 'state.json'
  $existingState = Read-DreamSkinState -Path $StatePath
  $savedPathCandidate = Get-DreamSkinCodexStatePathCandidate -State $existingState
  $savedCodex = Resolve-DreamSkinCodexInstallFromState -State $existingState -RegisteredInstalls $registeredInstalls
  if ($null -ne $savedPathCandidate -and $null -eq $savedCodex -and
    (Get-DreamSkinCodexProcesses -Codex $savedPathCandidate).Count -gt 0) {
    throw 'The saved Codex path is still running but no longer matches a registered Store package. Close it manually before installing.'
  }
  if (Test-DreamSkinTrayActive) {
    Stop-DreamSkinTrayProcess -ScriptRoot $PSScriptRoot
    Start-Sleep -Milliseconds 600
  }
  if (Test-DreamSkinTrayActive) {
    throw 'Skin Codex 托盘仍在运行。请从右下角托盘退出后重新安装。'
  }
  try {
    if (Stop-DreamSkinRecordedInjector -State $existingState) {
      Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    }
  } catch {
    throw "Skin Codex 注入进程仍在运行，无法安全更新运行时。请关闭 Codex 后重新安装。$($_.Exception.Message)"
  }
  $engine = Install-DreamSkinRuntimeEngine -SkillRoot $SkillRoot -StateRoot $StateRoot
  $null = Initialize-DreamSkinThemeStore -SkillRoot $engine.Root -StateRoot $StateRoot
  $installProfile = $null
  if ($InstallProfilePath) {
    $profileFullPath = [System.IO.Path]::GetFullPath($InstallProfilePath)
    if (-not (Test-Path -LiteralPath $profileFullPath -PathType Leaf)) {
      throw "Install profile does not exist: $profileFullPath"
    }
    try {
      $installProfile = Get-Content -LiteralPath $profileFullPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    } catch {
      throw "Install profile is invalid JSON: $profileFullPath"
    }
    $profileRoot = Split-Path -Parent $profileFullPath
    foreach ($themePackage in @($installProfile.themePackages)) {
      if (-not $themePackage) { continue }
      $packagePath = "$themePackage"
      if (-not [System.IO.Path]::IsPathRooted($packagePath)) {
        $packagePath = Join-Path $profileRoot $packagePath
      }
      $null = Import-DreamSkinThemePackage -PackagePath $packagePath -StateRoot $StateRoot
    }
    if ($installProfile.defaultThemeId) {
      $defaultThemeDirectory = Join-Path $themePaths.Saved "$($installProfile.defaultThemeId)"
      $null = Use-DreamSkinSavedTheme -ThemeDirectory $defaultThemeDirectory -StateRoot $StateRoot
    }
  }
  if (-not $NoShortcuts) {
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath('Desktop')
    $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
    $wscript = (Get-Command wscript.exe -ErrorAction Stop).Source
    $launcher = $engine.HiddenLauncher
    $shortcutWorkingDirectory = $engine.Root
    $shortcutPort = if ($PortExplicit) { "$Port" } else { '9335' }
    $shortcutIconSource = $null
    foreach ($candidateIcon in @(
        (Join-Path $SkillRoot 'skin-codex.ico'),
        (Join-Path $SkillRoot 'installer\skin-codex.ico'),
        (Join-Path $StateRoot 'skin-codex.ico'),
        (Join-Path $SkillRoot 'nova-skin.ico'),
        (Join-Path $SkillRoot 'installer\nova-skin.ico'),
        (Join-Path $StateRoot 'nova-skin.ico'),
        (Join-Path $StateRoot 'installer.ico'),
        (Join-Path $SkillRoot 'installer\installer.ico')
      )) {
      if (Test-Path -LiteralPath $candidateIcon -PathType Leaf) {
        $shortcutIconSource = [System.IO.Path]::GetFullPath($candidateIcon)
        break
      }
    }
    $shortcutIcon = if ($shortcutIconSource) {
      Install-DreamSkinShortcutIcon -SourceIconPath $shortcutIconSource -StateRoot $StateRoot
    } else {
      $null
    }

    @(
      (Join-Path $desktop 'Codex Dream Skin.lnk'),
      (Join-Path $desktop 'Codex Dream Skin - Restore.lnk'),
      (Join-Path $desktop 'Codex Dream Skin - Tray.lnk'),
      (Join-Path $desktop 'Nova Skin.lnk'),
      (Join-Path $desktop 'Nova Skin - Apply.lnk'),
      (Join-Path $desktop 'Nova Skin - Restore.lnk'),
      (Join-Path $desktop 'Nova Skin - Tray.lnk'),
      (Join-Path $desktop 'Skin Codex.lnk'),
      (Join-Path $desktop 'Skin Codex - Apply.lnk'),
      (Join-Path $desktop 'Skin Codex - Restore.lnk'),
      (Join-Path $desktop 'Skin Codex - Tray.lnk'),
      (Join-Path $startMenu 'Codex Dream Skin.lnk'),
      (Join-Path $startMenu 'Codex Dream Skin - Tray.lnk'),
      (Join-Path $startMenu 'Nova Skin.lnk'),
      (Join-Path $startMenu 'Nova Skin - Apply.lnk'),
      (Join-Path $startMenu 'Nova Skin - Restore.lnk'),
      (Join-Path $startMenu 'Nova Skin - Tray.lnk'),
      (Join-Path $startMenu 'Skin Codex.lnk'),
      (Join-Path $startMenu 'Skin Codex - Apply.lnk'),
      (Join-Path $startMenu 'Skin Codex - Restore.lnk'),
      (Join-Path $startMenu 'Skin Codex - Tray.lnk'),
      (Join-Path $startup 'Codex Dream Skin - Tray.lnk'),
      (Join-Path $startup 'Nova Skin - Tray.lnk'),
      (Join-Path $startup 'Nova Skin.lnk'),
      (Join-Path $startup 'Skin Codex - Tray.lnk'),
      (Join-Path $startup 'Skin Codex.lnk')
    ) | ForEach-Object { Remove-Item -LiteralPath $_ -Force -ErrorAction SilentlyContinue }

    foreach ($folder in @($desktop, $startMenu)) {
      $shortcut = $shell.CreateShortcut((Join-Path $folder 'Skin Codex.lnk'))
      $shortcut.TargetPath = $wscript
      $shortcut.Arguments = "`"$launcher`" apply $shortcutPort restart"
      $shortcut.WorkingDirectory = $shortcutWorkingDirectory
      $shortcut.Description = '打开带皮肤的 Codex'
      if ($shortcutIcon) { $shortcut.IconLocation = "$shortcutIcon,0" }
      $shortcut.Save()
    }
  }

  if ($NoShortcuts) {
    Write-Host "Skin Codex 基础主题已安装到 $($engine.Root)。"
  } else {
    Write-Host 'Skin Codex 已安装。桌面主快捷方式会打开带皮肤的 Codex。'
  }
} finally {
  Exit-DreamSkinOperationLock -Mutex $operationLock
}
