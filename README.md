# Dropline

**Drop videos straight into your After Effects timeline.**

Dropline is a free, open-source panel for Adobe After Effects that downloads online videos (YouTube, Vimeo, and 1000+ sites via yt-dlp) and imports them into your active composition at the playhead - in one click.

## Features
- **One-click download + auto-import**: paste a URL, click once, the clip lands in your active comp at the playhead
- **Segment trim (IN/OUT)**: download only the portion you need via stream copy (fast, no re-encoding)
- **Audio-only mode**: extract just the soundtrack as `.m4a` (AAC)
- **Live progress**: see 01 FETCH / 02 ENCODE / 03 TIMELINE steps update in real-time
- **Built-in yt-dlp updater**: platforms change defenses frequently, click "update engine" to stay fresh
- **Flight recorder logging**: debug issues via `~/.dropline/dropline.log` (auto-rotates at 512 KB)
- **One download, one file**: each job tags its own output, so parallel or leftovers can never be mixed up
- **Zombie process cleanup**: prevents hangs from crashed sessions
- **Robust polling with retry**: handles race conditions gracefully

## How it works
Dropline ships as an After Effects ScriptUI panel plus a tiny Rust core:

    [AE panel Dropline.jsx] --writes--> request.json      (url, trim, audio-only, job id)
                           --spawn----> [dropline-core.exe (Rust, headless)]
                                              |  yt-dlp + ffmpeg
                                              v
                                      status.json (progress bridge)
                                              |
    [AE panel reads bridge] <-----------------+
    [auto-import at playhead]

The URL never sits on the command line: it travels inside `request.json`, so there is nothing to escape or inject. The panel never blocks on the network either - the core publishes progress to the bridge file and the panel imports the result when the download finishes.

## Install (easy way, recommended)
1. Download the latest `Dropline-v1.0.3.zip` from the Releases page
2. Unzip it anywhere
3. Double-click `install.bat`
4. Restart After Effects → Window → Dropline

## Install (from source)
1. Clone this repo
2. `powershell -ExecutionPolicy Bypass scripts\fetch-deps.ps1` (downloads yt-dlp + ffmpeg into `bin/`)
3. Build the core: `cd core; cargo build --release`, then copy `target\release\dropline-core.exe` to `bin\dropline-core.exe`
4. `powershell -ExecutionPolicy Bypass scripts\install.ps1`
5. Restart After Effects → Window → Dropline

## Troubleshooting
- **"core did not start"** - the panel could not spawn the core. Check `~/.dropline/config.json` exists and that `coreExe` points at a real `bin\dropline-core.exe`.
- **"yt-dlp not found"** - run `scripts\fetch-deps.ps1`, or set `"ytdlp"` in `~/.dropline/config.json` to an existing path.
- **"download stalled"** - the platform stopped sending data for 3 minutes. Click "update engine" and retry.
- **After Effects feels frozen right after clicking DROP IT** - that was a real bug up to 1.0.2 (the launch held AE's stdout pipe, so `callSystem` waited for the whole download). It is fixed in 1.0.3: the log now shows `CALLSYSTEM RETURNED in Nms` with a small N. If you ever see a large N there, something has reintroduced it.
- **The engine or yt-dlp fails** - `DroplineDownloads\core.log` and `core.err.log` hold the core's own output.
- **Anything else** - open `~/.dropline/dropline.log`. Every phase is logged there, including the exact command the panel ran.

## Requirements
- Windows 10/11
- Adobe After Effects 2024+
- Rust toolchain only if you build the core from source

## Known issues
- **Trim accuracy**: segment trim cuts at the nearest keyframe (±1-2 seconds), not frame-exact. This is a trade-off for speed and AE compatibility.
- **Trim re-encodes**: cutting a segment cannot be a pure stream copy if you want clean edges, so trimmed clips are re-encoded (H.264 / AAC). Untrimmed downloads are copied as-is.
- **yt-dlp updates**: platforms change their defenses frequently. Use the "update engine" button in the panel to keep yt-dlp fresh.
- **Windows only**: the panel drives `cmd`/`taskkill`, so macOS and Linux are not supported.

## Roadmap
- Non-blocking progress (BridgeTalk async)
- Format/quality picker and thumbnail preview
- Download history and cache cleanup
- Single-exe installer (Inno Setup)
- UXP migration when After Effects opens the platform to unsigned dev plugins

## Legal note
Dropline is a download helper. Only download content you have the rights to use (your own material, Creative Commons, or licensed stock). Respect the terms of service of every platform.

## License
MIT - see LICENSE. Third-party binaries (yt-dlp, ffmpeg) keep their own licenses.

## Changelog
See [CHANGELOG.md](CHANGELOG.md).
