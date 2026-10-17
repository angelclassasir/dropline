# Changelog

All notable changes to Dropline. Versions match `core/Cargo.toml`; the release ZIP is named from it.

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
