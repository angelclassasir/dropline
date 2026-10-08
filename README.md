# Dropline

**Drop videos straight into your After Effects timeline.**

Dropline is a free, open-source panel for Adobe After Effects that downloads
online videos (YouTube, Vimeo, and 1000+ sites via yt-dlp) and imports them
into your active composition at the playhead - in one click.

## Features
- Paste a URL, click once, the clip lands in your active comp at the playhead
- Live progress inside the panel (01 FETCH / 02 ENCODE / 03 TIMELINE)
- Built-in yt-dlp updater (platforms change, Dropline keeps up)
- Tiny headless Rust core: the panel never talks to the network itself

## In progress (next releases)
- Segment trim: download only between IN and OUT points (optional).
- Audio-only mode: extract the soundtrack as .m4a

## How it works
Dropline ships as an After Effects ScriptUI panel plus a tiny Rust core:

    [AE panel Dropline.jsx] --spawn--> [dropline-core.exe (Rust, headless)]
                                            |  yt-dlp + ffmpeg
                                            v
                                    status.json (progress bridge)
                                            |
    [AE panel reads bridge] <---------------+
    [auto-import at playhead]

The panel never blocks on network calls: the Rust core publishes progress to a
bridge file and the panel imports the result when the download finishes.

## Install (easy way, recommended)
1. Download the latest `Dropline-vX.zip` from the Releases page.
2. Unzip it anywhere.
3. Double-click `install.bat`.
4. Restart After Effects -> Window > Dropline.

## Install (from source)
1. Clone this repo.
2. `powershell -ExecutionPolicy Bypass scripts\fetch-deps.ps1`
   (downloads yt-dlp + ffmpeg into bin/)
3. Build the core: `cd core; cargo build --release`, then copy
   `target\release\dropline.exe` to `bin\dropline-core.exe`
4. `powershell -ExecutionPolicy Bypass scripts\install.ps1`
5. Restart After Effects -> Window > Dropline

## Requirements
- Windows 10/11
- Adobe After Effects 2024+ (developed on 2026)
- Rust toolchain only if you build the core from source

## Legal note
Dropline is a download helper. Only download content you have the rights to
use (your own material, Creative Commons, or licensed stock). Respect the
terms of service of every platform.

## Roadmap
- Single-exe installer (Inno Setup)
- UXP migration when After Effects opens the platform to unsigned dev plugins
- Non-blocking progress (BridgeTalk async)
- Format/quality picker and thumbnail preview

## License
MIT - see LICENSE. Third-party binaries (yt-dlp, ffmpeg) keep their own licenses.
