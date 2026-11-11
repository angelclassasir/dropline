# Changelog

All notable changes to Dropline. Versions match `core/Cargo.toml`; the release ZIP is named from it.

## 1.0.4

### Fixed
- **The panel now really starts the core from inside After Effects.** 1.0.3 replaced `cmd /c start` with a PowerShell `Start-Process` one-liner, which was measured from Node and looked right - but under AE's `system.callSystem` it returned in 208 ms having started nothing, because the nested quotes do not survive the trip. The launch now writes a two-line `.vbs` and runs it with `wscript.exe`; `WScript.Shell.Run(..., 0, False)` gives the core its own hidden console, so no process holds AE's stdout pipe and there is nothing left to quote. Measured inside AE: `CALLSYSTEM RETURNED in 252-298 ms` while the download continued detached.
- **"update engine" no longer reports a false error.** The updater finishes with `done` and no file, which the download watcher read as "finished but reported no file". The watcher now knows when it is watching an update.
- The launcher lives in `~/.dropline` instead of the downloads folder, so Dropline no longer leaves a `.vbs` among the videos.

### Verified
- End to end, inside After Effects, with the installed panel: plain YouTube download; trimmed segment (00:02:34-00:02:40 lands as a 6 s layer); audio-only (`.m4a`, audio and no video); engine update; and a second run while the first download was in flight. Live progress ticks every second throughout, and AE stays responsive - `DROP IT` was fired through the button's own `onClick` handler for the last check.

### Changed
- The panel installs into `%APPDATA%\Adobe\After Effects\<version>\Scripts\ScriptUI Panels`, which needs no administrator rights. `install.ps1` removes a legacy copy from `Program Files` when it can, and warns if it cannot (two copies would list Dropline twice in the Window menu).
- The panel exposes `$.global.__dropline` (`drop`, `click`, `update`, `state`) so the whole pipeline can be driven from a script; `click()` fires the button's real event handler.

## 1.0.3

### Fixed
- **After Effects no longer freezes during a download.** `system.callSystem` waits for the process it starts, because the child inherits AE's stdout pipe; the old `cmd /c start` launch therefore blocked the app for the entire download - and forever when the child outlived the session, which is what made AE look like it had crashed. The core is now launched with PowerShell's `Start-Process`, which gives the child fresh handles: `callSystem` returns in ~2.5s and the download continues detached. Measured: 3100ms blocking on a 3s payload before, 28ms-2.5s after, with the payload confirmed to run.
- **Live progress now actually works.** Polling used to run in a `while (true) { $.sleep(500); w.update(); }` loop, which owns AE's only thread: the app was frozen for the whole download and the "01 FETCH / 02 ENCODE / 03 TIMELINE" steps never updated (the log had zero progress entries in either version). Polling now runs through `app.scheduleTask()`, so AE stays responsive and the panel updates live.
- The separate "Dropline working" popup window is gone; progress shows in the panel itself, and it keeps working even if the panel is closed while the download finishes.
- `CALLSYSTEM RETURNED in Nms` and `WATCH STARTED/ENDED` are logged, so a future freeze is obvious in `~/.dropline/dropline.log`.

### Added
- The core's stdout/stderr are redirected to `DroplineDownloads\core.log` and `core.err.log` for troubleshooting.

## 1.0.1

### Fixed
- **Portable core**: removed the hardcoded `C:\Users\angel\...\bin\yt-dlp.exe` path. The core now resolves yt-dlp from `--yt-dlp`, then `~/.dropline/config.json`, then next to its own executable, then `..\bin\`, then `PATH`. The released binary works on any machine now.
- **Audio-only actually works**: the `AUDIO ONLY` checkbox used to be a silent no-op. It now extracts `.m4a` (`-x --audio-format m4a`), including a clean re-encode when trimming.
- **No more shell interpolation**: the URL travels inside `request.json` instead of being pasted into a `cmd` line, so `%`, `!`, quotes, `&` and friends can no longer be expanded or injected. Paths are quoted, so installs with spaces work.
- **No more `eval()`**: config and status JSON are parsed with a small built-in parser instead of `eval` on file contents.
- **Correct file picked up**: every job tags its own output file (`title__jobid.mp4`) and the core reports that exact file, instead of "newest .mp4 in the folder". A leftover status file from another job is ignored by the panel.
- **ffmpeg is found reliably**: the core passes `--ffmpeg-location` pointing at `bin/`, so merging and cutting work even when `bin/` is not on `PATH`.
- **Error reporting**: failures before yt-dlp even starts (missing URL, missing yt-dlp, bad trim) now publish a proper error status, so the panel shows the reason instead of "core did not start".
- **`%` lines**: `[download] Destination: ...50%.mp4` is no longer misread as a progress line.
- **Version drift**: single source of truth (`core/Cargo.toml`), the core reports its version in `status.json`, and the panel shows `panel vX core vY`.
- **Log spam**: ticks are logged on state change or every 5%, and the log rotates at 512 KB.

### Changed
- Installer detects After Effects through the registry (any drive/version) instead of a single hardcoded `C:\Program Files` glob, and installs into every version found.
- Config is written as UTF-8 without BOM, so non-ASCII user names work.
- Release ZIP now includes `ffprobe.exe`, `LICENSE`, `README.md` and `CHANGELOG.md`, and refuses to build if a required file is missing.
- `fetch-deps.ps1` forces TLS 1.2 and validates the downloads.

### Added
- `--request <file>`, `--job <id>`, `--yt-dlp`, `--ffmpeg`, `--bridge` flags, `--version` and `--help`.
- Unit tests for the progress parser, argument/request parsing and output-file handling (`cd core; cargo test`).

## 1.0.0
- Segment trim, robust polling, flight recorder logging.
