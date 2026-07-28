[CmdletBinding()]
param([int]$Port = 9335)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')

Assert-DreamSkinPort -Port $Port
$SkillRoot = Split-Path -Parent $PSScriptRoot
$StateRoot = Get-DreamSkinDefaultStateRoot
$paths = Initialize-DreamSkinThemeStore -SkillRoot $SkillRoot -StateRoot $StateRoot
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$wscript = (Get-Command wscript.exe -ErrorAction Stop).Source
$launcher = Join-Path $PSScriptRoot 'launch-hidden.vbs'
$AiModelAccessUrl = 'https://useaifor.me/register?aff=J7F65KDMA542'

function Get-DreamSkinTrayIconPath {
  param(
    [Parameter(Mandatory = $true)][string]$StateRoot,
    [Parameter(Mandatory = $true)][string]$SkillRoot
  )
  $latestHashedIcon = (Get-ChildItem -LiteralPath $StateRoot -Filter 'skin-codex-*.ico' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1).FullName
  foreach ($candidateIcon in @(
      (Join-Path $StateRoot 'skin-codex.ico'),
      $latestHashedIcon,
      (Join-Path $SkillRoot 'skin-codex.ico'),
      (Join-Path $SkillRoot 'installer\skin-codex.ico'),
      (Join-Path $SkillRoot 'nova-skin.ico')
    )) {
    if ($candidateIcon -and (Test-Path -LiteralPath $candidateIcon -PathType Leaf)) {
      return [System.IO.Path]::GetFullPath($candidateIcon)
    }
  }
  return $null
}
$shortcutIcon = Get-DreamSkinTrayIconPath -StateRoot $StateRoot -SkillRoot $SkillRoot
$startScript = Join-Path $PSScriptRoot 'start-dream-skin.ps1'
$restoreScript = Join-Path $PSScriptRoot 'restore-dream-skin.ps1'

