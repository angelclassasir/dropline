#Requires -Version 5.1
# Install Dropline: write the user config and copy the panel into every After Effects found.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

function Find-AfterEffectsPanelsFolders {
    $found = New-Object System.Collections.ArrayList

    # 1) Registry: Adobe records the install path per version
    $regRoots = @(
        'HKLM:\SOFTWARE\Adobe\After Effects',
        'HKLM:\SOFTWARE\WOW6432Node\Adobe\After Effects'
    )
    foreach ($regRoot in $regRoots) {
        if (-not (Test-Path $regRoot)) { continue }
        foreach ($key in (Get-ChildItem $regRoot -ErrorAction SilentlyContinue)) {
            $props = Get-ItemProperty -Path $key.PSPath -ErrorAction SilentlyContinue
            if (-not $props) { continue }
            foreach ($candidate in @($props.InstallPath, $props.SupportFilesPath)) {
                if (-not $candidate) { continue }
                $base = $candidate
                if (-not (Test-Path (Join-Path $base 'Scripts\ScriptUI Panels'))) {
                    $base = Join-Path $base 'Support Files'
                }
                $panels = Join-Path $base 'Scripts\ScriptUI Panels'
                if (Test-Path $panels) { [void]$found.Add($panels) }
            }
        }
    }

    # 2) Filesystem fallback, for custom install locations
    $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
    foreach ($rootDir in $roots) {
        $adobe = Join-Path $rootDir 'Adobe'
        if (-not (Test-Path $adobe)) { continue }
        foreach ($ae in (Get-ChildItem $adobe -Directory -Filter 'Adobe After Effects *' -ErrorAction SilentlyContinue)) {
            $panels = Join-Path $ae.FullName 'Support Files\Scripts\ScriptUI Panels'
            if (Test-Path $panels) { [void]$found.Add($panels) }
        }
    }

    return ($found | Select-Object -Unique)
}

# 1) Config so the panel finds the core on ANY machine
$cfgDir = Join-Path $env:USERPROFILE '.dropline'
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
$cfgPath = Join-Path $cfgDir 'config.json'
$cfg = [ordered]@{
    coreExe = Join-Path $root 'bin\dropline-core.exe'
    ytdlp   = Join-Path $root 'bin\yt-dlp.exe'
    ffmpeg  = Join-Path $root 'bin\ffmpeg.exe'
    bridge  = Join-Path $env:USERPROFILE 'DroplineDownloads'
} | ConvertTo-Json
# UTF-8 without BOM: non-ASCII user names would break an ANSI config file
[System.IO.File]::WriteAllText($cfgPath, $cfg, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Config written: $cfgPath" -ForegroundColor Green

# 2) Copy the panel into every After Effects install found
$targets = @(Find-AfterEffectsPanelsFolders)
$copied = 0
if ($targets.Count -gt 0) {
    foreach ($target in $targets) {
        try {
            Copy-Item (Join-Path $root 'host\panels\Dropline.jsx') $target -Force -ErrorAction Stop
            Write-Host "Panel installed into: $target" -ForegroundColor Green
            $copied++
        } catch {
            Write-Host "Could not write to $target" -ForegroundColor Yellow
            Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkYellow
            Write-Host "  Right-click install.bat > Run as administrator, or copy host\panels\Dropline.jsx there by hand." -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "After Effects was not found automatically." -ForegroundColor Yellow
    Write-Host "Copy host\panels\Dropline.jsx into '...\Support Files\Scripts\ScriptUI Panels' by hand." -ForegroundColor Yellow
}

# 3) Reminder about binaries
$missing = @()
foreach ($bin in @('dropline-core.exe', 'yt-dlp.exe', 'ffmpeg.exe')) {
    if (-not (Test-Path (Join-Path $root "bin\$bin"))) { $missing += $bin }
}
if ($missing.Count -gt 0) {
    Write-Host ("Missing binaries in bin\: " + ($missing -join ', ')) -ForegroundColor Yellow
    Write-Host "Build the core:  cd core; cargo build --release; copy target\release\dropline-core.exe ..\bin\dropline-core.exe" -ForegroundColor Yellow
    Write-Host "Fetch the tools: powershell -ExecutionPolicy Bypass scripts\fetch-deps.ps1" -ForegroundColor Yellow
}

Write-Host "Done. Restart After Effects and open Window > Dropline." -ForegroundColor Green
