# Fetch third-party binaries (yt-dlp + ffmpeg) into bin/
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Windows PowerShell 5.1 still defaults to old TLS, which GitHub rejects
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path $PSScriptRoot -Parent
$bin  = Join-Path $root 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null

Write-Host "Downloading yt-dlp..."
Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile "$bin\yt-dlp.exe"

Write-Host "Downloading ffmpeg (essentials build, ~90 MB)..."
Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile "$bin\ffmpeg.zip"
Expand-Archive "$bin\ffmpeg.zip" -DestinationPath "$bin\ffmpeg-tmp" -Force
Copy-Item "$bin\ffmpeg-tmp\*\bin\ffmpeg.exe"  "$bin\ffmpeg.exe"  -Force
Copy-Item "$bin\ffmpeg-tmp\*\bin\ffprobe.exe" "$bin\ffprobe.exe" -Force
Remove-Item "$bin\ffmpeg.zip", "$bin\ffmpeg-tmp" -Recurse -Force

$missing = @()
foreach ($file in @('yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe')) {
    if (-not (Test-Path (Join-Path $bin $file))) { $missing += $file }
}
if ($missing.Count -gt 0) {
    throw ("These binaries are still missing: " + ($missing -join ', '))
}

Write-Host "Dependencies ready in bin/" -ForegroundColor Green
