if (-not (Get-Command Read-DreamSkinUtf8File -ErrorAction SilentlyContinue)) {
  . (Join-Path $PSScriptRoot 'config-utf8.ps1')
}

if (-not (Get-Command Get-DreamSkinDefaultStateRoot -ErrorAction SilentlyContinue)) {
  function Get-DreamSkinDefaultStateRoot {
    return Join-Path $env:LOCALAPPDATA 'SkinCodex'
  }
}

$script:DreamSkinMaxImageBytes = 16 * 1024 * 1024
$script:DreamSkinMaxThemeCssBytes = 512 * 1024
$script:DreamSkinMaxThemeComponentsBytes = 64 * 1024
$script:DreamSkinMaxThemeExperienceBytes = 12 * 1024
$script:DreamSkinMaxThemeAssetBytes = 8 * 1024 * 1024
$script:DreamSkinMaxThemeAssetsBytes = 24 * 1024 * 1024

function Assert-DreamSkinNoReparseComponents {
  param([Parameter(Mandatory = $true)][string]$Path)
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetPathRoot($fullPath)
  $current = $fullPath
  while ($true) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Managed Dream Skin path contains a junction or symbolic link: $current"
      }
    }
    $currentNormalized = $current.TrimEnd('\')
    $rootNormalized = $root.TrimEnd('\')
    if ($currentNormalized.Equals($rootNormalized, [System.StringComparison]::OrdinalIgnoreCase)) { break }
    $parent = [System.IO.Path]::GetDirectoryName($current)
    if (-not $parent -or $parent.Equals($current, [System.StringComparison]::OrdinalIgnoreCase)) { break }
    $current = $parent
  }
}

function Ensure-DreamSkinManagedDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Root
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  if (-not ($fullPath.Equals($fullRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      $fullPath.StartsWith($fullRoot + '\', [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "Managed Dream Skin path escaped its state root: $fullPath"
  }
  Assert-DreamSkinNoReparseComponents -Path $fullPath
  if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
    throw "Managed Dream Skin path is a file, not a directory: $fullPath"
  }
  New-Item -ItemType Directory -Force -Path $fullPath | Out-Null
  Assert-DreamSkinNoReparseComponents -Path $fullPath
  if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
    throw "Managed Dream Skin directory could not be created: $fullPath"
  }
}

function Assert-DreamSkinNoReparseDescendants {
  param([Parameter(Mandatory = $true)][string]$Path)
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  Assert-DreamSkinNoReparseComponents -Path $fullPath
  if (-not (Test-Path -LiteralPath $fullPath)) { return }
  foreach ($item in Get-ChildItem -LiteralPath $fullPath -Force -Recurse -ErrorAction Stop) {
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Managed Dream Skin path contains a junction or symbolic link: $($item.FullName)"
    }
  }
}

function Get-DreamSkinValidatedImageMetadata {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Get-Command Get-DreamSkinNodeRuntime -ErrorAction SilentlyContinue)) {
    throw 'Node.js runtime validation is unavailable for image metadata checks.'
  }
  $node = Get-DreamSkinNodeRuntime
  $metadataScript = Join-Path $PSScriptRoot 'image-metadata.mjs'
  $output = @(& $node.Path $metadataScript '--check' ([System.IO.Path]::GetFullPath($Path)) 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Image metadata is invalid or exceeds the 16384px / 50MP safety limit: $Path"
  }
  try { $metadata = ($output -join "`n") | ConvertFrom-Json -ErrorAction Stop } catch {
    throw "Image metadata helper returned invalid output: $Path"
  }
  if ($null -eq $metadata -or $null -eq $metadata.width -or $null -eq $metadata.height) {
    throw "Image metadata is invalid or exceeds the 16384px / 50MP safety limit: $Path"
  }
}

function Assert-DreamSkinImageFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$SkipImageMetadata
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Image does not exist: $fullPath"
  }
  $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
  if ($extension -notin @('.png', '.jpg', '.jpeg', '.webp')) {
    throw "Unsupported image format: $extension"
  }
  $length = (Get-Item -LiteralPath $fullPath -Force).Length
  if ($length -lt 1) { throw 'Theme image cannot be empty.' }
  if ($length -gt $script:DreamSkinMaxImageBytes) {
    throw 'Theme image exceeds the 16 MB limit.'
  }
  if (-not $SkipImageMetadata) {
    Get-DreamSkinValidatedImageMetadata -Path $fullPath
  }
}

function Get-DreamSkinThemePaths {
  param([string]$StateRoot)
  if (-not $StateRoot) { $StateRoot = Get-DreamSkinDefaultStateRoot }
  $fullRoot = [System.IO.Path]::GetFullPath($StateRoot)
  return [pscustomobject]@{
    Root = $fullRoot
    Active = Join-Path $fullRoot 'active-theme'
    Saved = Join-Path $fullRoot 'themes'
    Images = Join-Path $fullRoot 'images'
    PauseFile = Join-Path $fullRoot 'paused'
    State = Join-Path $fullRoot 'state.json'
  }
}

