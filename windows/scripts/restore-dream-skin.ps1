[CmdletBinding()]
param(
  [int]$Port = 9335,
  [switch]$Uninstall,
  [switch]$RestoreBaseTheme,
  [switch]$RecoverConfigBackup,
  [switch]$PromptRestart,
  [switch]$ForceRestart,
  [switch]$NoRelaunch
)

$ErrorActionPreference = 'Stop'
$PortExplicit = $PSBoundParameters.ContainsKey('Port')
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')

function Remove-DreamSkinShortcuts {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $commonDesktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
  $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  $commonStartMenu = Join-Path $env:PROGRAMDATA 'Microsoft\Windows\Start Menu\Programs'
  $startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
  $shortcutFolders = @($desktop, $commonDesktop, $startMenu, $commonStartMenu, $startup) |
    Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) }
  $shortcutNames = @(
    'Codex Dream Skin.lnk',
    'Codex Dream Skin - Restore.lnk',
    'Codex Dream Skin - Tray.lnk',
    'Nova Skin.lnk',
    'Nova Skin - Apply.lnk',
    'Nova Skin - Restore.lnk',
    'Nova Skin - Tray.lnk',
    'Skin Codex.lnk',
    'Skin Codex - Apply.lnk',
    'Skin Codex - Restore.lnk',
    'Skin Codex - Tray.lnk'
  )
  foreach ($folder in $shortcutFolders) {
    foreach ($shortcutName in $shortcutNames) {
      Remove-Item -LiteralPath (Join-Path $folder $shortcutName) -Force -ErrorAction SilentlyContinue
    }
  }
}

