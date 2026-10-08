# Build Dropline release ZIP (panel + core + yt-dlp + ffmpeg + installer)
$root = Split-Path $PSScriptRoot -Parent
$stage = Join-Path $env:TEMP "Dropline-release"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$stage\Dropline\bin"         | Out-Null
New-Item -ItemType Directory -Force -Path "$stage\Dropline\host\panels" | Out-Null
New-Item -ItemType Directory -Force -Path "$stage\Dropline\scripts"     | Out-Null

Copy-Item "$root\bin\dropline-core.exe" "$stage\Dropline\bin\" -Force
Copy-Item "$root\bin\yt-dlp.exe"        "$stage\Dropline\bin\" -Force
if (Test-Path "$root\bin\ffmpeg.exe") { Copy-Item "$root\bin\ffmpeg.exe" "$stage\Dropline\bin\" -Force }
Copy-Item "$root\host\panels\Dropline.jsx" "$stage\Dropline\host\panels\" -Force
Copy-Item "$root\scripts\install.ps1" "$stage\Dropline\scripts\" -Force
Copy-Item "$root\install.bat"         "$stage\Dropline\" -Force

$readme = @(
    "DROPLINE - quick install",
    "1. Double-click install.bat",
    "2. Restart After Effects",
    "3. Window > Dropline",
    "That is it. Videos straight to your timeline."
)
$readme | Out-File -FilePath "$stage\Dropline\README.txt" -Encoding ascii

$zip = Join-Path $root "Dropline-v0.9.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$stage\Dropline" -DestinationPath $zip
Write-Host "Release ZIP ready: $zip" -ForegroundColor Green