function Test-DreamSkinThemePathWithin {
  param([string]$Path, [string]$Root)
  if (-not $Path -or -not $Root) { return $false }
  try {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    $inside = $fullPath.Equals($fullRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      $fullPath.StartsWith($fullRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)
    if (-not $inside) { return $false }

    $current = $fullPath.TrimEnd('\')
    while ($true) {
      if (-not (Test-Path -LiteralPath $current)) { return $false }
      $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        return $false
      }
      if ($current.Equals($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
      }
      $parent = [System.IO.Path]::GetDirectoryName($current)
      if (-not $parent -or $parent.Equals($current, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $false
      }
      $current = $parent.TrimEnd('\')
    }
  } catch {
    return $false
  }
}

function Read-DreamSkinTheme {
  param(
    [Parameter(Mandatory = $true)][string]$ThemeDirectory,
    [switch]$SkipImageMetadata
  )
  $directory = [System.IO.Path]::GetFullPath($ThemeDirectory)
  Assert-DreamSkinNoReparseComponents -Path $directory
  $themePath = Join-Path $directory 'theme.json'
  Assert-DreamSkinNoReparseComponents -Path $themePath
  if (-not (Test-Path -LiteralPath $themePath -PathType Leaf)) {
    throw "Theme metadata is missing: $themePath"
  }
  try {
    $theme = (Read-DreamSkinUtf8File -Path $themePath) | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw "Theme metadata is invalid JSON: $themePath"
  }
  if ($null -eq $theme -or $theme -is [string] -or $theme -is [array] -or -not $theme.image) {
    throw "Theme metadata must be an object with a relative image path: $themePath"
  }
  $image = "$($theme.image)"
  if ([System.IO.Path]::IsPathRooted($image)) { throw 'Theme image path must be relative.' }
  $imagePath = [System.IO.Path]::GetFullPath((Join-Path $directory $image))
  if (-not (Test-DreamSkinThemePathWithin -Path $imagePath -Root $directory) -or
    -not (Test-Path -LiteralPath $imagePath -PathType Leaf)) {
    throw 'Theme image must remain inside its theme directory and exist.'
  }
  Assert-DreamSkinImageFile -Path $imagePath -SkipImageMetadata:$SkipImageMetadata
  if ($theme.style -and $theme.style.css) {
    $css = "$($theme.style.css)"
    if ([System.IO.Path]::IsPathRooted($css)) { throw 'Theme CSS path must be relative.' }
    Assert-DreamSkinThemeCssFile -Path ([System.IO.Path]::GetFullPath((Join-Path $directory $css))) -ThemeRoot $directory
  } elseif (Test-Path -LiteralPath (Join-Path $directory 'theme.css') -PathType Leaf) {
    Assert-DreamSkinThemeCssFile -Path (Join-Path $directory 'theme.css') -ThemeRoot $directory
  }
  $componentsRelativePath = $null
  if ($theme.components -and $theme.components.file) {
    $componentsRelativePath = "$($theme.components.file)"
  } elseif (Test-Path -LiteralPath (Join-Path $directory 'components.json') -PathType Leaf) {
    $componentsRelativePath = 'components.json'
  }
  if ($componentsRelativePath) {
    if ([System.IO.Path]::IsPathRooted($componentsRelativePath)) {
      throw 'Theme components path must be relative.'
    }
    Assert-DreamSkinThemeComponentsFile `
      -Path ([System.IO.Path]::GetFullPath((Join-Path $directory $componentsRelativePath))) `
      -ThemeRoot $directory
  }
  $experienceProperty = $theme.PSObject.Properties['experience']
  if ($null -ne $experienceProperty) {
    $experienceConfig = $experienceProperty.Value
    if ($null -eq $experienceConfig -or $experienceConfig -isnot [pscustomobject] -or
      -not $experienceConfig.file) {
      throw 'Theme experience must be an object with a file.'
    }
    $experienceRelativePath = "$($experienceConfig.file)"
    if ([System.IO.Path]::IsPathRooted($experienceRelativePath)) {
      throw 'Theme experience path must be relative.'
    }
    Assert-DreamSkinThemeExperienceFile `
      -Path ([System.IO.Path]::GetFullPath((Join-Path $directory $experienceRelativePath))) `
      -ThemeRoot $directory
  }
  return [pscustomobject]@{
    Directory = $directory
    ThemePath = $themePath
    ImagePath = $imagePath
    Theme = $theme
  }
}

function Write-DreamSkinTheme {
  param(
    [Parameter(Mandatory = $true)][string]$ThemeDirectory,
    [Parameter(Mandatory = $true)][object]$Theme
  )
  Assert-DreamSkinNoReparseComponents -Path $ThemeDirectory
  New-Item -ItemType Directory -Force -Path $ThemeDirectory | Out-Null
  Assert-DreamSkinNoReparseComponents -Path $ThemeDirectory
  $json = $Theme | ConvertTo-Json -Depth 8
  $themePath = Join-Path $ThemeDirectory 'theme.json'
  Assert-DreamSkinNoReparseComponents -Path $themePath
  Write-DreamSkinUtf8FileAtomically -Path $themePath -Content ($json + "`r`n")
}

function Assert-DreamSkinThemeCssFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ThemeRoot
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullRoot = [System.IO.Path]::GetFullPath($ThemeRoot)
  if (-not (Test-DreamSkinThemePathWithin -Path $fullPath -Root $fullRoot)) {
    throw 'Theme CSS must remain inside its theme directory.'
  }
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Theme CSS does not exist: $fullPath"
  }
  if ([System.IO.Path]::GetExtension($fullPath).ToLowerInvariant() -cne '.css') {
    throw 'Theme CSS must be a .css file.'
  }
  $length = (Get-Item -LiteralPath $fullPath -Force).Length
  if ($length -lt 1) { throw 'Theme CSS cannot be empty.' }
  if ($length -gt $script:DreamSkinMaxThemeCssBytes) {
    throw 'Theme CSS exceeds the 512 KB limit.'
  }
  $css = Read-DreamSkinUtf8File -Path $fullPath
  if ($css -match '(?i)@import\s' -or
    $css -match '(?i)url\(\s*["'']?\s*(?:https?:|data:|file:|javascript:|//)') {
    throw 'Theme CSS cannot import or reference external URLs.'
  }
}

function Assert-DreamSkinThemeAssetFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AssetsRoot
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullAssetsRoot = [System.IO.Path]::GetFullPath($AssetsRoot)
  if (-not (Test-DreamSkinThemePathWithin -Path $fullPath -Root $fullAssetsRoot)) {
    throw 'Theme asset must remain inside its assets directory.'
  }
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Theme asset does not exist: $fullPath"
  }
  $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
  if ($extension -notin @('.png', '.jpg', '.jpeg', '.webp', '.svg')) {
    throw "Unsupported theme asset format: $extension"
  }
  $length = (Get-Item -LiteralPath $fullPath -Force).Length
  if ($length -lt 1) { throw 'Theme asset cannot be empty.' }
  if ($length -gt $script:DreamSkinMaxThemeAssetBytes) {
    throw 'Theme asset exceeds the 8 MB per-file limit.'
  }
  if ($extension -in @('.png', '.jpg', '.jpeg', '.webp')) {
    Assert-DreamSkinImageFile -Path $fullPath
  }
}