$operationLock = Enter-DreamSkinOperationLock
try {
  if ($RestoreBaseTheme -and $RecoverConfigBackup) {
    throw 'Choose either -RestoreBaseTheme or -RecoverConfigBackup, not both.'
  }
  Assert-DreamSkinPort -Port $Port
  if ($Uninstall) { Remove-DreamSkinShortcuts }

  $StateRoot = Get-DreamSkinDefaultStateRoot
  $themePaths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  Ensure-DreamSkinManagedDirectory -Path $themePaths.Root -Root $themePaths.Root
  $StatePath = Join-Path $StateRoot 'state.json'
  $state = Read-DreamSkinState -Path $StatePath
  if (-not $PortExplicit -and $null -ne $state -and $state.port) {
    $Port = [int]$state.port
    Assert-DreamSkinPort -Port $Port
  }

  $currentCodex = $null
  try { $currentCodex = Get-DreamSkinCodexInstall } catch { Write-Warning $_.Exception.Message }
  $savedPathCandidate = Get-DreamSkinCodexStatePathCandidate -State $state
  $savedCodex = Get-DreamSkinCodexInstallFromState -State $state
  $candidateMatchesCurrent = [bool]($null -ne $savedPathCandidate -and $null -ne $currentCodex -and
    (Test-DreamSkinPathEqual -Left $savedPathCandidate.PackageRoot -Right $currentCodex.PackageRoot) -and
    (Test-DreamSkinPathEqual -Left $savedPathCandidate.Executable -Right $currentCodex.Executable))
  if ($null -ne $savedPathCandidate -and $null -eq $savedCodex -and -not $candidateMatchesCurrent) {
    $unverifiedSavedRunning = (Get-DreamSkinCodexProcesses -Codex $savedPathCandidate).Count -gt 0
    $unverifiedSavedOwnsPort = Test-DreamSkinCodexPortOwner -Port $Port -Codex $savedPathCandidate
    if ($unverifiedSavedRunning -or $unverifiedSavedOwnsPort) {
      throw 'The saved Codex path is still active but no longer matches a registered OpenAI.Codex package. Close it manually; state and configuration were preserved.'
    }
  }
  $savedIsDifferent = [bool]($null -ne $savedCodex -and $null -ne $currentCodex -and
    -not (Test-DreamSkinPathEqual -Left $savedCodex.Executable -Right $currentCodex.Executable))
  $currentRunning = $null -ne $currentCodex -and (Get-DreamSkinCodexProcesses -Codex $currentCodex).Count -gt 0
  $savedRunning = $null -ne $savedCodex -and (Get-DreamSkinCodexProcesses -Codex $savedCodex).Count -gt 0
  $savedOwnsPort = $null -ne $savedCodex -and (Test-DreamSkinCodexPortOwner -Port $Port -Codex $savedCodex)
  if ($savedIsDifferent -and $currentRunning -and ($savedRunning -or $savedOwnsPort)) {
    throw 'Multiple Codex package versions are active. Close them manually before restore; state and configuration were preserved.'
  }

  $codex = $currentCodex
  if ($savedRunning -or $savedOwnsPort -or $null -eq $currentCodex) {
    $codex = $savedCodex
    if ($null -ne $codex -and $savedIsDifferent) {
      Write-Warning 'Using the saved Codex package identity to close its older active CDP session.'
    } elseif ($null -ne $codex -and $null -eq $currentCodex) {
      Write-Warning 'Using the saved Codex identity after revalidating it against the registered Store package.'
    }
  }
  $relaunchCodex = if ($null -ne $currentCodex) { $currentCodex } else { $codex }
  $codexRunning = $null -ne $codex -and (Get-DreamSkinCodexProcesses -Codex $codex).Count -gt 0
  $portOwnedByCodex = $null -ne $codex -and (Test-DreamSkinCodexPortOwner -Port $Port -Codex $codex)
  if ($portOwnedByCodex -and -not $codexRunning) {
    throw 'A Codex-owned listener exists without a manageable Codex process; state was preserved.'
  }
  if ($null -ne $state -and $null -eq $codex -and -not (Test-DreamSkinPortAvailable -Port $Port)) {
    throw "Port $Port is still active, but Codex ownership cannot be verified. State and configuration were preserved."
  }

  $shouldCloseCodex = $codexRunning
  $forceAuthorized = [bool]$ForceRestart
  if ($shouldCloseCodex -and $PromptRestart) {
    $restartMessage = if ($NoRelaunch) {
      '恢复操作将关闭 Codex，并移除 Skin Codex 皮肤会话。继续吗？'
    } else {
      '恢复操作将关闭 Codex，移除 Skin Codex 皮肤会话，然后重新打开官方应用。继续吗？'
    }
    $forceAuthorized = Confirm-DreamSkinRestart -Message $restartMessage
    if (-not $forceAuthorized) {
      Write-Host '恢复已取消；状态和配置未被修改。'
      exit 0
    }
  }

  $backup = Join-Path $StateRoot 'config.before-dream-skin.toml'
  $config = Join-Path $HOME '.codex\config.toml'
  $canRestoreBaseTheme = Test-Path -LiteralPath $backup -PathType Leaf
  if ($RestoreBaseTheme -and -not $canRestoreBaseTheme) {
    if (-not $Uninstall) { throw 'No pre-install config backup is available.' }
    Write-Warning '未找到安装前配置备份；卸载将继续清理 Skin Codex 文件和快捷方式。'
  }
  if ($RecoverConfigBackup) {
    if (-not $canRestoreBaseTheme) { throw 'No pre-install config backup is available.' }
    $null = Read-DreamSkinUtf8File -Path $backup
  } elseif ($RestoreBaseTheme -and $canRestoreBaseTheme) {
    $null = Read-DreamSkinUtf8File -Path $backup
    $null = Read-DreamSkinUtf8File -Path $config
  }

  $restoreError = $null
  try {
    Stop-DreamSkinTrayProcess -ScriptRoot $PSScriptRoot
    if ($shouldCloseCodex) {
      Stop-DreamSkinCodex -Codex $codex -AllowForce:$forceAuthorized
      if ($portOwnedByCodex -and -not (Wait-DreamSkinPortAvailable -Port $Port -TimeoutSeconds 5)) {
        throw "Port $Port is still listening after Codex closed; state was preserved for inspection."
      }
    }

    $recordedInjectorStopped = Stop-DreamSkinRecordedInjector -State $state
    if (-not $recordedInjectorStopped) {
      $staleStatePath = Archive-DreamSkinStateFile -Path $StatePath
      Write-Warning "已归档过期的 Skin Codex 状态文件：$staleStatePath"
    }

    if ($RecoverConfigBackup) {
      $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N')
      $recoveryBackup = Join-Path $StateRoot "config.before-recovery-$stamp.toml"
      Restore-DreamSkinConfigBackup -ConfigPath $config -BackupPath $backup -RecoveryBackupPath $recoveryBackup
      Write-Host "Recovered the exact pre-install config; previous current config saved at $recoveryBackup"
    } elseif ($RestoreBaseTheme -and $canRestoreBaseTheme) {
      Restore-DreamSkinBaseTheme -ConfigPath $config -BackupPath $backup
    }
    if ($RecoverConfigBackup -or ($RestoreBaseTheme -and $canRestoreBaseTheme)) {
      $archiveStamp = (Get-Date).ToString('yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N')
      $archivePath = Join-Path $StateRoot "config.restored-$archiveStamp.toml"
      Archive-DreamSkinConfigBackup -BackupPath $backup -ArchivePath $archivePath
      Write-Host "Archived the completed pre-install backup at $archivePath"
    }

    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $StateRoot 'paused') -Force -ErrorAction SilentlyContinue
    if ($Uninstall) { Remove-DreamSkinShortcuts }

    if ($shouldCloseCodex -and -not $NoRelaunch) {
      if ($null -eq $relaunchCodex -or -not (Test-Path -LiteralPath $relaunchCodex.Executable)) {
        throw 'Codex cannot be reopened because its current executable is unavailable.'
      }
      $null = Start-DreamSkinCodex -Codex $relaunchCodex
    }
  } catch {
    $restoreError = $_
    if ($shouldCloseCodex -and -not $NoRelaunch -and $null -ne $relaunchCodex -and
      (Get-DreamSkinCodexProcesses -Codex $codex).Count -eq 0 -and (Test-Path -LiteralPath $relaunchCodex.Executable)) {
      try { $null = Start-DreamSkinCodex -Codex $relaunchCodex } catch {
        Write-Warning 'Restore failed and Codex could not be reopened automatically.'
      }
    }
    throw $restoreError
  }

  Write-Host 'Skin Codex 恢复操作已完成；已关闭保存的皮肤会话。'
} finally {
  Exit-DreamSkinOperationLock -Mutex $operationLock
}
