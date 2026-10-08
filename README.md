# Dropline

**Drop videos straight into your After Effects timeline.**

Dropline is a free, open-source panel for Adobe After Effects that downloads online videos (YouTube, Vimeo, and 1000+ sites via yt-dlp) and imports them into your active composition at the playhead - in one click.

## Features
- **One-click download + auto-import**: paste a URL, click once, the clip lands in your active comp at the playhead
- **Segment trim (IN/OUT)**: download only the portion you need via stream copy (fast, no re-encoding)
- **Live progress**: see 01 FETCH / 02 ENCODE / 03 TIMELINE steps update in real-time
- **Built-in yt-dlp updater**: platforms change defenses frequently, click "update engine" to stay fresh
- **Flight recorder logging**: debug issues via `~/.dropline/dropline.log`
- **Zombie process cleanup**: prevents hangs from crashed sessions
- **Robust polling with retry**: handles race conditions gracefully

## In progress
- **Audio-only mode**: extract soundtrack as .m4a (checkbox already in UI, implementation pending)

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
1. Download the latest `Dropline-v1.0.zip` from the Releases page
2. Unzip it anywhere
3. Double-click `install.bat`
4. Restart After Effects → Window → Dropline

## Install (from source)
1. Clone this repo
2. `powershell -ExecutionPolicy Bypass scripts\fetch-deps.ps1` (downloads yt-dlp + ffmpeg into bin/)
3. Build the core: `cd core; cargo build --release`, then copy `target\release\dropline.exe` to `bin\dropline-core.exe`
4. `powershell -ExecutionPolicy Bypass scripts\install.ps1`
5. Restart After Effects → Window → Dropline

## Requirements
- Windows 10/11
- Adobe After Effects 2024+ (developed on 2026)
- Rust toolchain only if you build the core from source

## Known issues
- **Trim accuracy**: segment trim cuts at the nearest keyframe (±1-2 seconds), not frame-exact. This is a trade-off for speed and AE compatibility.
- **yt-dlp updates**: platforms change their defenses frequently. Use the "update engine" button in the panel to keep yt-dlp fresh.

## Roadmap
- Audio-only mode (extract .m4a)
- Non-blocking progress (BridgeTalk async)
- Format/quality picker and thumbnail preview
- Single-exe installer (Inno Setup)
- UXP migration when After Effects opens the platform to unsigned dev plugins

## Legal note
Dropline is a download helper. Only download content you have the rights to use (your own material, Creative Commons, or licensed stock). Respect the terms of service of every platform.

## License
MIT - see LICENSE. Third-party binaries (yt-dlp, ffmpeg) keep their own licenses.