function Assert-DreamSkinComponentText {
  param(
    [AllowNull()][object]$Value,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][int]$MaxLength,
    [switch]$Required
  )
  if ($null -eq $Value) {
    if ($Required) { throw "Theme components $Name is required." }
    return
  }
  if ($Value -isnot [string]) { throw "Theme components $Name must be text." }
  $text = "$Value"
  if (($Required -and -not $text.Trim()) -or $text.Length -gt $MaxLength -or $text -match '[\u0000-\u001f]') {
    throw "Theme components $Name is invalid or exceeds $MaxLength characters."
  }
}

function Assert-DreamSkinComponentImageReference {
  param(
    [AllowNull()][object]$Value,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$ThemeRoot
  )
  if ($null -eq $Value -or -not "$Value".Trim()) { return }
  if ($Value -isnot [string] -or [System.IO.Path]::IsPathRooted("$Value")) {
    throw "Theme components $Name must be a relative image path."
  }
  $normalized = "$Value" -replace '/', '\'
  if (-not $normalized.StartsWith('assets\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Theme components $Name must remain inside the assets directory."
  }
  $assetsRoot = [System.IO.Path]::GetFullPath((Join-Path $ThemeRoot 'assets'))
  $imagePath = [System.IO.Path]::GetFullPath((Join-Path $ThemeRoot $normalized))
  if (-not (Test-DreamSkinThemePathWithin -Path $imagePath -Root $assetsRoot)) {
    throw "Theme components $Name escaped the assets directory."
  }
  Assert-DreamSkinThemeAssetFile -Path $imagePath -AssetsRoot $assetsRoot
  if ([System.IO.Path]::GetExtension($imagePath).ToLowerInvariant() -eq '.svg') {
    throw "Theme components $Name must use PNG, JPEG, or WebP."
  }
}

function Assert-DreamSkinThemeComponentsFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ThemeRoot
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullRoot = [System.IO.Path]::GetFullPath($ThemeRoot)
  if (-not (Test-DreamSkinThemePathWithin -Path $fullPath -Root $fullRoot) -or
    -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw 'Theme components file must remain inside its theme directory and exist.'
  }
  if ([System.IO.Path]::GetExtension($fullPath).ToLowerInvariant() -cne '.json') {
    throw 'Theme components file must be JSON.'
  }
  $length = (Get-Item -LiteralPath $fullPath -Force).Length
  if ($length -lt 2 -or $length -gt $script:DreamSkinMaxThemeComponentsBytes) {
    throw 'Theme components file must be between 2 bytes and 64 KB.'
  }
  try { $components = (Read-DreamSkinUtf8File -Path $fullPath) | ConvertFrom-Json -ErrorAction Stop } catch {
    throw 'Theme components file contains invalid JSON.'
  }
  if ($null -eq $components -or $components -is [string] -or $components -is [array] -or
    $components.schemaVersion -ne 1 -or $null -eq $components.home) {
    throw 'Theme components must be a schemaVersion 1 object with a home section.'
  }
  $homeConfig = $components.home
  Assert-DreamSkinComponentText -Value $homeConfig.eyebrow -Name 'home.eyebrow' -MaxLength 60
  Assert-DreamSkinComponentText -Value $homeConfig.title -Name 'home.title' -MaxLength 100 -Required
  Assert-DreamSkinComponentText -Value $homeConfig.subtitle -Name 'home.subtitle' -MaxLength 180
  Assert-DreamSkinComponentText -Value $homeConfig.status -Name 'home.status' -MaxLength 60
  Assert-DreamSkinComponentImageReference -Value $homeConfig.heroImage -Name 'home.heroImage' -ThemeRoot $fullRoot
  $cards = @($homeConfig.cards)
  if ($cards.Count -gt 4) { throw 'Theme components home.cards supports at most four cards.' }
  for ($index = 0; $index -lt $cards.Count; $index += 1) {
    $card = $cards[$index]
    if ($null -eq $card -or $card -is [string] -or $card -is [array]) {
      throw "Theme components home.cards[$index] must be an object."
    }
    Assert-DreamSkinComponentText -Value $card.title -Name "home.cards[$index].title" -MaxLength 60 -Required
    Assert-DreamSkinComponentText -Value $card.description -Name "home.cards[$index].description" -MaxLength 120
    Assert-DreamSkinComponentImageReference -Value $card.icon -Name "home.cards[$index].icon" -ThemeRoot $fullRoot
    if ($null -eq $card.action -or $card.action.type -notin @('focus-composer', 'insert-prompt', 'native-suggestion')) {
      throw "Theme components home.cards[$index].action is not whitelisted."
    }
    if ($card.action.type -eq 'insert-prompt') {
      Assert-DreamSkinComponentText -Value $card.action.value -Name "home.cards[$index].action.value" -MaxLength 1000 -Required
    }
    if ($card.action.type -eq 'native-suggestion') {
      $nativeIndex = 0
      if (-not [int]::TryParse("$($card.action.index)", [ref]$nativeIndex) -or $nativeIndex -lt 0 -or $nativeIndex -gt 3) {
        throw "Theme components home.cards[$index].action.index must be between 0 and 3."
      }
    }
  }
  if ($homeConfig.note) {
    Assert-DreamSkinComponentText -Value $homeConfig.note.title -Name 'home.note.title' -MaxLength 60
    $lines = @($homeConfig.note.lines)
    if ($lines.Count -gt 4) { throw 'Theme components home.note.lines supports at most four lines.' }
    for ($index = 0; $index -lt $lines.Count; $index += 1) {
      Assert-DreamSkinComponentText -Value $lines[$index] -Name "home.note.lines[$index]" -MaxLength 80 -Required
    }
  }
  if ($components.task) {
    if ($components.task -is [string] -or $components.task -is [array]) {
      throw 'Theme components task must be an object.'
    }
    Assert-DreamSkinComponentText -Value $components.task.eyebrow -Name 'task.eyebrow' -MaxLength 60
    Assert-DreamSkinComponentText -Value $components.task.title -Name 'task.title' -MaxLength 100 -Required
    Assert-DreamSkinComponentText -Value $components.task.subtitle -Name 'task.subtitle' -MaxLength 180
    Assert-DreamSkinComponentText -Value $components.task.status -Name 'task.status' -MaxLength 60
    Assert-DreamSkinComponentImageReference -Value $components.task.heroImage -Name 'task.heroImage' -ThemeRoot $fullRoot
  }
}

function Assert-DreamSkinThemeExperienceFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ThemeRoot
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullRoot = [System.IO.Path]::GetFullPath($ThemeRoot)
  if (-not (Test-DreamSkinThemePathWithin -Path $fullPath -Root $fullRoot) -or
    -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw 'Theme experience file must remain inside its theme directory and exist.'
  }
  if ([System.IO.Path]::GetExtension($fullPath).ToLowerInvariant() -cne '.json') {
    throw 'Theme experience file must be JSON.'
  }
  $length = (Get-Item -LiteralPath $fullPath -Force).Length
  if ($length -lt 2 -or $length -gt $script:DreamSkinMaxThemeExperienceBytes) {
    throw 'Theme experience file must be between 2 bytes and 12 KB.'
  }
  try { $experience = (Read-DreamSkinUtf8File -Path $fullPath) | ConvertFrom-Json -ErrorAction Stop } catch {
    throw 'Theme experience file contains invalid JSON.'
  }
  if ($null -eq $experience -or $experience -isnot [pscustomobject] -or
    $experience.schemaVersion -ne 1 -or $null -eq $experience.content -or
    $experience.content -isnot [pscustomobject]) {
    throw 'Theme experience must be a schemaVersion 1 object with a content section.'
  }
  $allowedRoot = @('schemaVersion', 'content', 'controls')
  foreach ($property in $experience.PSObject.Properties.Name) {
    if ($property -notin $allowedRoot) { throw "Theme experience has an unknown key: $property" }
  }
  $allowedContent = @('codeBlock', 'inlineCode', 'quote', 'table', 'callout', 'commandOutput', 'toolResult', 'fileReference')
  foreach ($name in $experience.content.PSObject.Properties.Name) {
    if ($name -notin $allowedContent) { throw "Theme experience.content has an unknown key: $name" }
    $entry = $experience.content.$name
    if ($null -eq $entry -or $entry -isnot [pscustomobject]) {
      throw "Theme experience.content.$name must be an object."
    }
    foreach ($entryProperty in $entry.PSObject.Properties.Name) {
      if ($entryProperty -notin @('surface', 'density')) {
        throw "Theme experience.content.$name has an unknown key: $entryProperty"
      }
    }
    if ($null -eq $entry.surface -and $null -eq $entry.density) {
      throw "Theme experience.content.$name must declare surface or density."
    }
    if ($null -ne $entry.surface -and "$($entry.surface)" -notin @('plain', 'soft', 'raised')) {
      throw "Theme experience.content.$name.surface must be one of: plain, soft, raised."
    }
    if ($null -ne $entry.density -and "$($entry.density)" -notin @('compact', 'comfortable', 'spacious')) {
      throw "Theme experience.content.$name.density must be one of: compact, comfortable, spacious."
    }
  }
  if ($null -ne $experience.controls) {
    if ($experience.controls -isnot [pscustomobject]) {
      throw 'Theme experience.controls must be an object.'
    }
    foreach ($property in $experience.controls.PSObject.Properties.Name) {
      if ($property -ne 'feedback') { throw "Theme experience.controls has an unknown key: $property" }
    }
    if ($null -ne $experience.controls.feedback -and
      "$($experience.controls.feedback)" -notin @('quiet', 'responsive', 'expressive')) {
      throw 'Theme experience.controls.feedback must be one of: quiet, responsive, expressive.'
    }
  }
}

