// Dropline core: headless fetcher bridge for After Effects.
//
// Usage:
//   dropline-core.exe cli --url <url> [--start HH:MM:SS] [--end HH:MM:SS] [--audio-only] [--job <id>]
//   dropline-core.exe cli --request <request.json>   (preferred: the panel writes this file)
//   dropline-core.exe update
//   dropline-core.exe --version
//
// The panel and the core talk through <bridge>/status.json
// (bridge defaults to ~/DroplineDownloads, see ~/.dropline/config.json).
// Exit code: 0 = success, 1 = error.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::SystemTime;

use serde_json::{json, Value};

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug, Default)]
struct Job {
    url: String,
    start: String,
    end: String,
    audio_only: bool,
    job: String,
    bridge: Option<String>,
    ytdlp: Option<String>,
    ffmpeg: Option<String>,
}

impl Job {
    fn sanitize(&mut self) {
        self.url = self.url.trim().to_string();
        self.start = self.start.trim().to_string();
        self.end = self.end.trim().to_string();
        // The job tag goes into a filename, so keep it to plain ASCII alphanumerics
        self.job = self.job.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    }

    fn has_trim(&self) -> bool {
        !self.start.is_empty() && !self.end.is_empty()
    }
}

#[derive(Clone, Debug)]
struct Status {
    folder: PathBuf,
    job: String,
}

impl Status {
    fn write(&self, state: &str, percent: f64, message: &str, file: Option<&str>) {
        let payload = json!({
            "version": VERSION,
            "job": self.job,
            "state": state,
            "percent": percent,
            "message": message,
            "file": file
        });
        let _ = fs::write(self.folder.join("status.json"), payload.to_string());
    }
}

// ===== configuration =====

fn load_config() -> Value {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Value::Null,
    };
    match fs::read(home.join(".dropline").join("config.json")) {
        Ok(bytes) => {
            let text = String::from_utf8_lossy(&bytes).to_string();
            let text = text.trim_start_matches('\u{feff}');
            serde_json::from_str(text).unwrap_or(Value::Null)
        }
        Err(_) => Value::Null,
    }
}

fn cfg_string(cfg: &Value, key: &str) -> Option<String> {
    cfg.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn as_bool(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::String(s) => {
            let s = s.trim().to_ascii_lowercase();
            s == "1" || s == "true" || s == "yes" || s == "on"
        }
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        _ => false,
    }
}

fn nonempty(s: String) -> Option<String> {
    if s.trim().is_empty() {
        None
    } else {
        Some(s)
    }
}

fn first_existing(dir: &Path, stem: &str) -> Option<PathBuf> {
    let candidates = [format!("{}.exe", stem), stem.to_string()];
    candidates
        .iter()
        .map(|name| dir.join(name))
        .find(|p| p.is_file())
}

fn bridge_folder(job: &Job, cfg: &Value) -> Result<PathBuf, String> {
    let explicit = job
        .bridge
        .clone()
        .filter(|p| !p.trim().is_empty())
        .or_else(|| cfg_string(cfg, "bridge"));
    let folder = match explicit {
        Some(p) => PathBuf::from(p),
        None => dirs::home_dir()
            .ok_or_else(|| "Cannot detect the user home folder".to_string())?
            .join("DroplineDownloads"),
    };
    fs::create_dir_all(&folder)
        .map_err(|e| format!("Cannot create bridge folder {}: {}", folder.display(), e))?;
    Ok(folder)
}

// The binary ships next to yt-dlp/ffmpeg, but people also run it straight from
// target/release while developing, so both layouts are checked. No absolute path
// of the author's machine, ever.
fn resolve_ytdlp(job: &Job, cfg: &Value) -> PathBuf {
    if let Some(p) = job.ytdlp.clone().filter(|p| !p.trim().is_empty()) {
        return PathBuf::from(p);
    }
    if let Some(p) = cfg_string(cfg, "ytdlp") {
        return PathBuf::from(p);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if let Some(found) = first_existing(dir, "yt-dlp") {
                return found;
            }
            if let Some(found) = first_existing(&dir.join("..").join("bin"), "yt-dlp") {
                return found;
            }
        }
    }
    PathBuf::from("yt-dlp") // last resort: whatever is on PATH
}

