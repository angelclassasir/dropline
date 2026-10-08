# Fetch third-party binaries (yt-dlp + ffmpeg) into bin/
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path $PSScriptRoot -Parent
$bin  = Join-Path $root "bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null

Write-Host "Downloading yt-dlp..."
Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile "$bin\yt-dlp.exe"

Write-Host "Downloading ffmpeg (essentials build, ~90MB)..."
Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile "$bin\ffmpeg.zip"
Expand-Archive "$bin\ffmpeg.zip" -DestinationPath "$bin\ffmpeg-tmp" -Force
Copy-Item "$bin\ffmpeg-tmp\*\bin\ffmpeg.exe"  "$bin\ffmpeg.exe"  -Force
Copy-Item "$bin\ffmpeg-tmp\*\bin\ffprobe.exe" "$bin\ffprobe.exe" -Force
Remove-Item "$bin\ffmpeg.zip", "$bin\ffmpeg-tmp" -Recurse -Force

Write-Host "Dependencies ready in bin/" -ForegroundColor Green