$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutex = [System.Threading.Mutex]::new($false, "Local\SkinCodex.$sid.Tray")
$acquired = $false
$trayIcon = $null
try {
  try { $acquired = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }
  if (-not $acquired) { exit 0 }

  $notify = [System.Windows.Forms.NotifyIcon]::new()
  if ($shortcutIcon) {
    try {
      $trayIcon = [System.Drawing.Icon]::new($shortcutIcon)
      $notify.Icon = $trayIcon
    } catch {
      $notify.Icon = [System.Drawing.SystemIcons]::Application
    }
  } else {
    $notify.Icon = [System.Drawing.SystemIcons]::Application
  }
  $notify.Text = 'Skin Codex'
  $notify.Visible = $true
  $menu = [System.Windows.Forms.ContextMenuStrip]::new()
  $notify.ContextMenuStrip = $menu

  function Show-DreamSkinTrayError {
    param([string]$Message)
    [void][System.Windows.Forms.MessageBox]::Show(
      $Message,
      'Skin Codex',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    )
  }

  function Start-DreamSkinPowerShell {
    param([Parameter(Mandatory = $true)][string]$Script, [string[]]$Arguments = @())
    $mode = if ([System.IO.Path]::GetFileName($Script) -ieq 'restore-dream-skin.ps1') { 'restore' } else { 'apply' }
    $applyPort = Get-DreamSkinTrayApplyPort
    Start-Process -FilePath $wscript -ArgumentList "`"$launcher`" $mode $applyPort restart" -WorkingDirectory $SkillRoot `
      -WindowStyle Hidden | Out-Null
  }

  function Get-DreamSkinTrayApplyPort {
    try {
      $state = Read-DreamSkinState -Path $paths.State
      $statePort = 0
      if ($null -ne $state -and [int]::TryParse("$($state.port)", [ref]$statePort) -and
        $statePort -ge 1024 -and $statePort -le 65535) {
        return [int]$statePort
      }
    } catch {}
    return $Port
  }

  function Invoke-DreamSkinTrayReapplyTheme {
    Start-DreamSkinPowerShell -Script $startScript -Arguments @('-Port', "$Port", '-PromptRestart')
  }

  function Add-DreamSkinTrayItem {
    param(
      [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Windows.Forms.ToolStripItemCollection]$Items,
      [Parameter(Mandatory = $true)][string]$Text,
      [AllowNull()][scriptblock]$Action,
      [bool]$Enabled = $true
    )
    $item = [System.Windows.Forms.ToolStripMenuItem]::new($Text)
    $item.Enabled = $Enabled
    if ($null -ne $Action) {
      $item.add_Click({
        try { & $Action } catch { Show-DreamSkinTrayError -Message $_.Exception.Message }
      }.GetNewClosure())
    }
    [void]$Items.Add($item)
    return $item
  }

  function Rebuild-DreamSkinTrayMenu {
    $menu.Items.Clear()
    $paused = Test-DreamSkinPaused -StateRoot $StateRoot
    $state = $null
    try { $state = Read-DreamSkinState -Path $paths.State } catch {}
    $active = $null
    try { $active = Read-DreamSkinTheme -ThemeDirectory $paths.Active -SkipImageMetadata } catch {}
    $activeThemeId = if ($null -ne $active -and $null -ne $active.Theme -and $active.Theme.id) { "$($active.Theme.id)" } else { '' }
    $status = if ($paused) { '状态：已暂停' } elseif ($state) { '状态：运行中' } else { '状态：未运行' }
    if ($null -ne $active -and $null -ne $active.Theme -and $active.Theme.name) {
      $status += " · $($active.Theme.name)"
    }
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text $status -Action $null -Enabled $false
    [void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())

    $canApply = $null -ne $active
    $applyText = if ($canApply) { '应用或重新应用' } else { '请先导入主题包' }
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text $applyText -Action {
      Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
      Start-DreamSkinPowerShell -Script $startScript -Arguments @('-Port', "$Port", '-PromptRestart')
    } -Enabled:$canApply
    $pauseText = if ($paused) { '继续显示皮肤' } else { '暂停皮肤' }
    $nextPaused = -not $paused
    $pauseAction = {
      Set-DreamSkinPaused -Paused $nextPaused -StateRoot $StateRoot | Out-Null
    }.GetNewClosure()
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text $pauseText -Action $pauseAction -Enabled:$canApply
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text '更换背景图' -Action {
      $dialog = [System.Windows.Forms.OpenFileDialog]::new()
      $dialog.Title = '选择 Skin Codex 背景图'
      $dialog.Filter = 'Image files|*.png;*.jpg;*.jpeg;*.webp|All files|*.*'
      $dialog.Multiselect = $false
      try {
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
          $null = Set-DreamSkinActiveTheme -ImagePath $dialog.FileName -Theme $null -StateRoot $StateRoot
          Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
          Invoke-DreamSkinTrayReapplyTheme
          $notify.ShowBalloonTip(1800, 'Skin Codex', '背景图已更新。', [System.Windows.Forms.ToolTipIcon]::Info)
        }
      } finally {
        $dialog.Dispose()
      }
    }
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text '保存当前主题' -Action {
      $name = [Microsoft.VisualBasic.Interaction]::InputBox('输入主题名称：', '保存 Skin Codex 主题', '')
      if ($name.Trim()) {
        $saved = Save-DreamSkinCurrentTheme -Name $name -StateRoot $StateRoot
        $notify.ShowBalloonTip(1800, 'Skin Codex', "已保存：$($saved.Theme.name)", [System.Windows.Forms.ToolTipIcon]::Info)
      }
    }
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text '导入主题包' -Action {
      $dialog = [System.Windows.Forms.OpenFileDialog]::new()
      $dialog.Title = '选择 Skin Codex 主题包'
      $dialog.Filter = 'Theme packages|*.zip;theme.json|Zip files|*.zip|Theme metadata|theme.json|All files|*.*'
      $dialog.Multiselect = $false
      try {
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
          $packagePath = if ([System.IO.Path]::GetFileName($dialog.FileName) -ieq 'theme.json') {
            Split-Path -Parent $dialog.FileName
          } else {
            $dialog.FileName
          }
          $imported = Import-DreamSkinThemePackage -PackagePath $packagePath -StateRoot $StateRoot -SetActive
          Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
          Invoke-DreamSkinTrayReapplyTheme
          $notify.ShowBalloonTip(1800, 'Skin Codex', "已导入并应用：$($imported.Theme.name)", [System.Windows.Forms.ToolTipIcon]::Info)
        }
      } finally {
        $dialog.Dispose()
      }
    }

    $savedMenu = [System.Windows.Forms.ToolStripMenuItem]::new('已保存主题')
    $savedThemes = @(Get-DreamSkinSavedThemes -StateRoot $StateRoot -SkipImageMetadata)
    $deleteMenu = [System.Windows.Forms.ToolStripMenuItem]::new('删除主题')
    if ($savedThemes.Count -eq 0) {
      $empty = [System.Windows.Forms.ToolStripMenuItem]::new('暂无已保存主题')
      $empty.Enabled = $false
      [void]$savedMenu.DropDownItems.Add($empty)
      $emptyDelete = [System.Windows.Forms.ToolStripMenuItem]::new('暂无可删除主题')
      $emptyDelete.Enabled = $false
      [void]$deleteMenu.DropDownItems.Add($emptyDelete)
    } else {
      foreach ($saved in $savedThemes) {
        $savedPath = $saved.Path
        $savedName = $saved.Name
        $savedId = $saved.Id
        $isActiveTheme = ($activeThemeId -and $savedId -and
          $activeThemeId.Equals($savedId, [System.StringComparison]::Ordinal))
        $savedAction = {
          $null = Use-DreamSkinSavedTheme -ThemeDirectory $savedPath -StateRoot $StateRoot
          Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
          Invoke-DreamSkinTrayReapplyTheme
          $notify.ShowBalloonTip(1800, 'Skin Codex', "已应用：$savedName", [System.Windows.Forms.ToolTipIcon]::Info)
        }.GetNewClosure()
        $null = Add-DreamSkinTrayItem -Items $savedMenu.DropDownItems -Text $savedName -Action $savedAction
        $deleteName = if ($isActiveTheme) { "$savedName（使用中）" } else { $savedName }
        $deleteAction = {
          $confirmation = [System.Windows.Forms.MessageBox]::Show(
            ('确定删除主题 "' + $savedName + '" 吗？'),
            'Skin Codex',
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question
          )
          if ($confirmation -eq [System.Windows.Forms.DialogResult]::Yes) {
            $deleted = Remove-DreamSkinSavedTheme -ThemeDirectory $savedPath -StateRoot $StateRoot
            Rebuild-DreamSkinTrayMenu
            $notify.ShowBalloonTip(1800, 'Skin Codex', "已删除：$($deleted.Name)", [System.Windows.Forms.ToolTipIcon]::Info)
          }
        }.GetNewClosure()
        $null = Add-DreamSkinTrayItem -Items $deleteMenu.DropDownItems -Text $deleteName -Action $deleteAction -Enabled:(-not $isActiveTheme)
      }
    }
    [void]$menu.Items.Add($savedMenu)
    [void]$menu.Items.Add($deleteMenu)

    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text 'AI 模型接入' -Action {
      Start-Process -FilePath $AiModelAccessUrl | Out-Null
    }
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text '打开图片文件夹' -Action {
      Start-Process -FilePath explorer.exe -ArgumentList @($paths.Images) | Out-Null
    }
    [void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text '完全恢复 Codex' -Action {
      Start-DreamSkinPowerShell -Script $restoreScript -Arguments @(
        '-Port', "$Port", '-RestoreBaseTheme', '-PromptRestart'
      )
      $notify.Visible = $false
      [System.Windows.Forms.Application]::Exit()
    }
    $null = Add-DreamSkinTrayItem -Items $menu.Items -Text '退出托盘' -Action {
      $notify.Visible = $false
      [System.Windows.Forms.Application]::Exit()
    }
  }

  $menu.add_Opening({ Rebuild-DreamSkinTrayMenu })
  $notify.add_DoubleClick({
    try {
      if (-not (Test-Path -LiteralPath (Join-Path $paths.Active 'theme.json') -PathType Leaf)) {
        throw '请先从托盘导入主题包。'
      }
      Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
      Start-DreamSkinPowerShell -Script $startScript -Arguments @('-Port', "$Port", '-PromptRestart')
    } catch {
      Show-DreamSkinTrayError -Message $_.Exception.Message
    }
  })
  [System.Windows.Forms.Application]::Run()
} finally {
  if ($null -ne $notify) { $notify.Dispose() }
  if ($null -ne $trayIcon) { $trayIcon.Dispose() }
  if ($acquired) { try { $mutex.ReleaseMutex() } catch {} }
  $mutex.Dispose()
}