fn resolve_ffmpeg_dir(job: &Job, cfg: &Value, ytdlp: &Path) -> Option<PathBuf> {
    let explicit = job
        .ffmpeg
        .clone()
        .filter(|p| !p.trim().is_empty())
        .or_else(|| cfg_string(cfg, "ffmpeg"));
    if let Some(p) = explicit {
        let path = PathBuf::from(p);
        if path.is_dir() {
            return Some(path);
        }
        if path.is_file() {
            return path.parent().map(Path::to_path_buf);
        }
    }
    let dir = ytdlp.parent()?;
    if first_existing(dir, "ffmpeg").is_some() {
        Some(dir.to_path_buf())
    } else {
        None
    }
}

// ===== helpers =====

fn parse_percent(line: &str) -> Option<f64> {
    let idx = line.find("[download]")?;
    let rest = &line[idx..];
    let pct = rest.find('%')?;
    // "[download] Destination: C:/weird/50%.mp4" is not a progress line
    if let Some(next) = rest[pct + 1..].chars().next() {
        if !next.is_whitespace() {
            return None;
        }
    }
    let before = &rest[..pct];
    let bytes = before.as_bytes();
    let mut start = before.len();
    while start > 0 && (bytes[start - 1].is_ascii_digit() || bytes[start - 1] == b'.') {
        start -= 1;
    }
    if start == before.len() {
        return None;
    }
    before[start..].parse::<f64>().ok()
}

fn media_score(ext: &str, audio_only: bool) -> u8 {
    let ext = ext.to_ascii_lowercase();
    let video = ["mp4", "mov", "mkv", "webm"];
    let audio = ["m4a", "mp3", "aac", "opus", "ogg", "wav"];
    let primary = if audio_only { audio.as_slice() } else { video.as_slice() };
    let secondary = if audio_only { video.as_slice() } else { audio.as_slice() };
    if primary.contains(&ext.as_str()) {
        2
    } else if secondary.contains(&ext.as_str()) {
        1
    } else {
        0
    }
}

// Only files that carry this job's tag, so two downloads can never steal each
// other's output.
fn find_job_output(folder: &Path, job: &str, audio_only: bool) -> Option<PathBuf> {
    let tag = format!("__{}", job);
    let mut best: Option<(PathBuf, u8, SystemTime)> = None;
    if let Ok(entries) = fs::read_dir(folder) {
        for entry in entries.flatten() {
            let path = entry.path();
            let tagged = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.contains(&tag))
                .unwrap_or(false);
            if !tagged {
                continue;
            }
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let score = media_score(ext, audio_only);
            if score == 0 {
                continue;
            }
            let mtime = entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let better = match &best {
                None => true,
                Some((_, best_score, best_time)) => {
                    score > *best_score || (score == *best_score && mtime > *best_time)
                }
            };
            if better {
                best = Some((path, score, mtime));
            }
        }
    }
    best.map(|(path, _, _)| path)
}

fn newest_media(folder: &Path, audio_only: bool, since: SystemTime) -> Option<PathBuf> {
    let mut best: Option<(PathBuf, SystemTime)> = None;
    if let Ok(entries) = fs::read_dir(folder) {
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if media_score(ext, audio_only) == 0 {
                continue;
            }
            if let Ok(mtime) = entry.metadata().and_then(|m| m.modified()) {
                if mtime < since {
                    continue;
                }
                if best.as_ref().map_or(true, |(_, t)| mtime > *t) {
                    best = Some((path, mtime));
                }
            }
        }
    }
    best.map(|(path, _)| path)
}

fn clean_job_name(name: &str, job: &str) -> String {
    let cleaned = name.replace(&format!("__{}", job), "");
    let cleaned = cleaned.trim_end_matches('_').to_string();
    if cleaned.is_empty() {
        format!("dropline_{}", job)
    } else {
        cleaned
    }
}

