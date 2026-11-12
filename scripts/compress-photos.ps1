# Shrinks photos in a folder (recursively) to web size, in place.
# - Longest side capped at -MaxSize px, JPEGs re-saved at -Quality.
# - Phone rotation (EXIF orientation) is applied so photos don't turn sideways.
# - Metadata (GPS etc.) is dropped.
# - A file is only replaced when the result is actually smaller, and files
#   already web-sized are skipped, so running it again doesn't re-compress.
# File names and formats stay the same, so photos.json / manifest.json
# don't change. Called automatically by update-board-photos.ps1 and
# update-hero-manifest.ps1.
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$MaxSize = 1600,
  [int]$Quality = 82,
  [int]$SkipOverKB = 1500
)

Add-Type -AssemblyName System.Drawing

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$Quality)

$rotations = @{
  2 = 'RotateNoneFlipX'; 3 = 'Rotate180FlipNone'; 4 = 'Rotate180FlipX'
  5 = 'Rotate90FlipX'; 6 = 'Rotate90FlipNone'; 7 = 'Rotate270FlipX'; 8 = 'Rotate270FlipNone'
}

$before = 0; $after = 0; $changed = 0
Get-ChildItem $Path -Recurse -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png)$' } | ForEach-Object {
  $file = $_
  $before += $file.Length
  $img = $null; $out = $null
  try {
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    $ms = New-Object IO.MemoryStream (, $bytes)
    $img = [System.Drawing.Image]::FromStream($ms)

    $orient = 1
    if ($img.PropertyIdList -contains 0x0112) { $orient = [int]$img.GetPropertyItem(0x0112).Value[0] }
    $tooBig = [Math]::Max($img.Width, $img.Height) -gt $MaxSize
    # Already web-sized photos are left alone (re-saving a JPEG loses a bit
    # of quality every time), unless they are unusually heavy for their size.
    if (-not $tooBig -and $orient -eq 1 -and $file.Length -lt $SkipOverKB * 1KB) { $after += $file.Length; return }

    if ($rotations.ContainsKey($orient)) { $img.RotateFlip([System.Drawing.RotateFlipType]$rotations[$orient]) }

    $scale = [Math]::Min(1.0, $MaxSize / [double][Math]::Max($img.Width, $img.Height))
    $w = [int][Math]::Round($img.Width * $scale); $h = [int][Math]::Round($img.Height * $scale)
    $isPng = $file.Extension -ieq '.png'
    $pf = if ($isPng) { [System.Drawing.Imaging.PixelFormat]::Format32bppArgb } else { [System.Drawing.Imaging.PixelFormat]::Format24bppRgb }
    $out = New-Object System.Drawing.Bitmap $w, $h, $pf
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'
    $g.DrawImage($img, 0, 0, $w, $h)
    $g.Dispose()

    $res = New-Object IO.MemoryStream
    if ($isPng) { $out.Save($res, [System.Drawing.Imaging.ImageFormat]::Png) } else { $out.Save($res, $jpegCodec, $encParams) }

    if ($res.Length -lt $file.Length -or $orient -ne 1) {
      [IO.File]::WriteAllBytes($file.FullName, $res.ToArray())
      $after += $res.Length; $changed++
    } else {
      $after += $file.Length
    }
  } catch {
    Write-Warning "Skipped $($file.FullName): $_"
    $after += $file.Length
  } finally {
    if ($out) { $out.Dispose() }
    if ($img) { $img.Dispose() }
  }
}

Write-Output ("Compressed {0} photo(s) in {1}: {2:N0} MB -> {3:N0} MB" -f $changed, $Path, ($before / 1MB), ($after / 1MB))
