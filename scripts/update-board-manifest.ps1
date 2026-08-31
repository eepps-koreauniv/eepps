# Rescans content/board/ and rewrites content/board/manifest.json.
# Run this any time a post folder is added, edited, or removed — the site
# itself never needs a slug, filename, or date hardcoded anywhere.
#
# Expected layout per post: content/board/{YYYY-MM-DD-event-title}/
#   The YYYY-MM-DD prefix is only used as the post's date - it never shows
#   up on the site as part of the title.
#   ko.txt / en.txt  - first line is the DISPLAYED title, blank line, then
#   the body (independent of the folder name).
#   any image files (jpg/jpeg/png) - names don't need to be numbers; they're
#   listed in the manifest as-is and shown in (numbers-first, then
#   alphabetical) order, with the first one used as the list thumbnail.

$boardDir = Join-Path $PSScriptRoot "..\content\board"
if (-not (Test-Path $boardDir)) {
  New-Item -ItemType Directory -Path $boardDir -Force | Out-Null
}

function Get-FirstLineTitle($path) {
  if (-not (Test-Path $path)) { return "" }
  # Get-Content -Encoding UTF8 misdecodes BOM-less UTF-8 in Windows
  # PowerShell 5.1 (falls back to the system codepage), so read+decode
  # explicitly instead.
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  $firstLine = ($text -split "`r?`n", 2)[0]
  return $firstLine.Trim()
}

$posts = @()
Get-ChildItem $boardDir -Directory | Sort-Object Name | ForEach-Object {
  $slug = $_.Name
  $folder = $_.FullName

  if ($slug -notmatch '^(\d{4}-\d{2}-\d{2})') {
    Write-Warning "Skipping '$slug' - folder name must start with YYYY-MM-DD"
    return
  }
  $date = $Matches[1]

  $titleKo = Get-FirstLineTitle (Join-Path $folder "ko.txt")
  $titleEn = Get-FirstLineTitle (Join-Path $folder "en.txt")

  $photoFiles = Get-ChildItem $folder -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png)$' }
  $photos = @($photoFiles | Sort-Object {
    $n = 0
    $base = [IO.Path]::GetFileNameWithoutExtension($_.Name)
    if ([int]::TryParse($base, [ref]$n)) { $n } else { [int]::MaxValue }
  }, Name | Select-Object -ExpandProperty Name)

  if (-not $titleKo -and -not $titleEn) {
    Write-Warning "Skipping '$slug' - no ko.txt or en.txt with a title found"
    return
  }

  $posts += [ordered]@{
    slug = $slug
    date = $date
    titleKo = $titleKo
    titleEn = $titleEn
    photos = $photos
  }
}

$sorted = @($posts | Sort-Object { $_.date } -Descending)
# The @(...) forces a real array even with 0 or 1 posts, so ConvertTo-Json
# always emits "[...]" instead of unwrapping to a bare object.
$json = ConvertTo-Json -InputObject $sorted -Depth 5

$manifestPath = Join-Path $boardDir "manifest.json"
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding $false))

Write-Output "Wrote $($sorted.Count) post(s) to manifest.json:"
$sorted | ForEach-Object { Write-Output "  - $($_.slug) ($($_.photos.Count) photo(s))" }
