// Dropline panel v1.1.0 - After Effects ScriptUI panel
//
// The URL never touches the command line: it travels inside request.json and the
// core reads it from there, so there is nothing to escape or inject. Progress
// comes back through status.json.
//
// Two hard-won rules in here, both learned the hard way:
//   1. system.callSystem blocks until every process holding AE's stdout pipe is gone,
//      so `cmd /c start` froze After Effects for the entire download (and forever when
//      the child outlived the session). The core is started through a generated .vbs
//      run by wscript.exe: WScript.Shell.Run gives it a private hidden console, so
//      callSystem returns in ~300ms while the download continues detached.
//   2. Polling must never run in a while + $.sleep loop: that owns the app's
//      thread and freezes the UI. app.scheduleTask() gives the polling back to
//      After Effects' own event loop, so the app stays responsive.

if (!String.prototype.trim) {
    String.prototype.trim = function () { return String(this).replace(/^\s+/, "").replace(/\s+$/, ""); };
}

(function (thisObj) {
    var PANEL_VERSION = "1.1.0";

    var HOME = (function () {
        try { return Folder.userData.parent.parent.fsName; } catch (e) {}
        try { return Folder("~").fsName; } catch (e2) {}
        return "";
    })();

    // ===== minimal JSON reader (never eval file contents) =====
    function parseJSON(src) {
        var s = String(src);
        if (s.charCodeAt(0) === 0xFEFF) s = s.substring(1); // strip BOM
        var i = 0;

        function skipWS() {
            while (i < s.length) {
                var c = s.charAt(i);
                if (c !== " " && c !== "\t" && c !== "\r" && c !== "\n") return;
                i++;
            }
        }
        function fail(why) { throw new Error("bad JSON (" + why + ") at " + i); }
        function readString() {
            i++; // opening quote
            var out = "";
            while (i < s.length) {
                var c = s.charAt(i++);
                if (c === '"') return out;
                if (c !== "\\") { out += c; continue; }
                var esc = s.charAt(i++);
                if (esc === "u") { out += String.fromCharCode(parseInt(s.substr(i, 4), 16)); i += 4; }
                else if (esc === "n") out += "\n";
                else if (esc === "t") out += "\t";
                else if (esc === "r") out += "\r";
                else if (esc === "b") out += "\b";
                else if (esc === "f") out += "\f";
                else out += esc; // \"  \\  \/
            }
            fail("unterminated string");
        }
        function readValue() {
            skipWS();
            var c = s.charAt(i);
            if (c === "{") {
                i++;
                var obj = {};
                skipWS();
                if (s.charAt(i) === "}") { i++; return obj; }
                for (;;) {
                    skipWS();
                    if (s.charAt(i) !== '"') fail("expected a key");
                    var key = readString();
                    skipWS();
                    if (s.charAt(i) !== ":") fail("expected :");
                    i++;
                    obj[key] = readValue();
                    skipWS();
                    var delim = s.charAt(i++);
                    if (delim === "}") return obj;
                    if (delim !== ",") fail("expected , or }");
                }
            }
            if (c === "[") {
                i++;
                var arr = [];
                skipWS();
                if (s.charAt(i) === "]") { i++; return arr; }
                for (;;) {
                    arr.push(readValue());
                    skipWS();
                    var delim2 = s.charAt(i++);
                    if (delim2 === "]") return arr;
                    if (delim2 !== ",") fail("expected , or ]");
                }
            }
            if (c === '"') return readString();
            var rest = s.substr(i);
            if (rest.indexOf("true") === 0) { i += 4; return true; }
            if (rest.indexOf("false") === 0) { i += 5; return false; }
            if (rest.indexOf("null") === 0) { i += 4; return null; }
            var num = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
            if (!num) fail("unexpected value");
            i += num[0].length;
            return parseFloat(num[0]);
        }

        var result = readValue();
        skipWS();
        if (i < s.length) fail("trailing content"); // a half-written file must fail, not half-parse
        return result;
    }

    // Writes flat string maps, which is all the core ever needs
    function jsonString(value) {
        var text = String(value);
        var out = '"';
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            var code = text.charCodeAt(i);
            if (ch === '"' || ch === "\\") out += "\\" + ch;
            else if (code < 32) out += "\\u" + ("000" + code.toString(16)).slice(-4);
            else out += ch;
        }
        return out + '"';
    }

    // ===== flight recorder (rotates at 512 KB) =====
    function log(msg) {
        try {
            var dir = new Folder(HOME + "/.dropline");
            if (!dir.exists) dir.create();
            var file = new File(HOME + "/.dropline/dropline.log");
            if (file.exists && file.length > 512 * 1024) {
                var old = new File(HOME + "/.dropline/dropline.log.1");
                if (old.exists) { try { old.remove(); } catch (e0) {} }
                try { file.rename("dropline.log.1"); } catch (e1) {}
                file = new File(HOME + "/.dropline/dropline.log");
            }
            file.encoding = "UTF-8";
            file.open("a");
            file.writeln(new Date().toString() + " | " + msg);
            file.close();
        } catch (e) {}
    }

    var CFG = (function () {
        var cfg = {
            exe: "", exeWin: "",
            bridge: HOME.replace(/\\/g, "/") + "/DroplineDownloads",
            bridgeWin: HOME.replace(/\//g, "\\") + "\\DroplineDownloads",
            configured: false
        };
        var cfgFile = new File(HOME + "/.dropline/config.json");
        if (cfgFile.exists) {
            try {
                cfgFile.encoding = "UTF-8";
                cfgFile.open("r");
                var raw = cfgFile.read();
                cfgFile.close();
                var data = parseJSON(raw);
                if (data) {
                    if (data.coreExe) {
                        cfg.exe = String(data.coreExe).replace(/\\/g, "/");
                        cfg.exeWin = String(data.coreExe);
                    }
                    if (data.bridge) {
                        cfg.bridge = String(data.bridge).replace(/\\/g, "/");
                        cfg.bridgeWin = String(data.bridge);
                    }
                }
            } catch (e) {
                log("CONFIG PARSE FAILED " + e.toString());
            }
        }
        cfg.configured = cfg.exe !== "";
        cfg.request = cfg.bridge + "/request.json";
        cfg.requestWin = cfg.bridgeWin + "\\request.json";
        cfg.coreLog = cfg.bridge + "/core.log";
        cfg.coreLogWin = cfg.bridgeWin + "\\core.log";
        cfg.errLogWin = cfg.bridgeWin + "\\core.err.log";
        cfg.launcher = HOME.replace(/\\/g, "/") + "/.dropline/dropline-launch.vbs";
        cfg.launcherWin = HOME.replace(/\//g, "\\") + "\\.dropline\\dropline-launch.vbs";
        return cfg;
    })();

    var C = {
        bg:      [0.08, 0.08, 0.10, 1],
        surface: [0.13, 0.13, 0.16, 1],
        field:   [0.05, 0.05, 0.07, 1],
        accent:  [0.55, 0.36, 0.96, 1],
        text:    [0.93, 0.93, 0.95, 1],
        muted:   [0.50, 0.50, 0.56, 1],
        ok:      [0.13, 0.83, 0.55, 1],
        err:     [0.94, 0.27, 0.27, 1]
    };

    var pal = (thisObj instanceof Panel) ? thisObj : new Window("palette", "Dropline", undefined, {resizeable: true});
    pal.orientation = "column";
    pal.alignChildren = ["fill", "top"];
    pal.spacing = 12;
    pal.margins = 16;
    try { pal.graphics.backgroundColor = pal.graphics.newBrush(pal.graphics.BrushType.SOLID_COLOR, C.bg); } catch (e) {}

    function paint(ctrl, colorName, font) {
        try {
            if (font && !ctrl._fontSet) { ctrl.graphics.font = font; ctrl._fontSet = true; }
            if (!ctrl._pens) ctrl._pens = {};
            if (!ctrl._pens[colorName]) {
                ctrl._pens[colorName] = ctrl.graphics.newPen(ctrl.graphics.PenType.SOLID_COLOR, C[colorName], 1);
            }
            ctrl.graphics.foregroundColor = ctrl._pens[colorName];
        } catch (e) {}
    }
    function surface(ctrl, colorName) {
        try { ctrl.graphics.backgroundColor = ctrl.graphics.newBrush(ctrl.graphics.BrushType.SOLID_COLOR, C[colorName]); } catch (e) {}
    }

    var header = pal.add("group");
    header.orientation = "column";
    header.alignChildren = ["fill", "top"];
    header.spacing = 6;
    var title = header.add("statictext", undefined, "D R O P L I N E");
    paint(title, "accent", "bold 16px Segoe UI");
    var underline = header.add("group");
    underline.preferredSize.height = 2;
    surface(underline, "accent");
    var subtitle = header.add("statictext", undefined, "drop videos straight into your timeline");
    paint(subtitle, "muted", "italic 10px Segoe UI");

    var card = pal.add("group");
    card.orientation = "column";
    card.alignChildren = ["fill", "top"];
    card.spacing = 8;
    card.margins = 12;
    surface(card, "surface");

    var urlLabel = card.add("statictext", undefined, "VIDEO URL");
    paint(urlLabel, "muted", "bold 9px Segoe UI");
    var urlInput = card.add("edittext", undefined, "");
    urlInput.preferredSize.height = 28;
    surface(urlInput, "field");

    var timeRow = card.add("group");
    timeRow.orientation = "row";
    timeRow.spacing = 8;
    var inLabel = timeRow.add("statictext", undefined, "IN");
    paint(inLabel, "muted", "bold 9px Segoe UI");
    var inInput = timeRow.add("edittext", undefined, "");
    inInput.preferredSize.width = 70;
    inInput.preferredSize.height = 24;
    surface(inInput, "field");
    var outLabel = timeRow.add("statictext", undefined, "OUT");
    paint(outLabel, "muted", "bold 9px Segoe UI");
    var outInput = timeRow.add("edittext", undefined, "");
    outInput.preferredSize.width = 70;
    outInput.preferredSize.height = 24;
    surface(outInput, "field");

    var audioCheck = card.add("checkbox", undefined, "AUDIO ONLY (extract .m4a)");
    paint(audioCheck, "text", "10px Segoe UI");

    var stepsRow = pal.add("group");
    stepsRow.orientation = "row";
    stepsRow.alignChildren = ["fill", "top"];
    stepsRow.spacing = 4;
    function makeStep(num, label) {
        var g = stepsRow.add("group");
        g.orientation = "column";
        g.alignChildren = ["center", "top"];
        g.spacing = 2;
        var n = g.add("statictext", undefined, num);
        paint(n, "muted", "bold 14px Segoe UI");
        var l = g.add("statictext", undefined, label);
        paint(l, "muted", "9px Segoe UI");
        return { n: n, l: l };
    }
    var s1 = makeStep("01", "FETCH");
    var s2 = makeStep("02", "ENCODE");
    var s3 = makeStep("03", "TIMELINE");
    function paintStep(s, color) { paint(s.n, color, "bold 14px Segoe UI"); paint(s.l, color, "9px Segoe UI"); }
    function resetSteps() { paintStep(s1, "muted"); paintStep(s2, "muted"); paintStep(s3, "muted"); }

    var consoleCard = pal.add("group");
    consoleCard.orientation = "column";
    consoleCard.alignChildren = ["fill", "top"];
    consoleCard.spacing = 6;
    consoleCard.margins = 12;
    surface(consoleCard, "surface");
    var progressText = consoleCard.add("statictext", undefined, "????????????????????????????????????  0%");
    paint(progressText, "accent", "12px Consolas");
    var statusText = consoleCard.add("statictext", undefined, "ready to drop");
    paint(statusText, "text", "10px Segoe UI");
    function setStatus(msg, color) {
        statusText.text = msg;
        paint(statusText, color || "text", "10px Segoe UI");
    }

    var dbg = pal.add("statictext", undefined, "dropline v" + PANEL_VERSION);
    paint(dbg, "muted", "8px Consolas");
    function setDebug(msg, color) {
        dbg.text = msg;
        paint(dbg, color || "muted", "8px Consolas");
    }

    var dropBtn = pal.add("button", undefined, "D R O P   I T");
    dropBtn.preferredSize.height = 40;
    var updateBtn = pal.add("button", undefined, "update engine (yt-dlp)");
    updateBtn.preferredSize.height = 22;

    var busy = false;
    var JOB = "";
    var lastCmd = "";

    function blocks(pct) {
        var filled = Math.round(pct / 100 * 12);
        var out = "";
        for (var i = 0; i < 12; i++) out += (i < filled) ? "???" : "???";
        return out;
    }

    // File cleanup only. Killing leftover processes is the launcher's job: doing it
    // here through system.callSystem froze the editor for ~0.5 s on every click.
    function aggressiveCleanup() {
        try {
            var junk = ["/status.json", "/callproof.txt", "/request.json"];
            for (var i = 0; i < junk.length; i++) {
                var f = new File(CFG.bridge + junk[i]);
                if (f.exists) f.remove();
            }
            var bridgeFolder = new Folder(CFG.bridge);
            if (bridgeFolder.exists) {
                var partFiles = bridgeFolder.getFiles("*.part");
                for (var j = 0; j < partFiles.length; j++) {
                    try { partFiles[j].remove(); } catch (e2) {}
                }
            }
        } catch (e) {}
        lastStatusKey = "";
        lastStatusData = null;
    }

    function writeRequest(fields) {
        var parts = [];
        for (var key in fields) {
            if (fields.hasOwnProperty(key)) parts.push(jsonString(key) + ":" + jsonString(fields[key]));
        }
        var file = new File(CFG.request);
        file.encoding = "UTF-8";
        file.open("w");
        file.write("{" + parts.join(",") + "}");
        file.close();
    }

    // Only sandboxed filesystem paths go on the shell line; the URL travels in request.json.
    //
    // Launching the core is the delicate part, and every "clever" way of doing it has
    // cost a frozen After Effects at some point:
    //   - `cmd /c start ...` leaves the child holding AE's stdout pipe, so callSystem
    //     waits for the whole download (and forever if that child outlives the session).
    //   - PowerShell's Start-Process looked right from Node but under AE either returned
    //     before starting anything or blocked for the download, depending on quoting.
    //   - the redirection has to live in a file, never in the string AE may re-parse.
    // What works: a two-line .vbs written here and run by wscript.exe. WScript.Shell.Run
    // with (window 0, wait False) gives the core its own hidden console, so no handle of
    // AE's pipe survives, and wscript exits at once. Measured inside AE: 278 ms to EOF
    // while the core downloaded the clip to completion.
    function writeLauncher(arguments) {
        // The kill of any leftover core/yt-dlp happens in the launcher, not in AE:
        // taskkill inside callSystem blocked the editor for ~0.5 s on every click.
        // WScript waits for it (True) in its own hidden console while AE carries on.
        var text = 'Dim sh\r\n' +
                   'Set sh = CreateObject("WScript.Shell")\r\n' +
                   'On Error Resume Next\r\n' +
                   'sh.Run "cmd /c taskkill /im dropline-core.exe /f /im yt-dlp.exe /f >nul 2>&1", 0, True\r\n' +
                   'On Error Goto 0\r\n' +
                   'sh.Run """' + CFG.exeWin + '"" ' + arguments + '", 0, False\r\n';
        var file = new File(CFG.launcher);
        if (!file.open("w")) throw new Error("cannot write " + CFG.launcher);
        file.write(text);
        file.close();
        return 'wscript.exe //nologo //B "' + CFG.launcherWin + '"';
    }

    function coreCommand() {
        return writeLauncher('cli --request ""' + CFG.requestWin + '""');
    }

    function updateCommand() {
        return writeLauncher('update');
    }

    function dropCoreLog() {
        try {
            var old = new File(CFG.coreLog);
            if (old.exists) old.remove();
            var oldErr = new File(CFG.errLog);
            if (oldErr.exists) oldErr.remove();
        } catch (e) {}
    }

    // Reading status.json on AE's main thread must be cheap: the tick runs a few
    // times a second. So there is no retry loop here (a $.sleep would freeze the
    // editor), and the file is only parsed when its size or timestamp changed. The
    // core publishes atomically (temp file + rename), so a half-written JSON is now
    // impossible rather than merely unlikely.
    var lastStatusKey = "";
    var lastStatusData = null;

    function readStatus() {
        var file = new File(CFG.bridge + "/status.json");
        if (!file.exists) {
            lastStatusKey = "";
            return null;
        }
        var key = file.length + ":" + file.modified.getTime();
        if (key === lastStatusKey) return lastStatusData;

        var data = null;
        try {
            file.encoding = "UTF-8";
            if (file.open("r")) {
                var text = file.read();
                file.close();
                data = parseJSON(text);
            }
        } catch (e) {
            try { file.close(); } catch (e2) {}
        }
        if (data && data.state) {
            lastStatusKey = key;
            lastStatusData = data;
            return data;
        }
        return lastStatusData; // keep the last good snapshot instead of losing a tick
    }

    function unlock() {
        busy = false;
        dropBtn.enabled = true;
        updateBtn.enabled = true;
    }

    // ===== non-blocking job watcher =====
    // Polling used to run inside a `while (true) { $.sleep(500); ... }` loop, which
    // owns After Effects' only thread: the app froze (and looked crashed) for the
    // whole download, before the progress window even appeared. app.scheduleTask()
    // gives the polling back to AE's own event loop, so the app stays alive and the
    // progress actually reaches the UI - which is what the README always promised.
    var watch = null;

    function startWatch(onDone, mode) {
        watch = {
            job: JOB,
            mode: mode || "job",
            onDone: onDone,
            startTime: new Date().getTime(),
            lastMove: new Date().getTime(),
            lastPct: -1,
            lastLogPct: -1,
            lastLogState: "",
            coreVersion: "",
            statusSeen: false,
            proofChecked: false,
            taskId: null
        };
        $.global.__droplinePoll = watchTick;
        try {
            // $.global is explicit on purpose: scheduleTask evaluates the string in the
            // app-wide scope, and the panel's locals live in its closure.
            watch.taskId = app.scheduleTask("$.global.__droplinePoll && $.global.__droplinePoll();", 750, true);
            log("WATCH STARTED job=" + watch.job + " task=" + watch.taskId);
        } catch (e) {
            log("SCHEDULETASK FAILED " + e.toString());
            var cb = watch.onDone;
            watch = null;
            if (cb) cb({ error: "cannot start polling: " + e.toString() });
        }
    }

    function stopWatch() {
        var w = watch;
        watch = null;
        if (w && w.taskId !== null) {
            try { app.cancelTask(w.taskId); } catch (e) {}
        }
        try { $.global.__droplinePoll = null; } catch (e2) {}
        return w;
    }

    function endWatch(result) {
        var w = stopWatch();
        log("WATCH ENDED error=" + (result && result.error ? result.error : "none") +
            " file=" + (result && result.file ? result.file : "none"));
        aggressiveCleanup();
        if (w && w.onDone) w.onDone(result);
    }

    function noteTick(state, pct) {
        if (state !== watch.lastLogState || pct >= watch.lastLogPct + 5) {
            watch.lastLogState = state;
            watch.lastLogPct = pct;
            log("tick " + state + " " + pct + "%");
        }
    }

    // A scheduled task that throws would pop an ExtendScript error dialog, so every
    // tick is contained here.
    function watchTick() {
        if (!watch) return;
        try {
            watchTickInner();
        } catch (e) {
            log("TICK EXCEPTION " + e.toString() + " line " + (e.line || -1));
            endWatch({ error: "internal error: " + e.toString() });
        }
    }

    function watchTickInner() {
        var now = new Date().getTime();
        var data = readStatus();

        if (!data) {
            if (!watch.statusSeen) {
                if (!watch.proofChecked && now - watch.startTime > 6000) {
                    watch.proofChecked = true;
                    var proof = new File(CFG.bridge + "/callproof.txt");
                    if (!proof.exists) {
                        log("FAIL: callSystem dead (no proof file)");
                        return endWatch({ error: "callSystem executes nothing here" });
                    }
                }
                if (now - watch.startTime > 20000) {
                    log("FAIL: core did not start within 20s");
                    return endWatch({ error: "core did not start - see footer", cmd: lastCmd });
                }
            }
            return;
        }

        // A leftover status file from another job must never drive this run
        if (watch.job && data.job && data.job !== watch.job) return;

        watch.statusSeen = true;
        if (data.version && !watch.coreVersion) {
            watch.coreVersion = data.version;
            setDebug("panel v" + PANEL_VERSION + " core v" + watch.coreVersion);
        }

        var pct = Math.floor(data.percent || 0);

        if (data.state === "starting" || data.state === "downloading") {
            // STALL BREAKER: no progress for 3 min -> clean error instead of hanging
            if (pct !== watch.lastPct) {
                watch.lastPct = pct;
                watch.lastMove = now;
            } else if (now - watch.lastMove > 180000) {
                log("STALL: stuck at " + pct + "% for 180s");
                return endWatch({ error: "download stalled at " + pct + "% (log saved)" });
            }
            noteTick(data.state, pct);
            progressText.text = blocks(pct) + "  " + pct + "%";
            paint(progressText, "accent", "12px Consolas");
            setStatus("01 FETCH - downloading " + pct + "%", "text");
            paintStep(s1, "accent");
        } else if (data.state === "encoding") {
            noteTick("encoding", pct);
            progressText.text = blocks(100) + "  merge";
            paint(progressText, "accent", "12px Consolas");
            setStatus("02 ENCODE - ffmpeg merging...", "text");
            paintStep(s1, "ok");
            paintStep(s2, "accent");
        } else if (data.state === "updating") {
            setStatus("updating yt-dlp engine...", "text");
        } else if (data.state === "done") {
            // The engine update reports done with no file; only a download owes us one.
            if (watch.mode === "update") {
                log("UPDATE DONE " + (data.message || ""));
                progressText.text = blocks(100) + "  100%";
                paint(progressText, "ok", "12px Consolas");
                return endWatch({ ok: true, message: data.message || "updated" });
            }
            log("DONE file=" + (data.file || "none"));
            progressText.text = blocks(100) + "  100%";
            paint(progressText, "ok", "12px Consolas");
            paintStep(s1, "ok");
            paintStep(s2, "ok");
            paintStep(s3, "accent");
            if (!data.file) {
                log("DONE WITHOUT FILE");
                return endWatch({ error: "the core finished but reported no file" });
            }
            return endWatch({ file: data.file });
        } else if (data.state === "error") {
            var msg = data.message || "unknown";
            log("CORE ERROR: " + msg);
            progressText.text = String(msg).slice(0, 60);
            paint(progressText, "err", "12px Consolas");
            return endWatch({ error: msg });
        }

        if (now - watch.startTime > 1800000) {
            log("TIMEOUT 30min");
            return endWatch({ error: "timeout after 30 min" });
        }
    }

    function autoImport(filePath) {
        var videoFile = new File(filePath);
        if (!videoFile.exists) { setStatus("file not found: " + filePath, "err"); log("IMPORT FAIL: missing " + filePath); return; }
        var prev = -1;
        // The core writes status "done" only after the file is complete, so this is
        // just insurance: a few short checks, never the old 10 x 400 ms stall.
        for (var k = 0; k < 4; k++) {
            var cur = videoFile.length;
            if (cur > 0 && cur === prev) break;
            prev = cur;
            if (k < 3) $.sleep(250);
        }
        if (prev <= 0) { setStatus("downloaded file is empty", "err"); paintStep(s3, "err"); log("IMPORT FAIL: empty file"); return; }
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) {
            setStatus("select a composition first", "err");
            paintStep(s3, "err");
            log("IMPORT FAIL: no active comp");
            return;
        }
        log("IMPORT START " + filePath + " size=" + prev);
        try {
            var io = new ImportOptions(videoFile);
            io.importAs = ImportAsType.FOOTAGE;
            var item = app.project.importFile(io);
            var layer = comp.layers.add(item);
            layer.startTime = comp.time;
            setStatus("imported: " + videoFile.displayName, "ok");
            paintStep(s3, "ok");
            log("IMPORT OK " + videoFile.displayName);
        } catch (e) {
            setStatus("import failed: " + e.toString(), "err");
            paintStep(s3, "err");
            log("IMPORT EXCEPTION " + e.toString());
        }
    }

    function launch() {
        if (busy) return;
        var url = urlInput.text.replace(/^\s+|\s+$/g, "");
        if (!url) { setStatus("paste a URL first", "err"); return; }
        if (!CFG.configured || !(new File(CFG.exe)).exists) {
            setStatus("run scripts/install.ps1 first", "err");
            setDebug("config missing: ~/.dropline/config.json", "err");
            return;
        }
        if (!system || !system.callSystem) { setStatus("system.callSystem is not available here", "err"); return; }

        busy = true;
        dropBtn.enabled = false;
        updateBtn.enabled = false;
        resetSteps();
        paintStep(s1, "accent");
        progressText.text = blocks(0) + "  0%";
        paint(progressText, "accent", "12px Consolas");
        aggressiveCleanup();

        JOB = "j" + (new Date().getTime()) + Math.floor(Math.random() * 1000);
        var inPoint = inInput.text.replace(/^\s+|\s+$/g, "");
        var outPoint = outInput.text.replace(/^\s+|\s+$/g, "");
        var request = { url: url, job: JOB, audioOnly: audioCheck.value ? "1" : "0" };
        if (inPoint && outPoint) { request.start = inPoint; request.end = outPoint; }

        try {
            writeRequest(request);
        } catch (e) {
            setStatus("cannot write request file: " + e.toString(), "err");
            log("REQUEST WRITE FAILED " + e.toString());
            unlock();
            return;
        }

        lastCmd = coreCommand();
        dropCoreLog();
        setDebug("launching core...", "muted");
        log("LAUNCH job=" + JOB + " trim=" + (inPoint && outPoint ? inPoint + "-" + outPoint : "no") +
            " audio=" + (audioCheck.value ? "yes" : "no") + " cmd=" + lastCmd);

        startWatch(function (result) {
            if (result.error) {
                setStatus("error: " + result.error, "err");
                if (result.cmd) setDebug("cmd -> " + result.cmd, "err");
                resetSteps();
            } else if (result.file) {
                autoImport(result.file);
            } else {
                setStatus("finished but the core reported no file", "err");
                resetSteps();
                log("NO FILE REPORTED");
            }
            unlock();
        });
        setStatus("starting core...", "text");

        // Proves callSystem actually runs things, which is not guaranteed in every AE build
        try { system.callSystem('cmd /c echo ok>"' + CFG.bridgeWin + '\\callproof.txt"'); } catch (e) {}
        var t0 = new Date().getTime();
        try { system.callSystem(lastCmd); } catch (e) { log("CALLSYSTEM THREW " + e.toString()); }
        // If this ever logs minutes again, the pipe redirection has been lost and AE
        // is about to freeze for the whole download.
        log("CALLSYSTEM RETURNED in " + (new Date().getTime() - t0) + "ms");
    }

    function launchUpdate() {
        if (busy) return;
        if (!CFG.configured || !(new File(CFG.exe)).exists) { setStatus("run scripts/install.ps1 first", "err"); return; }
        busy = true;
        JOB = "u" + new Date().getTime();
        dropBtn.enabled = false;
        updateBtn.enabled = false;
        aggressiveCleanup();
        dropCoreLog();
        lastCmd = updateCommand();
        log("LAUNCH UPDATE cmd=" + lastCmd);

        startWatch(function (result) {
            if (result.error) {
                setStatus("update error: " + result.error, "err");
            } else {
                setStatus("engine updated", "ok");
            }
            unlock();
        }, "update");
        setStatus("updating yt-dlp...", "text");

        try { system.callSystem('cmd /c echo ok>"' + CFG.bridgeWin + '\\callproof.txt"'); } catch (e) {}
        var t0 = new Date().getTime();
        try { system.callSystem(lastCmd); } catch (e) { log("CALLSYSTEM THREW " + e.toString()); }
        log("CALLSYSTEM RETURNED in " + (new Date().getTime() - t0) + "ms");
    }

    dropBtn.onClick = function () {
        try { launch(); } catch (e) {
            setStatus("handler error: " + e.toString(), "err");
            setDebug("line " + e.line + " -> " + e.toString(), "err");
            log("HANDLER EXCEPTION line " + e.line + " " + e.toString());
            aggressiveCleanup();
            unlock();
        }
    };
    updateBtn.onClick = function () {
        try { launchUpdate(); } catch (e) {
            setStatus("handler error: " + e.toString(), "err");
            setDebug("line " + e.line + " -> " + e.toString(), "err");
            log("UPDATE HANDLER EXCEPTION " + e.toString());
            aggressiveCleanup();
            unlock();
        }
    };

    // Every ExtendScript entry point in After Effects shares one global namespace, so
    // this hook lets an automated check (or the MCP bridge) drive the very same
    // pipeline the button drives - it is the only way to test the click path without
    // a human, and the button still goes through launch() itself.
    function fillFields(url, inPoint, outPoint, audioOnly) {
        urlInput.text = url || "";
        inInput.text = inPoint || "";
        outInput.text = outPoint || "";
        audioCheck.value = audioOnly ? true : false;
    }

    $.global.__dropline = {
        version: PANEL_VERSION,
        drop: function (url, inPoint, outPoint, audioOnly) {
            try {
                fillFields(url, inPoint, outPoint, audioOnly);
                launch();
                return { started: true, busy: busy, job: JOB };
            } catch (e) {
                log("HOOK EXCEPTION line " + e.line + " " + e.toString());
                unlock();
                return { started: false, error: e.toString() };
            }
        },
        // Same thing, but through the button's own event handler.
        click: function (url, inPoint, outPoint, audioOnly) {
            fillFields(url, inPoint, outPoint, audioOnly);
            var how = "notify";
            try {
                if (dropBtn.notify) dropBtn.notify("onClick");
                else { how = "handler"; dropBtn.onClick(); }
            } catch (e) {
                log("CLICK EXCEPTION line " + e.line + " " + e.toString());
                unlock();
                return { clicked: false, error: e.toString() };
            }
            return { clicked: true, how: how, busy: busy, job: JOB };
        },
        state: function () {
            return {
                version: PANEL_VERSION,
                busy: busy,
                job: JOB,
                status: statusText.text,
                progress: progressText.text,
                debug: dbg.text
            };
        },
        // Same path the "update engine" button takes.
        update: function () {
            try { launchUpdate(); return { started: true, busy: busy, job: JOB }; }
            catch (e) { log("UPDATE HOOK EXCEPTION " + e.toString()); unlock(); return { started: false, error: e.toString() }; }
        }
    };

    setDebug((CFG.configured ? "core OK" : "run install.ps1") + " ?? v" + PANEL_VERSION, "muted");
    log("PANEL LOADED v" + PANEL_VERSION);

    if (pal instanceof Window) {
        pal.center();
        pal.show();
    } else {
        pal.layout.layout(true);
    }
})(this);
