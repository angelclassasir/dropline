# Build the Dropline release ZIP (panel + core + yt-dlp + ffmpeg + installer)
$ErrorActionPreference = 'Stop'
$root  = Split-Path $PSScriptRoot -Parent
$stage = Join-Path $env:TEMP 'Dropline-release'

# --- Preflight: fail loudly instead of shipping a half-empty ZIP ---
$required = @(
    'bin\dropline-core.exe',
    'bin\yt-dlp.exe',
    'bin\ffmpeg.exe',
    'bin\ffprobe.exe',
    'host\panels\Dropline.jsx',
    'scripts\install.ps1',
    'install.bat',
    'LICENSE',
    'README.md'
)
foreach ($file in $required) {
    if (-not (Test-Path (Join-Path $root $file))) {
        throw "Missing $file - build the core (cargo build --release) and run scripts\fetch-deps.ps1 first."
    }
}

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$stage\Dropline\bin"         | Out-Null
New-Item -ItemType Directory -Force -Path "$stage\Dropline\host\panels" | Out-Null
New-Item -ItemType Directory -Force -Path "$stage\Dropline\scripts"     | Out-Null

Copy-Item "$root\bin\dropline-core.exe"       "$stage\Dropline\bin\" -Force
Copy-Item "$root\bin\yt-dlp.exe"              "$stage\Dropline\bin\" -Force
Copy-Item "$root\bin\ffmpeg.exe"              "$stage\Dropline\bin\" -Force
Copy-Item "$root\bin\ffprobe.exe"             "$stage\Dropline\bin\" -Force
Copy-Item "$root\host\panels\Dropline.jsx"    "$stage\Dropline\host\panels\" -Force
Copy-Item "$root\scripts\install.ps1"         "$stage\Dropline\scripts\" -Force
Copy-Item "$root\scripts\fetch-deps.ps1"      "$stage\Dropline\scripts\" -Force
Copy-Item "$root\install.bat"                 "$stage\Dropline\" -Force
Copy-Item "$root\LICENSE"                     "$stage\Dropline\" -Force
Copy-Item "$root\README.md"                   "$stage\Dropline\README.md" -Force
if (Test-Path "$root\CHANGELOG.md") { Copy-Item "$root\CHANGELOG.md" "$stage\Dropline\" -Force }

$quickStart = @(
    "DROPLINE - quick install",
    "",
    "1. Double-click install.bat",
    "2. Restart After Effects",
    "3. Window > Dropline",
    "",
    "Paste a video URL, hit DROP IT, and the clip lands on your timeline",
    "at the playhead.",
    "",
    "Problems? The log lives in %USERPROFILE%\.dropline\dropline.log",
    "Full docs: see README.md"
)
$quickStart | Out-File -FilePath "$stage\Dropline\README.txt" -Encoding ascii

# Read the version from Cargo.toml so the ZIP name can never drift from the core
$cargoToml = Get-Content (Join-Path $root 'core\Cargo.toml') -Raw
$versionMatch = [regex]::Match($cargoToml, 'version\s*=\s*"([^"]+)"')
$version = if ($versionMatch.Success) { $versionMatch.Groups[1].Value } else { '0.0.0' }

$zip = Join-Path $root "Dropline-v$version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
# .NET zip instead of Compress-Archive: the ~200 MB of ffmpeg binaries make the
# cmdlet crawl and chew memory
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    (Join-Path $stage 'Dropline'),
    $zip,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $true
)
Remove-Item $stage -Recurse -Force

$sizeMb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "Release ZIP ready: $zip ($sizeMb MB)" -ForegroundColor Green