// Returns the final media file, with the internal job tag stripped from the name.
fn finalize_output(folder: &Path, job: &Job, since: SystemTime) -> Option<PathBuf> {
    let found = if job.job.is_empty() {
        newest_media(folder, job.audio_only, since)
    } else {
        find_job_output(folder, &job.job, job.audio_only)
            .or_else(|| newest_media(folder, job.audio_only, since))
    }?;

    if job.job.is_empty() || !found.file_name().and_then(|n| n.to_str()).unwrap_or("").contains(&format!("__{}", job.job)) {
        return Some(found);
    }

    let stem = found
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("dropline")
        .to_string();
    let ext = found
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp4")
        .to_string();
    let cleaned = clean_job_name(&stem, &job.job);

    let mut target = found.with_file_name(format!("{}.{}", cleaned, ext));
    let mut n = 1;
    while target.exists() {
        target = found.with_file_name(format!("{}_{}.{}", cleaned, n, ext));
        n += 1;
    }
    match fs::rename(&found, &target) {
        Ok(_) => Some(target),
        Err(_) => Some(found),
    }
}

// ===== argument / request parsing =====

fn arg_value(args: &[String], i: &usize, flag: &str) -> Result<String, String> {
    if *i + 1 < args.len() {
        Ok(args[*i + 1].clone())
    } else {
        Err(format!("Missing value for {}", flag))
    }
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let bytes =
        fs::read(path).map_err(|e| format!("Cannot read {}: {}", path.display(), e))?;
    let text = String::from_utf8_lossy(&bytes).to_string();
    let text = text.trim_start_matches('\u{feff}');
    serde_json::from_str(text).map_err(|e| format!("Bad JSON in {}: {}", path.display(), e))
}

fn job_from_request_file(path: &Path) -> Result<Job, String> {
    let value = read_json_file(path)?;
    let field = |key: &str| -> String {
        value
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    Ok(Job {
        url: field("url"),
        start: field("start"),
        end: field("end"),
        audio_only: value.get("audioOnly").map(as_bool).unwrap_or(false),
        job: field("job"),
        bridge: nonempty(field("bridge")),
        ytdlp: nonempty(field("ytdlp")),
        ffmpeg: nonempty(field("ffmpeg")),
    })
}

fn merge_jobs(mut primary: Job, fallback: Job) -> Job {
    if primary.url.is_empty() {
        primary.url = fallback.url;
    }
    if primary.start.is_empty() {
        primary.start = fallback.start;
    }
    if primary.end.is_empty() {
        primary.end = fallback.end;
    }
    if primary.job.is_empty() {
        primary.job = fallback.job;
    }
    if primary.bridge.is_none() {
        primary.bridge = fallback.bridge;
    }
    if primary.ytdlp.is_none() {
        primary.ytdlp = fallback.ytdlp;
    }
    if primary.ffmpeg.is_none() {
        primary.ffmpeg = fallback.ffmpeg;
    }
    if !primary.audio_only {
        primary.audio_only = fallback.audio_only;
    }
    primary
}

fn job_from_args(args: &[String]) -> Result<Job, String> {
    let mut flags = Job::default();
    let mut from_file: Option<Job> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--url" => {
                flags.url = arg_value(args, &i, "--url")?;
                i += 1;
            }
            "--start" => {
                flags.start = arg_value(args, &i, "--start")?;
                i += 1;
            }
            "--end" => {
                flags.end = arg_value(args, &i, "--end")?;
                i += 1;
            }
            "--job" => {
                flags.job = arg_value(args, &i, "--job")?;
                i += 1;
            }
            "--bridge" => {
                flags.bridge = Some(arg_value(args, &i, "--bridge")?);
                i += 1;
            }
            "--yt-dlp" => {
                flags.ytdlp = Some(arg_value(args, &i, "--yt-dlp")?);
                i += 1;
            }
            "--ffmpeg" => {
                flags.ffmpeg = Some(arg_value(args, &i, "--ffmpeg")?);
                i += 1;
            }
            "--audio-only" | "--audio" => flags.audio_only = true,
            "--request" => {
                let path = arg_value(args, &i, "--request")?;
                from_file = Some(job_from_request_file(Path::new(&path))?);
                i += 1;
            }
            other => return Err(format!("Unknown argument: {} (see --help)", other)),
        }
        i += 1;
    }
    // Explicit flags always win over the request file, whatever their order
    Ok(match from_file {
        Some(file_job) => merge_jobs(flags, file_job),
        None => flags,
    })
}

// ===== commands =====

