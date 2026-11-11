#Requires -Version 5.1
# Install Dropline: write the user config and copy the panel into the After Effects
# user ScriptUI Panels folder (no administrator rights needed).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$panelSource = Join-Path $root 'host\panels\Dropline.jsx'

function Find-AfterEffectsUserPanelFolders {
    # After Effects scans %APPDATA%\Adobe\After Effects\<version>\Scripts\ScriptUI Panels
    # for every version it has run, and this location is always writable by the user.
    $found = New-Object System.Collections.ArrayList
    $prefsRoot = Join-Path $env:APPDATA 'Adobe\After Effects'
    if (Test-Path $prefsRoot) {
        foreach ($ver in (Get-ChildItem $prefsRoot -Directory -ErrorAction SilentlyContinue)) {
            if ($ver.Name -notmatch '^\d+(\.\d+)?$') { continue }
            $panels = Join-Path $ver.FullName 'Scripts\ScriptUI Panels'
            if (-not (Test-Path $panels)) {
                New-Item -ItemType Directory -Force -Path $panels | Out-Null
            }
            [void]$found.Add($panels)
        }
    }
    return ($found | Select-Object -Unique)
}

function Find-LegacyProgramFilesPanels {
    # Older releases installed into Program Files (admin required). A copy left there
    # would make Window > Dropline appear twice, so it is removed when possible.
    $found = New-Object System.Collections.ArrayList
    $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
    foreach ($rootDir in $roots) {
        $adobe = Join-Path $rootDir 'Adobe'
        if (-not (Test-Path $adobe)) { continue }
        foreach ($ae in (Get-ChildItem $adobe -Directory -Filter 'Adobe After Effects *' -ErrorAction SilentlyContinue)) {
            $panels = Join-Path $ae.FullName 'Support Files\Scripts\ScriptUI Panels'
            if ((Test-Path $panels) -and (Test-Path (Join-Path $panels 'Dropline.jsx'))) {
                [void]$found.Add($panels)
            }
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

# 2) Copy the panel into the user-level ScriptUI Panels folder of every AE version
$targets = @(Find-AfterEffectsUserPanelFolders)
if ($targets.Count -eq 0) {
    Write-Host "No After Effects preferences folder found." -ForegroundColor Yellow
    Write-Host "Run After Effects once, then run this installer again." -ForegroundColor Yellow
} else {
    foreach ($target in $targets) {
        Copy-Item $panelSource $target -Force
        Write-Host "Panel installed into: $target" -ForegroundColor Green
    }
}

# 3) Remove legacy Program Files copies (avoids two Dropline entries in the Window menu)
foreach ($legacy in @(Find-LegacyProgramFilesPanels)) {
    try {
        Remove-Item (Join-Path $legacy 'Dropline.jsx') -Force -ErrorAction Stop
        Write-Host "Removed legacy copy from: $legacy" -ForegroundColor Green
    } catch {
        Write-Host "An older copy is still in Program Files and cannot be removed without admin rights:" -ForegroundColor Yellow
        Write-Host "  $(Join-Path $legacy 'Dropline.jsx')" -ForegroundColor Yellow
        Write-Host "  Delete it once (right-click install.bat > Run as administrator) or After Effects will list Dropline twice." -ForegroundColor Yellow
    }
}

# 4) Reminder about binaries
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
