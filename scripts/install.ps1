# Install Dropline: write user config and copy the panel into After Effects
$root = Split-Path $PSScriptRoot -Parent

# 1) Config so the panel finds the core on ANY machine
$cfgDir = Join-Path $env:USERPROFILE ".dropline"
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
$cfg = @{
    coreExe = Join-Path $root "bin\dropline-core.exe"
    bridge  = Join-Path $env:USERPROFILE "DroplineDownloads"
} | ConvertTo-Json
Set-Content -Path (Join-Path $cfgDir "config.json") -Value $cfg

# 2) Copy panel into the first After Effects install found
$panels = Get-ChildItem "C:\Program Files\Adobe\Adobe After Effects 20*" -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName "Support Files\Scripts\ScriptUI Panels" } |
    Where-Object { Test-Path $_ } | Select-Object -First 1

if ($panels) {
    Copy-Item (Join-Path $root "host\panels\Dropline.jsx") $panels -Force
    Write-Host "Panel installed into: $panels" -ForegroundColor Green
} else {
    Write-Host "After Effects not found in default path - copy host/panels/Dropline.jsx manually" -ForegroundColor Yellow
}

# 3) Reminder about binaries
if (-not (Test-Path (Join-Path $root "bin\dropline-core.exe"))) {
    Write-Host "Build the core first: cd core; cargo build --release; copy target\release\dropline.exe ..\bin\dropline-core.exe" -ForegroundColor Yellow
}
Write-Host "Done. Restart After Effects and open Window > Dropline." -ForegroundColor Green
