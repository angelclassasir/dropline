# Dropline

**Drop videos straight into your After Effects timeline.**

Dropline is a free, open-source panel for Adobe After Effects that downloads online videos (YouTube, Vimeo, and 1000+ sites via yt-dlp) and imports them into your active composition at the playhead - in one click.

## Features
- **One-click download + auto-import**: paste a URL, click once, the clip lands in your active comp at the playhead
- **Segment trim (IN/OUT)**: download only the portion you need via stream copy (fast, no re-encoding)
- **Audio-only mode**: extract just the soundtrack as `.m4a` (AAC)
- **Live progress**: see 01 FETCH / 02 ENCODE / 03 TIMELINE steps update in real-time
- **Stays out of the way**: the core runs at below-normal priority, so you can keep editing and playing back while it downloads
- **Tuned for a timeline, not for a cinema**: 1080p H.264 by default (configurable), because 4K is four times the bytes for the same picture in a 1080p comp
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

The core itself is started through a two-line `.vbs` in `~/.dropline` run by `wscript.exe`. `WScript.Shell.Run(..., 0, False)` gives it a private hidden console, so no process inherits After Effects' stdout pipe: `system.callSystem` returns in about 250 ms instead of waiting for the whole download, and polling runs on `app.scheduleTask` instead of a blocking loop.

## Install (easy way, recommended)
1. Download the latest `Dropline-v1.1.0.zip` from the Releases page
2. Unzip it anywhere
3. Double-click `install.bat` (no administrator rights needed)
4. Restart After Effects → Window → Dropline

## Install (from source)
1. Clone this repo
2. `powershell -ExecutionPolicy Bypass scripts\fetch-deps.ps1` (downloads yt-dlp + ffmpeg into `bin/`)
3. Build the core: `cd core; cargo build --release`, then copy `target\release\dropline-core.exe` to `bin\dropline-core.exe`
4. `powershell -ExecutionPolicy Bypass scripts\install.ps1`
5. Restart After Effects → Window → Dropline

## Performance

Dropline is built to be background noise. Everything below is a deliberate default, not an accident:

| Setting | Default | Where to change it |
|---|---|---|
| Video quality | 1080p H.264 (`.mp4`) | `"maxHeight": 2160` (or `720`) in `~/.dropline/config.json` |
| Download connections | 4 parallel fragments | `--concurrent-fragments` in `core/src/main.rs` |
| Process priority | Below normal (yt-dlp and ffmpeg inherit it) | `run_below_normal_priority()` in `core/src/main.rs` |
| Trim encode | `libx264 -preset veryfast -crf 20`, AAC 192k | `--postprocessor-args` in `core/src/main.rs` |
| Panel polling | every 750 ms, only when `status.json` changed | `app.scheduleTask(...)` in `host/panels/Dropline.jsx` |

Why 1080p: the old default asked for the best stream, which on YouTube means 4K - four to six times the bytes, and the same result on a 1080p composition. A five-minute segment used to arrive as ~1 GB; it now arrives as ~200 MB, in a fraction of the time.

If a download feels slow, it is almost always the platform throttling the connection, not Dropline: check `~/.dropline/dropline.log`, which records the progress and the exact command used.

## Troubleshooting
- **"core did not start"** - the panel could not spawn the core. Check `~/.dropline/config.json` exists and that `coreExe` points at a real `bin\dropline-core.exe`.
- **"yt-dlp not found"** - run `scripts\fetch-deps.ps1`, or set `"ytdlp"` in `~/.dropline/config.json` to an existing path.
- **"download stalled"** - the platform stopped sending data for 3 minutes. Click "update engine" and retry.
- **"After Effects feels slow while it downloads"** - it should not block you at all: the download runs in a separate process at below-normal priority. A 60 s test job measured a worst main-thread gap of 627 ms (the import at the end) and ~200 ms everywhere else. If the whole machine feels sluggish, the bottleneck is bandwidth or disk; the trim re-encode is the only CPU-heavy step and it too runs below normal priority.
- **After Effects feels frozen right after clicking DROP IT** - that was a real bug up to 1.0.3: the launch left a process holding AE's stdout pipe, so `callSystem` waited for the whole download (and forever if that process outlived the session). 1.0.4 starts the core through `wscript.exe`, which gives it a private console. The log now shows `CALLSYSTEM RETURNED in Nms` with a small N (~250 ms); a large N means something reintroduced the bug.
- **The engine or yt-dlp fails** - the core writes the reason into `DroplineDownloads\status.json` (the panel shows the same text) and in `~/.dropline/dropline.log`.
- **Anything else** - open `~/.dropline/dropline.log`. Every phase is logged there, including the exact command the panel ran.

## Requirements
- Windows 10/11
- Adobe After Effects 2024+
- Rust toolchain only if you build the core from source

## Known issues
- **Trim accuracy**: segment trim cuts at the nearest keyframe (±1-2 seconds), not frame-exact. This is a trade-off for speed and AE compatibility.
- **Trim re-encodes**: cutting a segment cannot be a pure stream copy if you want clean edges, so trimmed clips are re-encoded (H.264 / AAC). Untrimmed downloads are copied as-is.
- **yt-dlp updates**: platforms change their defenses frequently. Use the "update engine" button in the panel to keep yt-dlp fresh.
- **Windows only**: the panel drives `wscript`/`taskkill`, so macOS and Linux are not supported.

## Roadmap
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