function Copy-DreamSkinThemeAdvancedFiles {
  param(
    [Parameter(Mandatory = $true)][string]$SourceThemeRoot,
    [Parameter(Mandatory = $true)][string]$DestinationThemeRoot,
    [Parameter(Mandatory = $true)][object]$Theme
  )
  $sourceRoot = [System.IO.Path]::GetFullPath($SourceThemeRoot)
  $destinationRoot = [System.IO.Path]::GetFullPath($DestinationThemeRoot)
  $cssRelativePath = $null
  if ($Theme.style -and $Theme.style.css) {
    $cssRelativePath = "$($Theme.style.css)"
  } elseif (Test-Path -LiteralPath (Join-Path $sourceRoot 'theme.css') -PathType Leaf) {
    if (-not $Theme.style) {
      $Theme | Add-Member -NotePropertyName style -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    $Theme.style | Add-Member -NotePropertyName css -NotePropertyValue 'theme.css' -Force
    $cssRelativePath = 'theme.css'
  }
  if ($cssRelativePath) {
    if ([System.IO.Path]::IsPathRooted($cssRelativePath)) { throw 'Theme CSS path must be relative.' }
    $sourceCss = [System.IO.Path]::GetFullPath((Join-Path $sourceRoot $cssRelativePath))
    Assert-DreamSkinThemeCssFile -Path $sourceCss -ThemeRoot $sourceRoot
    Copy-Item -LiteralPath $sourceCss -Destination (Join-Path $destinationRoot 'theme.css') -Force
    $Theme.style.css = 'theme.css'
  }
  $componentsRelativePath = $null
  if ($Theme.components -and $Theme.components.file) {
    $componentsRelativePath = "$($Theme.components.file)"
  } elseif (Test-Path -LiteralPath (Join-Path $sourceRoot 'components.json') -PathType Leaf) {
    if (-not $Theme.components) {
      $Theme | Add-Member -NotePropertyName components -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    $Theme.components | Add-Member -NotePropertyName file -NotePropertyValue 'components.json' -Force
    $componentsRelativePath = 'components.json'
  }
  if ($componentsRelativePath) {
    if ([System.IO.Path]::IsPathRooted($componentsRelativePath)) {
      throw 'Theme components path must be relative.'
    }
    $sourceComponents = [System.IO.Path]::GetFullPath((Join-Path $sourceRoot $componentsRelativePath))
    Assert-DreamSkinThemeComponentsFile -Path $sourceComponents -ThemeRoot $sourceRoot
    Copy-Item -LiteralPath $sourceComponents -Destination (Join-Path $destinationRoot 'components.json') -Force
    $Theme.components.file = 'components.json'
  }
  $experienceRelativePath = $null
  if ($Theme.experience -and $Theme.experience.file) {
    $experienceRelativePath = "$($Theme.experience.file)"
  }
  if ($experienceRelativePath) {
    if ([System.IO.Path]::IsPathRooted($experienceRelativePath)) {
      throw 'Theme experience path must be relative.'
    }
    $sourceExperience = [System.IO.Path]::GetFullPath((Join-Path $sourceRoot $experienceRelativePath))
    Assert-DreamSkinThemeExperienceFile -Path $sourceExperience -ThemeRoot $sourceRoot
    if (-not $Theme.experience) {
      $Theme | Add-Member -NotePropertyName experience -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    Copy-Item -LiteralPath $sourceExperience -Destination (Join-Path $destinationRoot 'experience.json') -Force
    $Theme.experience.file = 'experience.json'
  }
  $sourceAssets = Join-Path $sourceRoot 'assets'
  if (Test-Path -LiteralPath $sourceAssets -PathType Container) {
    Assert-DreamSkinNoReparseComponents -Path $sourceAssets
    $totalBytes = [int64]0
    foreach ($asset in Get-ChildItem -LiteralPath $sourceAssets -Recurse -File -Force -ErrorAction Stop) {
      Assert-DreamSkinThemeAssetFile -Path $asset.FullName -AssetsRoot $sourceAssets
      $totalBytes += $asset.Length
      if ($totalBytes -gt $script:DreamSkinMaxThemeAssetsBytes) {
        throw 'Theme assets exceed the 24 MB total limit.'
      }
    }
    $destinationAssets = Join-Path $destinationRoot 'assets'
    if (Test-Path -LiteralPath $destinationAssets) {
      Assert-DreamSkinNoReparseComponents -Path $destinationAssets
      Remove-Item -LiteralPath $destinationAssets -Recurse -Force -ErrorAction Stop
    }
    Copy-Item -LiteralPath $sourceAssets -Destination $destinationRoot -Recurse -Force
    Assert-DreamSkinNoReparseComponents -Path $destinationAssets
  }
}

function Clear-DreamSkinThemeAdvancedFiles {
  param([Parameter(Mandatory = $true)][string]$ThemeDirectory)
  $themeRoot = [System.IO.Path]::GetFullPath($ThemeDirectory)
  foreach ($relativePath in @('theme.css', 'components.json', 'experience.json', 'assets')) {
    $target = [System.IO.Path]::GetFullPath((Join-Path $themeRoot $relativePath))
    if (Test-Path -LiteralPath $target) {
      if (-not (Test-DreamSkinThemePathWithin -Path $target -Root $themeRoot)) {
        throw 'Theme advanced file cleanup escaped its theme directory.'
      }
      Assert-DreamSkinNoReparseComponents -Path $target
      Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
    }
  }
}

function ConvertTo-DreamSkinImportedTheme {
  param([Parameter(Mandatory = $true)][object]$Theme)
  $imported = $Theme | ConvertTo-Json -Depth 16 | ConvertFrom-Json
  if ($null -eq $imported -or $imported -is [string] -or $imported -is [array]) {
    throw 'Theme package metadata must be a JSON object.'
  }
  if (-not $imported.id) { throw 'Theme package metadata must include id.' }
  $id = "$($imported.id)"
  if ($id -cnotmatch '^[a-z0-9][a-z0-9._-]{0,79}$') {
    throw 'Theme package id must be lowercase letters, numbers, dots, underscores, or dashes.'
  }
  if (-not $imported.name) {
    $imported | Add-Member -NotePropertyName name -NotePropertyValue $id -Force
  }
  if (-not $imported.appearance) {
    $imported | Add-Member -NotePropertyName appearance -NotePropertyValue 'auto' -Force
  }
  if (-not $imported.art) {
    $imported | Add-Member -NotePropertyName art -NotePropertyValue `
      ([pscustomobject]@{ focusX = $null; focusY = $null; safeArea = 'auto'; taskMode = 'auto' }) -Force
  } else {
    if (-not $imported.art.PSObject.Properties['focusX']) { $imported.art | Add-Member -NotePropertyName focusX -NotePropertyValue $null -Force }
    if (-not $imported.art.PSObject.Properties['focusY']) { $imported.art | Add-Member -NotePropertyName focusY -NotePropertyValue $null -Force }
    if (-not $imported.art.safeArea) { $imported.art | Add-Member -NotePropertyName safeArea -NotePropertyValue 'auto' -Force }
    if (-not $imported.art.taskMode) { $imported.art | Add-Member -NotePropertyName taskMode -NotePropertyValue 'auto' -Force }
  }
  if (-not $imported.palette) {
    $imported | Add-Member -NotePropertyName palette -NotePropertyValue ([pscustomobject]@{}) -Force
  }
  if (-not $imported.palette.accent -and $imported.colors -and $imported.colors.accent) {
    $imported.palette | Add-Member -NotePropertyName accent -NotePropertyValue "$($imported.colors.accent)" -Force
  }
  return $imported
}

function Get-DreamSkinThemePackageRoot {
  param([Parameter(Mandatory = $true)][string]$Directory)
  $root = [System.IO.Path]::GetFullPath($Directory)
  Assert-DreamSkinNoReparseComponents -Path $root
  $direct = Join-Path $root 'theme.json'
  if (Test-Path -LiteralPath $direct -PathType Leaf) { return $root }
  $candidates = @(Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction Stop | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName 'theme.json') -PathType Leaf
  })
  if ($candidates.Count -eq 1) { return [System.IO.Path]::GetFullPath($candidates[0].FullName) }
  if ($candidates.Count -eq 0) { throw 'Theme package does not contain theme.json.' }
  throw 'Theme package contains multiple theme.json files; import one theme at a time.'
}

function Import-DreamSkinThemePackage {
  param(
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [string]$StateRoot,
    [switch]$SetActive
  )
  if (-not $StateRoot) { $StateRoot = Get-DreamSkinDefaultStateRoot }
  $paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  Ensure-DreamSkinManagedDirectory -Path $paths.Root -Root $paths.Root
  Ensure-DreamSkinManagedDirectory -Path $paths.Saved -Root $paths.Root
  $package = [System.IO.Path]::GetFullPath($PackagePath)
  Assert-DreamSkinNoReparseComponents -Path $package
  $temporaryRoot = $null
  try {
    $packageRoot = $package
    if (Test-Path -LiteralPath $package -PathType Leaf) {
      if ([System.IO.Path]::GetExtension($package).ToLowerInvariant() -cne '.zip') {
        throw 'Theme package file must be a .zip archive.'
      }
      $temporaryRoot = Join-Path $paths.Root ('.theme-import-' + [guid]::NewGuid().ToString('N'))
      Ensure-DreamSkinManagedDirectory -Path $temporaryRoot -Root $paths.Root
      Expand-Archive -LiteralPath $package -DestinationPath $temporaryRoot -Force
      Assert-DreamSkinNoReparseComponents -Path $temporaryRoot
      $packageRoot = Get-DreamSkinThemePackageRoot -Directory $temporaryRoot
    } elseif (Test-Path -LiteralPath $package -PathType Container) {
      $packageRoot = Get-DreamSkinThemePackageRoot -Directory $package
    } else {
      throw "Theme package path does not exist: $package"
    }

    $loaded = Read-DreamSkinTheme -ThemeDirectory $packageRoot
    $theme = ConvertTo-DreamSkinImportedTheme -Theme $loaded.Theme
    $themeId = "$($theme.id)"
    $destination = Join-Path $paths.Saved $themeId
    $fullDestination = [System.IO.Path]::GetFullPath($destination)
    $fullSavedRoot = [System.IO.Path]::GetFullPath($paths.Saved).TrimEnd('\')
    if (-not ($fullDestination.Equals($fullSavedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        $fullDestination.StartsWith($fullSavedRoot + '\', [System.StringComparison]::OrdinalIgnoreCase))) {
      throw 'Theme package id resolved outside the saved themes folder.'
    }
    if (Test-Path -LiteralPath $destination) {
      Assert-DreamSkinNoReparseComponents -Path $destination
      Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction Stop
    }
    Ensure-DreamSkinManagedDirectory -Path $destination -Root $paths.Root
    $imageExtension = [System.IO.Path]::GetExtension($loaded.ImagePath).ToLowerInvariant()
    $imageName = 'background' + $imageExtension
    Copy-Item -LiteralPath $loaded.ImagePath -Destination (Join-Path $destination $imageName) -Force
    $theme.image = $imageName
    Copy-DreamSkinThemeAdvancedFiles -SourceThemeRoot $packageRoot -DestinationThemeRoot $destination -Theme $theme
    Write-DreamSkinTheme -ThemeDirectory $destination -Theme $theme
    $imported = Read-DreamSkinTheme -ThemeDirectory $destination
    if ($SetActive) {
      $null = Use-DreamSkinSavedTheme -ThemeDirectory $destination -StateRoot $StateRoot
    }
    return $imported
  } finally {
    if ($temporaryRoot -and (Test-Path -LiteralPath $temporaryRoot)) {
      Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Initialize-DreamSkinThemeStore {
  param(
    [Parameter(Mandatory = $true)][string]$SkillRoot,
    [string]$StateRoot
  )
  if (-not $StateRoot) { $StateRoot = Get-DreamSkinDefaultStateRoot }
  $paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  foreach ($directory in @($paths.Root, $paths.Active, $paths.Saved, $paths.Images)) {
    Ensure-DreamSkinManagedDirectory -Path $directory -Root $paths.Root
  }
  $assetRoot = Join-Path $SkillRoot 'assets'
  $assetImage = Join-Path $assetRoot 'dream-reference.jpg'
  Assert-DreamSkinImageFile -Path $assetImage
  $activeTheme = Join-Path $paths.Active 'theme.json'
  Assert-DreamSkinNoReparseComponents -Path $activeTheme
  if (-not (Test-Path -LiteralPath $activeTheme -PathType Leaf)) {
    Ensure-DreamSkinManagedDirectory -Path $paths.Active -Root $paths.Root
    Assert-DreamSkinNoReparseComponents -Path (Join-Path $paths.Active 'dream-reference.jpg')
    $activeImage = Join-Path $paths.Active 'dream-reference.jpg'
    Copy-Item -LiteralPath (Join-Path $assetRoot 'dream-reference.jpg') `
      -Destination $activeImage -Force
    Assert-DreamSkinNoReparseComponents -Path $activeImage
    Assert-DreamSkinImageFile -Path $activeImage
    $imageArchive = Join-Path $paths.Images 'dream-reference.jpg'
    Assert-DreamSkinNoReparseComponents -Path $imageArchive
    Copy-Item -LiteralPath (Join-Path $assetRoot 'dream-reference.jpg') `
      -Destination $imageArchive -Force
    Assert-DreamSkinNoReparseComponents -Path $imageArchive
    Assert-DreamSkinImageFile -Path $imageArchive
    Assert-DreamSkinNoReparseComponents -Path $activeTheme
    Copy-Item -LiteralPath (Join-Path $assetRoot 'theme.json') -Destination $activeTheme -Force
  }
  $bundledThemesRoot = Join-Path $SkillRoot 'bundled-themes'
  if (Test-Path -LiteralPath $bundledThemesRoot -PathType Container) {
    Assert-DreamSkinNoReparseComponents -Path $bundledThemesRoot
    foreach ($bundledTheme in Get-ChildItem -LiteralPath $bundledThemesRoot -Directory -Force -ErrorAction Stop) {
      $themeDirectory = [System.IO.Path]::GetFullPath($bundledTheme.FullName)
      Assert-DreamSkinNoReparseComponents -Path $themeDirectory
      $null = Import-DreamSkinThemePackage -PackagePath $themeDirectory -StateRoot $StateRoot
    }
  }
  $null = Read-DreamSkinTheme -ThemeDirectory $paths.Active
  return $paths
}

function New-DreamSkinThemeImageName {
  param([Parameter(Mandatory = $true)][string]$Extension)
  return 'art-' + (Get-Date).ToString('yyyyMMdd-HHmmss-fff') + '-' +
    [guid]::NewGuid().ToString('N').Substring(0, 8) + $Extension.ToLowerInvariant()
}

function Set-DreamSkinActiveTheme {
  param(
    [Parameter(Mandatory = $true)][string]$ImagePath,
    [AllowNull()][object]$Theme,
    [string]$Name,
    [string]$StateRoot
  )
  if (-not $StateRoot) { $StateRoot = Get-DreamSkinDefaultStateRoot }
  $paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  Ensure-DreamSkinManagedDirectory -Path $paths.Root -Root $paths.Root
  Ensure-DreamSkinManagedDirectory -Path $paths.Active -Root $paths.Root
  Ensure-DreamSkinManagedDirectory -Path $paths.Images -Root $paths.Root
  $source = [System.IO.Path]::GetFullPath($ImagePath)
  Assert-DreamSkinImageFile -Path $source
  $extension = [System.IO.Path]::GetExtension($source).ToLowerInvariant()
  $oldImage = $null
  try { $oldImage = (Read-DreamSkinTheme -ThemeDirectory $paths.Active).ImagePath } catch {}
  Clear-DreamSkinThemeAdvancedFiles -ThemeDirectory $paths.Active
  if ($null -eq $Theme) {
    $Theme = [pscustomobject]@{
      id = 'custom'
      name = 'Custom theme'
      appearance = 'auto'
      art = [pscustomobject]@{ focusX = $null; focusY = $null; safeArea = 'auto'; taskMode = 'auto' }
      palette = [pscustomobject]@{}
    }
  }
  $imageName = New-DreamSkinThemeImageName -Extension $extension
  $target = Join-Path $paths.Active $imageName
  $temporary = Join-Path $paths.Active ('.dream-tmp-' + [guid]::NewGuid().ToString('N') + $extension)
  try {
    Assert-DreamSkinNoReparseComponents -Path $target
    Assert-DreamSkinNoReparseComponents -Path $temporary
    Copy-Item -LiteralPath $source -Destination $temporary -Force
    Assert-DreamSkinNoReparseComponents -Path $temporary
    Assert-DreamSkinImageFile -Path $temporary
    Move-Item -LiteralPath $temporary -Destination $target -Force
    Assert-DreamSkinNoReparseComponents -Path $target
    Assert-DreamSkinImageFile -Path $target
    $Theme | Add-Member -NotePropertyName image -NotePropertyValue $imageName -Force
    if ($Name) { $Theme | Add-Member -NotePropertyName name -NotePropertyValue $Name -Force }
    if (-not $Theme.id) { $Theme | Add-Member -NotePropertyName id -NotePropertyValue 'custom' -Force }
    if (-not $Theme.appearance) { $Theme | Add-Member -NotePropertyName appearance -NotePropertyValue 'auto' -Force }
    if (-not $Theme.art) {
      $Theme | Add-Member -NotePropertyName art -NotePropertyValue `
        ([pscustomobject]@{ focusX = $null; focusY = $null; safeArea = 'auto'; taskMode = 'auto' }) -Force
    }
    if (-not $Theme.palette) {
      $Theme | Add-Member -NotePropertyName palette -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    $sourceThemeRoot = Split-Path -Parent $source
    if (($Theme.style -and $Theme.style.css) -or ($Theme.components -and $Theme.components.file) -or
      ($Theme.experience -and $Theme.experience.file) -or
      (Test-Path -LiteralPath (Join-Path $sourceThemeRoot 'theme.css') -PathType Leaf) -or
      (Test-Path -LiteralPath (Join-Path $sourceThemeRoot 'components.json') -PathType Leaf)) {
      Copy-DreamSkinThemeAdvancedFiles -SourceThemeRoot $sourceThemeRoot -DestinationThemeRoot $paths.Active -Theme $Theme
    }
    Write-DreamSkinTheme -ThemeDirectory $paths.Active -Theme $Theme
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
  $sameImage = $oldImage -and ([System.IO.Path]::GetFullPath($oldImage) -ieq [System.IO.Path]::GetFullPath($target))
  if ($oldImage -and -not $sameImage -and
    (Test-DreamSkinThemePathWithin -Path $oldImage -Root $paths.Active)) {
    Remove-Item -LiteralPath $oldImage -Force -ErrorAction SilentlyContinue
  }
  $imageArchive = Join-Path $paths.Images $imageName
  Assert-DreamSkinNoReparseComponents -Path $imageArchive
  Copy-Item -LiteralPath $target -Destination $imageArchive -Force
  Assert-DreamSkinNoReparseComponents -Path $imageArchive
  Assert-DreamSkinImageFile -Path $imageArchive
  return Read-DreamSkinTheme -ThemeDirectory $paths.Active
}

function Save-DreamSkinCurrentTheme {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$StateRoot
  )
  if (-not $StateRoot) { $StateRoot = Get-DreamSkinDefaultStateRoot }
  $trimmed = $Name.Trim()
  if (-not $trimmed -or $trimmed.Length -gt 80 -or $trimmed -match '[\u0000-\u001f]') {
    throw 'Theme name must be between 1 and 80 visible characters.'
  }
  $paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  Ensure-DreamSkinManagedDirectory -Path $paths.Root -Root $paths.Root
  Ensure-DreamSkinManagedDirectory -Path $paths.Saved -Root $paths.Root
  $active = Read-DreamSkinTheme -ThemeDirectory $paths.Active
  $id = (Get-Date).ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
  $destination = Join-Path $paths.Saved $id
  Ensure-DreamSkinManagedDirectory -Path $destination -Root $paths.Root
  $extension = [System.IO.Path]::GetExtension($active.ImagePath).ToLowerInvariant()
  $imageName = 'art' + $extension
  $destinationImage = Join-Path $destination $imageName
  Assert-DreamSkinNoReparseComponents -Path $destinationImage
  Copy-Item -LiteralPath $active.ImagePath -Destination $destinationImage -Force
  Assert-DreamSkinNoReparseComponents -Path $destinationImage
  Assert-DreamSkinImageFile -Path $destinationImage
  $theme = $active.Theme | ConvertTo-Json -Depth 8 | ConvertFrom-Json
  $theme.id = $id
  $theme.name = $trimmed
  $theme.image = $imageName
  Copy-DreamSkinThemeAdvancedFiles -SourceThemeRoot $active.Directory -DestinationThemeRoot $destination -Theme $theme
  Write-DreamSkinTheme -ThemeDirectory $destination -Theme $theme
  return Read-DreamSkinTheme -ThemeDirectory $destination
}

function Get-DreamSkinSavedThemes {
  param(
    [string]$StateRoot,
    [switch]$SkipImageMetadata
  )
  if (-not $StateRoot) { $StateRoot = Get-DreamSkinDefaultStateRoot }
  $paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  Ensure-DreamSkinManagedDirectory -Path $paths.Root -Root $paths.Root
  Ensure-DreamSkinManagedDirectory -Path $paths.Saved -Root $paths.Root
  if (-not (Test-Path -LiteralPath $paths.Saved -PathType Container)) { return @() }
  $themes = @()
  foreach ($directory in Get-ChildItem -LiteralPath $paths.Saved -Directory -ErrorAction SilentlyContinue) {
    try {
      $loaded = Read-DreamSkinTheme -ThemeDirectory $directory.FullName -SkipImageMetadata:$SkipImageMetadata
      $themes += [pscustomobject]@{
        Id = "$($loaded.Theme.id)"
        Name = if ($loaded.Theme.name) { "$($loaded.Theme.name)" } else { $directory.Name }
        Path = $directory.FullName
      }
    } catch {}
  }
  return @($themes | Sort-Object Name)
}

function Use-DreamSkinSavedTheme {
  param(
    [Parameter(Mandatory = $true)][string]$ThemeDirectory,
    [string]$StateRoot
  )
  if (-not $StateRoot) { $StateRoot = Get-DreamSkinDefaultStateRoot }
  $paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  Ensure-DreamSkinManagedDirectory -Path $paths.Root -Root $paths.Root
  Ensure-DreamSkinManagedDirectory -Path $paths.Saved -Root $paths.Root
  $directory = [System.IO.Path]::GetFullPath($ThemeDirectory)
  if (-not (Test-DreamSkinThemePathWithin -Path $directory -Root $paths.Saved)) {
    throw 'Saved theme must remain inside the Skin Codex themes folder.'
  }
  $saved = Read-DreamSkinTheme -ThemeDirectory $directory
  $theme = $saved.Theme | ConvertTo-Json -Depth 8 | ConvertFrom-Json
  return Set-DreamSkinActiveTheme -ImagePath $saved.ImagePath -Theme $theme -StateRoot $StateRoot
}

function Remove-DreamSkinSavedTheme {
  param(
    [Parameter(Mandatory = $true)][string]$ThemeDirectory,
    [string]$StateRoot
  )
  if (-not $StateRoot) { $StateRoot = Get-DreamSkinDefaultStateRoot }
  $paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  Ensure-DreamSkinManagedDirectory -Path $paths.Root -Root $paths.Root
  Ensure-DreamSkinManagedDirectory -Path $paths.Saved -Root $paths.Root
  $directory = [System.IO.Path]::GetFullPath($ThemeDirectory)
  $savedRoot = [System.IO.Path]::GetFullPath($paths.Saved).TrimEnd('\')
  if ($directory.TrimEnd('\').Equals($savedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-DreamSkinThemePathWithin -Path $directory -Root $paths.Saved)) {
    throw 'Saved theme must remain inside the Skin Codex themes folder.'
  }
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
    throw "Saved theme does not exist: $directory"
  }
  $saved = Read-DreamSkinTheme -ThemeDirectory $directory -SkipImageMetadata
  $savedId = if ($saved.Theme.id) { "$($saved.Theme.id)" } else { '' }
  try {
    $active = Read-DreamSkinTheme -ThemeDirectory $paths.Active -SkipImageMetadata
    $activeId = if ($active.Theme.id) { "$($active.Theme.id)" } else { '' }
    if ($savedId -and $activeId -and $savedId -ceq $activeId) {
      throw '当前正在使用的主题不能删除，请先切换到其他主题。'
    }
  } catch {
    if ($_.Exception.Message -match '正在使用') { throw }
  }
  $deleted = [pscustomobject]@{
    Id = $savedId
    Name = if ($saved.Theme.name) { "$($saved.Theme.name)" } else { [System.IO.Path]::GetFileName($directory) }
    Path = $directory
  }
  Assert-DreamSkinNoReparseDescendants -Path $directory
  Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction Stop
  return $deleted
}

function Set-DreamSkinPaused {
  param(
    [Parameter(Mandatory = $true)][bool]$Paused,
    [string]$StateRoot
  )
  if (-not $StateRoot) { $StateRoot = Get-DreamSkinDefaultStateRoot }
  $paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  Ensure-DreamSkinManagedDirectory -Path $paths.Root -Root $paths.Root
  if ($Paused) {
    Assert-DreamSkinNoReparseComponents -Path $paths.PauseFile
    Write-DreamSkinUtf8FileAtomically -Path $paths.PauseFile -Content "paused`r`n"
  } else {
    if (Test-Path -LiteralPath $paths.PauseFile) { Assert-DreamSkinNoReparseComponents -Path $paths.PauseFile }
    Remove-Item -LiteralPath $paths.PauseFile -Force -ErrorAction SilentlyContinue
  }
  return $Paused
}

function Test-DreamSkinPaused {
  param([string]$StateRoot)
  if (-not $StateRoot) { $StateRoot = Get-DreamSkinDefaultStateRoot }
  return (Test-Path -LiteralPath (Get-DreamSkinThemePaths -StateRoot $StateRoot).PauseFile -PathType Leaf)
}