fn run_cli(args: &[String]) -> i32 {
    let mut job = match job_from_args(args) {
        Ok(job) => job,
        Err(e) => {
            eprintln!("{}", e);
            return 1;
        }
    };
    job.sanitize();

    let cfg = load_config();
    let folder = match bridge_folder(&job, &cfg) {
        Ok(folder) => folder,
        Err(e) => {
            eprintln!("{}", e);
            return 1;
        }
    };
    let status = Status {
        folder: folder.clone(),
        job: job.job.clone(),
    };

    if job.url.is_empty() {
        status.write("error", 0.0, "Missing video URL", None);
        eprintln!("Missing --url (or a 'url' field in the request file)");
        return 1;
    }
    if job.start.is_empty() != job.end.is_empty() {
        status.write(
            "error",
            0.0,
            "Trim needs both IN and OUT (e.g. --start 00:10 --end 00:25)",
            None,
        );
        return 1;
    }

    let ytdlp = resolve_ytdlp(&job, &cfg);
    if ytdlp.is_absolute() && !ytdlp.is_file() {
        let msg = format!(
            "yt-dlp not found at {} - run scripts/fetch-deps.ps1 or set \"ytdlp\" in ~/.dropline/config.json",
            ytdlp.display()
        );
        status.write("error", 0.0, &msg, None);
        eprintln!("{}", msg);
        return 1;
    }
    let ffmpeg_dir = resolve_ffmpeg_dir(&job, &cfg, &ytdlp);

    status.write("starting", 0.0, "Contacting platform...", None);
    let started = SystemTime::now();

    let template = if job.job.is_empty() {
        folder.join("%(title)s.%(ext)s")
    } else {
        folder.join(format!("%(title)s__{}.%(ext)s", job.job))
    };

    let mut cmd = Command::new(&ytdlp);
    cmd.arg(&job.url)
        .arg("--restrict-filenames")
        .arg("--no-playlist")
        .arg("--newline")
        .arg("--merge-output-format")
        .arg("mp4")
        .arg("-o")
        .arg(&template);
    if let Some(dir) = &ffmpeg_dir {
        cmd.arg("--ffmpeg-location").arg(dir);
    }
    if job.audio_only {
        cmd.arg("-x")
            .arg("--audio-format")
            .arg("m4a")
            .arg("--audio-quality")
            .arg("0");
    } else {
        cmd.arg("-f").arg("bv*[vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/b");
    }
    if job.has_trim() {
        cmd.arg("--download-sections")
            .arg(format!("*{}-{}", job.start, job.end));
        cmd.arg("--force-keyframes-at-cuts");
        // Guarantee AE-friendly codecs after the cut re-encode
        if job.audio_only {
            cmd.arg("--postprocessor-args")
                .arg("ExtractAudio:-c:a aac -b:a 192k");
        } else {
            cmd.arg("--postprocessor-args")
                .arg("ffmpeg:-c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k");
        }
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            let msg = format!("Cannot run yt-dlp ({}): {}", ytdlp.display(), e);
            status.write("error", 0.0, &msg, None);
            eprintln!("{}", msg);
            return 1;
        }
    };

    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");

    // Shared state: (percent, state, last stderr lines for error reporting)
    let shared = Arc::new(Mutex::new((0.0f64, "downloading".to_string(), Vec::<String>::new())));

    let st_out = status.clone();
    let sh_out = Arc::clone(&shared);
    let t_out = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if line.contains("[Merger]") || line.contains("[Fixup]") || line.contains("[ExtractAudio]") {
                let pct = sh_out.lock().unwrap().0;
                st_out.write("encoding", pct, "Merging / encoding with ffmpeg...", None);
            } else if let Some(pct) = parse_percent(&line) {
                {
                    let mut guard = sh_out.lock().unwrap();
                    guard.0 = pct;
                    guard.1 = "downloading".to_string();
                }
                st_out.write("downloading", pct, &line, None);
            }
        }
    });

    let st_err = status.clone();
    let sh_err = Arc::clone(&shared);
    let t_err = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let mut guard = sh_err.lock().unwrap();
            guard.2.push(line.clone());
            if guard.2.len() > 6 {
                guard.2.remove(0);
            }
            let state = guard.1.clone();
            if let Some(pct) = parse_percent(&line) {
                guard.0 = pct;
                drop(guard);
                st_err.write(&state, pct, &line, None);
            }
        }
    });

    let ok = child.wait().map(|s| s.success()).unwrap_or(false);
    let _ = t_out.join();
    let _ = t_err.join();

    if !ok {
        let msg = {
            let guard = shared.lock().unwrap();
            let joined = guard.2.join(" | ");
            if joined.is_empty() {
                "yt-dlp failed - see ~/.dropline/dropline.log".to_string()
            } else {
                joined
            }
        };
        status.write("error", 0.0, &msg, None);
        return 1;
    }

    match finalize_output(&folder, &job, started) {
        Some(file) => {
            let clean = file.to_string_lossy().replace('\\', "/");
            status.write("done", 100.0, "Ready to import", Some(&clean));
            // Legacy bridge file kept for backwards compatibility
            let _ = fs::write(
                folder.join("latest.json"),
                json!({ "file": clean }).to_string(),
            );
            0
        }
        None => {
            status.write(
                "error",
                0.0,
                "The download finished but no media file was found in the bridge folder",
                None,
            );
            1
        }
    }
}

