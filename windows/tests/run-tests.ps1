[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$WindowsRoot = Split-Path -Parent $PSScriptRoot
$Node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $Node) { $Node = Get-Command node -ErrorAction SilentlyContinue }
if (-not $Node) { throw 'Node.js 22 or newer is required on PATH to run the Windows development tests.' }

$nodeVersion = @(& $Node.Source --version)
if ($LASTEXITCODE -ne 0 -or -not $nodeVersion -or [int](($nodeVersion -replace '^v', '').Split('.')[0]) -lt 22) {
  throw 'Node.js 22 or newer is required on PATH to run the Windows development tests.'
}

$psScripts = Get-ChildItem -LiteralPath (Join-Path $WindowsRoot 'scripts') -Filter '*.ps1' -File
foreach ($script in $psScripts) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$errors) | Out-Null
  if (@($errors).Count -gt 0) {
    throw "PowerShell parse failure in $($script.Name): $(@($errors | ForEach-Object Message) -join '; ')"
  }
}

$injector = Join-Path $WindowsRoot 'scripts\injector.mjs'
& $Node.Source --check $injector
if ($LASTEXITCODE -ne 0) { throw 'Injector syntax check failed.' }

$sample = Join-Path $WindowsRoot 'samples\theme-packs\sample-b-plus-minimal'
& $Node.Source $injector --check-payload --theme-dir $sample
if ($LASTEXITCODE -ne 0) { throw 'Minimal B+ sample payload check failed.' }

foreach ($test in @(
    'image-metadata.test.mjs',
    'injector-bootstrap.test.mjs',
    'injector-one-shot.test.mjs',
    'renderer-inject.test.mjs',
    'open-source-development-contract.test.mjs'
  )) {
  & $Node.Source (Join-Path $PSScriptRoot $test)
  if ($LASTEXITCODE -ne 0) { throw "Windows development test failed: $test" }
}

Write-Host 'PASS: Windows development engine, declarative theme contracts, and public-source audit.'
