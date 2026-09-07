# Rescans content/board/*/ and rewrites content/board/photos.json, mapping
# each post's slug (folder name) to its photo filenames. Run this any time
# photos are added/removed for a post.
#
# Post text (title/body/date) comes from the Google Form response sheet at
# runtime — this script only handles photos. The folder name must exactly
# match that post's "슬러그" value in the response sheet.

$boardDir = Join-Path $PSScriptRoot "..\content\board"
if (-not (Test-Path $boardDir)) {
  New-Item -ItemType Directory -Path $boardDir -Force | Out-Null
}

$map = [ordered]@{}
Get-ChildItem $boardDir -Directory | Sort-Object Name | ForEach-Object {
  $slug = $_.Name
  $photoFiles = Get-ChildItem $_.FullName -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png)$' }
  $photos = @($photoFiles | Sort-Object {
    $n = 0
    $base = [IO.Path]::GetFileNameWithoutExtension($_.Name)
    if ([int]::TryParse($base, [ref]$n)) { $n } else { [int]::MaxValue }
  }, Name | Select-Object -ExpandProperty Name)
  if ($photos.Count -gt 0) { $map[$slug] = $photos }
}

$json = ConvertTo-Json -InputObject $map -Depth 5
if ($map.Count -eq 0) { $json = "{}" }

$manifestPath = Join-Path $boardDir "photos.json"
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding $false))

Write-Output "Wrote photos.json for $($map.Count) post(s):"
$map.Keys | ForEach-Object { Write-Output "  - $_ ($($map[$_].Count) photo(s))" }