fn run_update() -> i32 {
    let cfg = load_config();
    let job = Job::default();
    let folder = match bridge_folder(&job, &cfg) {
        Ok(folder) => folder,
        Err(e) => {
            eprintln!("{}", e);
            return 1;
        }
    };
    let status = Status {
        folder,
        job: String::new(),
    };
    let ytdlp = resolve_ytdlp(&job, &cfg);

    status.write("updating", 0.0, "Updating yt-dlp...", None);
    match Command::new(&ytdlp).arg("-U").output() {
        Ok(output) => {
            let text = String::from_utf8_lossy(&output.stdout).to_string()
                + &String::from_utf8_lossy(&output.stderr);
            if output.status.success() {
                status.write("done", 100.0, text.trim(), None);
                0
            } else {
                status.write("error", 0.0, text.trim(), None);
                1
            }
        }
        Err(e) => {
            let msg = format!("Updater failed ({}): {}", ytdlp.display(), e);
            status.write("error", 0.0, &msg, None);
            eprintln!("{}", msg);
            1
        }
    }
}

fn print_usage() {
    println!("Dropline core {}", VERSION);
    println!("Usage:");
    println!("  dropline-core.exe cli --url <url> [--start HH:MM:SS] [--end HH:MM:SS] [--audio-only] [--job <id>]");
    println!("  dropline-core.exe cli --request <request.json>");
    println!("  dropline-core.exe update");
    println!("  dropline-core.exe --version");
    println!();
    println!("Optional overrides: --yt-dlp <exe>  --ffmpeg <dir|exe>  --bridge <dir>");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let code = match args.get(1).map(|s| s.as_str()) {
        Some("cli") => run_cli(&args[2..]),
        Some("update") => run_update(),
        Some("--version") | Some("-V") => {
            println!("dropline-core {}", VERSION);
            0
        }
        Some("--help") | Some("-h") | None => {
            print_usage();
            0
        }
        Some(other) => {
            eprintln!("Unknown command: {}", other);
            print_usage();
            2
        }
    };
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_lines_are_parsed() {
        assert_eq!(parse_percent("[download]   0.0% of  3.71MiB at Unknown"), Some(0.0));
        assert_eq!(parse_percent("[download]  45.3% of 10.00MiB at 1.00MiB/s"), Some(45.3));
        assert_eq!(parse_percent("[download] 100% of 5.00MiB in 00:03"), Some(100.0));
        assert_eq!(parse_percent("[download] 100% has already been downloaded"), Some(100.0));
    }

    #[test]
    fn destination_lines_are_not_percentages() {
        assert_eq!(parse_percent("[download] Destination: C:/tmp/50%.mp4"), None);
        assert_eq!(parse_percent("[download] %"), None);
        assert_eq!(parse_percent("[info] nothing to see here"), None);
    }

    #[test]
    fn args_are_parsed_and_unknown_flags_rejected() {
        let args: Vec<String> = [
            "--url",
            "https://example.com/v",
            "--audio-only",
            "--start",
            "00:01",
            "--end",
            "00:02",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let job = job_from_args(&args).unwrap();
        assert_eq!(job.url, "https://example.com/v");
        assert!(job.audio_only);
        assert!(job.has_trim());

        assert!(job_from_args(&["--nope".to_string()]).is_err());
        assert!(job_from_args(&["--url".to_string()]).is_err());
    }

    #[test]
    fn request_files_are_read_and_merged_with_flags() {
        let path = std::env::temp_dir().join(format!("dropline-test-{}.json", std::process::id()));
        fs::write(
            &path,
            r#"{ "url": "https://example.com/a", "audioOnly": "1", "job": "j7", "start": "00:05" }"#,
        )
        .unwrap();

        let job = job_from_args(&[
            "--request".to_string(),
            path.to_string_lossy().to_string(),
            "--end".to_string(),
            "00:09".to_string(),
        ])
        .unwrap();
        let _ = fs::remove_file(&path);

        assert_eq!(job.url, "https://example.com/a");
        assert_eq!(job.job, "j7");
        assert!(job.audio_only);
        assert_eq!(job.end, "00:09");
        assert!(job.has_trim());
    }

    #[test]
    fn job_tags_are_stripped_from_names() {
        assert_eq!(clean_job_name("My_Video__j42", "j42"), "My_Video");
        assert_eq!(clean_job_name("__j42", "j42"), "dropline_j42");
        assert_eq!(clean_job_name("plain", "j42"), "plain");
    }

    #[test]
    fn the_right_output_file_is_picked_and_renamed() {
        let dir = std::env::temp_dir().join(format!("dropline-out-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Mine__j1.mp4"), b"x").unwrap();
        fs::write(dir.join("Other__j2.mp4"), b"x").unwrap();
        fs::write(dir.join("junk.txt"), b"x").unwrap();

        let job = Job {
            job: "j1".to_string(),
            ..Job::default()
        };
        let picked = finalize_output(&dir, &job, SystemTime::UNIX_EPOCH).unwrap();
        assert_eq!(picked.file_name().unwrap().to_string_lossy(), "Mine.mp4");
        assert!(dir.join("Mine.mp4").is_file());
        assert!(!dir.join("Mine__j1.mp4").exists());
        assert!(dir.join("Other__j2.mp4").is_file(), "another job's file must be left alone");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn audio_only_prefers_the_m4a() {
        let dir = std::env::temp_dir().join(format!("dropline-audio-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Song__j3.mp4"), b"x").unwrap();
        fs::write(dir.join("Song__j3.m4a"), b"x").unwrap();

        let job = Job {
            job: "j3".to_string(),
            audio_only: true,
            ..Job::default()
        };
        let picked = finalize_output(&dir, &job, SystemTime::UNIX_EPOCH).unwrap();
        assert_eq!(picked.file_name().unwrap().to_string_lossy(), "Song.m4a");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn name_collisions_do_not_overwrite() {
        let dir = std::env::temp_dir().join(format!("dropline-collide-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Clip.mp4"), b"old").unwrap();
        fs::write(dir.join("Clip__j9.mp4"), b"new").unwrap();

        let job = Job {
            job: "j9".to_string(),
            ..Job::default()
        };
        let picked = finalize_output(&dir, &job, SystemTime::UNIX_EPOCH).unwrap();
        assert_eq!(picked.file_name().unwrap().to_string_lossy(), "Clip_1.mp4");
        assert_eq!(fs::read(dir.join("Clip.mp4")).unwrap(), b"old");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn media_scores_prefer_the_requested_mode() {
        assert_eq!(media_score("mp4", false), 2);
        assert_eq!(media_score("MP4", false), 2);
        assert_eq!(media_score("m4a", false), 1);
        assert_eq!(media_score("m4a", true), 2);
        assert_eq!(media_score("mp4", true), 1);
        assert_eq!(media_score("txt", true), 0);
    }

    #[test]
    fn config_values_are_read_defensively() {
        let cfg: Value = serde_json::from_str(
            r#"{ "ytdlp": "C:\\tools\\yt-dlp.exe", "bridge": "  ", "audioOnly": true }"#,
        )
        .unwrap();
        assert_eq!(
            cfg_string(&cfg, "ytdlp").as_deref(),
            Some("C:\\tools\\yt-dlp.exe")
        );
        assert_eq!(cfg_string(&cfg, "bridge"), None);
        assert!(as_bool(cfg.get("audioOnly").unwrap()));
        assert!(!as_bool(&Value::Null));
    }
}
