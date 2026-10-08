// Dropline core: headless fetcher bridge for After Effects.
// Usage:
//   dropline-core.exe cli --url <url> [--start 00:00] [--end 00:10]
//   dropline-core.exe update
// Progress is published to <home>/DroplineDownloads/status.json

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

const YT_DLP: &str = "C:\\Users\\angel\\.proyectos-photoshop\\dropline\\bin\\yt-dlp.exe";

struct Status { folder: PathBuf }

impl Status {
    fn write(&self, state: &str, percent: f64, message: &str, file: Option<&str>) {
        let json = serde_json::json!({
            "state": state,
            "percent": percent,
            "message": message,
            "file": file
        });
        let _ = fs::write(self.folder.join("status.json"), json.to_string());
    }
}

fn downloads_folder() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot detect user home folder".to_string())?;
    let folder = home.join("DroplineDownloads");
    fs::create_dir_all(&folder).map_err(|e| format!("Cannot create folder: {}", e))?;
    Ok(folder)
}

fn latest_mp4(folder: &PathBuf) -> Option<PathBuf> {
    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;
    if let Ok(entries) = fs::read_dir(folder) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("mp4") {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(m) = meta.modified() {
                        if best.as_ref().map_or(true, |(_, t)| m > *t) {
                            best = Some((path, m));
                        }
                    }
                }
            }
        }
    }
    best.map(|(p, _)| p)
}

fn parse_percent(line: &str) -> Option<f64> {
    let idx = line.find("[download]")?;
    let rest = &line[idx..];
    let p = rest.find('%')?;
    let before = &rest[..p];
    let bytes = before.as_bytes();
    let mut start = before.len();
    while start > 0 && (bytes[start - 1].is_ascii_digit() || bytes[start - 1] == b'.') {
        start -= 1;
    }
    before[start..].parse::<f64>().ok()
}

fn run_cli(args: &[String]) -> i32 {
    let mut url = String::new();
    let mut start = String::new();
    let mut end = String::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--url"   => { if i + 1 < args.len() { url   = args[i + 1].clone(); i += 1; } }
            "--start" => { if i + 1 < args.len() { start = args[i + 1].clone(); i += 1; } }
            "--end"   => { if i + 1 < args.len() { end   = args[i + 1].clone(); i += 1; } }
            _ => {}
        }
        i += 1;
    }
    if url.is_empty() { eprintln!("Missing --url"); return 1; }

    let folder = match downloads_folder() { Ok(f) => f, Err(e) => { eprintln!("{}", e); return 1; } };
    let st = Status { folder: folder.clone() };
    st.write("starting", 0.0, "Contacting platform...", None);

    let mut cmd = Command::new(YT_DLP);
    cmd.arg(&url)
        .arg("--restrict-filenames")
        .arg("--no-playlist")
        .arg("-f").arg("bv*[vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/b")
        .arg("--merge-output-format").arg("mp4")
        .arg("-o").arg(folder.join("%(title)s.%(ext)s"))
        .arg("--newline")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if !start.is_empty() && !end.is_empty() {
        cmd.arg("--download-sections").arg(format!("*{}-{}", start, end));
        cmd.arg("--force-keyframes-at-cuts");
        // Guarantee AE-friendly codecs after the cut re-encode
        cmd.arg("--postprocessor-args")
           .arg("ffmpeg:-c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k");
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => { st.write("error", 0.0, &format!("Cannot run yt-dlp: {}", e), None); return 1; }
    };

    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take().expect("stderr");

    // Shared state: (percent, state, last stderr lines for error reporting)
    let shared = Arc::new(Mutex::new((0.0f64, "downloading".to_string(), Vec::<String>::new())));

    let st_out = Status { folder: folder.clone() };
    let sh_out = shared.clone();
    let t_out = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if line.contains("[Merger]") || line.contains("[Fixup]") || line.contains("[ExtractAudio]") {
                let g = sh_out.lock().unwrap();
                st_out.write("encoding", g.0, "Merging / encoding with ffmpeg...", None);
            } else if let Some(p) = parse_percent(&line) {
                let mut g = sh_out.lock().unwrap();
                g.0 = p;
                g.1 = "downloading".to_string();
                st_out.write("downloading", p, &line, None);
            }
        }
    });

    let st_err = Status { folder: folder.clone() };
    let sh_err = shared.clone();
    let t_err = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let mut g = sh_err.lock().unwrap();
            g.2.push(line.clone());
            if g.2.len() > 6 { g.2.remove(0); }
            if let Some(p) = parse_percent(&line) {
                g.0 = p;
                st_err.write(&g.1, p, &line, None);
            }
        }
    });

    let ok = child.wait().map(|s| s.success()).unwrap_or(false);
    let _ = t_out.join();
    let _ = t_err.join();

    if !ok {
        let g = shared.lock().unwrap();
        let msg = g.2.join(" | ");
        let msg = if msg.is_empty() { "yt-dlp failed".to_string() } else { msg };
        st.write("error", 0.0, &msg, None);
        return 1;
    }

    match latest_mp4(&folder) {
        Some(video) => {
            let clean = video.to_string_lossy().replace('\\', "/");
            st.write("done", 100.0, "Ready to import", Some(&clean));
            // Legacy bridge file kept for backwards compatibility
            let _ = fs::write(folder.join("latest.json"), serde_json::json!({ "file": clean }).to_string());
            0
        }
        None => { st.write("error", 0.0, "Finished but no MP4 found", None); 1 }
    }
}

fn run_update() -> i32 {
    let folder = match downloads_folder() { Ok(f) => f, Err(_) => return 1 };
    let st = Status { folder };
    st.write("updating", 0.0, "Updating yt-dlp...", None);
    match Command::new(YT_DLP).arg("-U").output() {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout).to_string() + &String::from_utf8_lossy(&o.stderr);
            st.write("done", 100.0, text.trim(), None);
            0
        }
        Err(e) => { st.write("error", 0.0, &format!("Updater failed: {}", e), None); 1 }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let code = match args.get(1).map(|s| s.as_str()) {
        Some("cli")    => run_cli(&args[2..]),
        Some("update") => run_update(),
        _ => {
            println!("Dropline core (headless). Usage: dropline-core.exe cli --url <url> [--start HH:MM] [--end HH:MM] | update");
            0
        }
    };
    std::process::exit(code);
}