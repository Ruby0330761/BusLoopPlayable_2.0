$ErrorActionPreference = 'Stop'
$backupRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $backupRoot '..\..\..')).Path
$manifest = Get-Content (Join-Path $backupRoot 'manifest.json') -Raw | ConvertFrom-Json

foreach ($item in $manifest.files) {
  $source = Join-Path $backupRoot ($item.path -replace '/', '\')
  $target = Join-Path $repoRoot ($item.path -replace '/', '\')
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing backup file: $source" }
  New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
}

Write-Host "Restored $($manifest.files.Count) FBX/VAT resources from $backupRoot"
