# Rescans assets/hero/ and rewrites manifest.json with whatever image files
# are currently in the folder. Run this any time photos are added/removed —
# the site itself never needs a filename edited in its code.
$heroDir = Join-Path $PSScriptRoot "..\assets\hero"

$files = Get-ChildItem $heroDir -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|webp)$' }
$sorted = $files | Sort-Object {
  $n = 0
  $base = [IO.Path]::GetFileNameWithoutExtension($_.Name)
  if ([int]::TryParse($base, [ref]$n)) { $n } else { [int]::MaxValue }
}, Name

$names = $sorted | Select-Object -ExpandProperty Name
$json = "[" + (($names | ForEach-Object { '"' + $_ + '"' }) -join ",") + "]"

$manifestPath = Join-Path $heroDir "manifest.json"
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding $false))

Write-Output "Wrote $($names.Count) file(s) to manifest.json:"
$names | ForEach-Object { Write-Output "  - $_" }
