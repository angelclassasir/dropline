// Dropline v1.5 - flight recorder log + stall breaker + no blind ffmpeg kill
if (!String.prototype.trim) {
    String.prototype.trim = function () { return String(this).replace(/^\s+/, "").replace(/\s+$/, ""); };
}

(function (thisObj) {
    var HOME = Folder.userData.parent.parent.fsName;

    var CFG = (function () {
        var exe = "";
        var bridge = HOME + "/DroplineDownloads";
        var cfgFile = new File(HOME + "/.dropline/config.json");
        if (cfgFile.exists) {
            try {
                cfgFile.open("r");
                var data = eval("(" + cfgFile.read() + ")");
                cfgFile.close();
                if (data.coreExe) exe = String(data.coreExe).replace(/\\/g, "/");
                if (data.bridge) bridge = String(data.bridge).replace(/\\/g, "/");
            } catch (e) {}
        }
        return { exe: exe, bridge: bridge, configured: exe !== "" };
    })();

    // ===== FLIGHT RECORDER: every phase gets logged =====
    function log(msg) {
        try {
            var dir = new Folder(HOME + "/.dropline");
            if (!dir.exists) dir.create();
            var f = new File(HOME + "/.dropline/dropline.log");
            f.open("a");
            f.writeln(new Date().toString() + " | " + msg);
            f.close();
        } catch (e) {}
    }

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
    var progressText = consoleCard.add("statictext", undefined, "░░░░░░░░░░░░  0%");
    paint(progressText, "accent", "12px Consolas");
    var statusText = consoleCard.add("statictext", undefined, "ready to drop");
    paint(statusText, "text", "10px Segoe UI");
    function setStatus(msg, color) {
        statusText.text = msg;
        paint(statusText, color || "text", "10px Segoe UI");
    }

    var dbg = pal.add("statictext", undefined, "dropline v1.0");
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
    var updating = false;
    var lastCmd = "";

    function blocks(pct) {
        var filled = Math.round(pct / 100 * 12);
        var out = "";
        for (var i = 0; i < 12; i++) out += (i < filled) ? "█" : "░";
        return out;
    }

    // Cleanup WITHOUT blind ffmpeg kill (that could leave half-locked files)
    function aggressiveCleanup() {
        try {
            system.callSystem('cmd /c taskkill /im dropline-core.exe /f >nul 2>&1');
            system.callSystem('cmd /c taskkill /im yt-dlp.exe /f >nul 2>&1');
        } catch (e) {}
        $.sleep(400);
        try {
            var statusFile = new File(CFG.bridge + "/status.json");
            if (statusFile.exists) statusFile.remove();
            var proofFile = new File(CFG.bridge + "/callproof.txt");
            if (proofFile.exists) proofFile.remove();
            // Clean up old .part files to avoid confusion
            var bridgeFolder = new Folder(CFG.bridge);
            if (bridgeFolder.exists) {
                var partFiles = bridgeFolder.getFiles("*.part");
                for (var i = 0; i < partFiles.length; i++) {
                    try { partFiles[i].remove(); } catch (e) {}
                }
            }
        } catch (e) {}
    }


    function cmdSafe(s) { return String(s).replace(/([&|<>^])/g, "^$1"); }

    function buildCmd(argArray) {
        // start is a cmd builtin: the cmd /c wrapper is mandatory
        var line = 'cmd /c start /min ' + CFG.exe;
        for (var i = 0; i < argArray.length; i++) {
            line += ' ' + cmdSafe(argArray[i]);
        }
        return line;
    }

    function unlock() {
        busy = false;
        updating = false;
        dropBtn.enabled = true;
        updateBtn.enabled = true;
    }

    function runModal() {
        var w = new Window("palette", "Dropline working", undefined, { resizeable: false });
        w.orientation = "column";
        w.alignChildren = ["fill", "center"];
        w.margins = 24;
        w.spacing = 12;
        var t = w.add("statictext", undefined, "starting core...");
        t.graphics.font = "bold 12px Segoe UI";
        var bar = w.add("statictext", undefined, blocks(0) + "  0%");
        bar.graphics.font = "14px Consolas";
        w.show();
        w.update();

        var startTime = new Date().getTime();
        var proofChecked = false;
        var lastPct = -1;
        var lastMove = startTime;
        while (true) {
            $.sleep(500);
            var now = new Date().getTime();
            var f = new File(CFG.bridge + "/status.json");

            if (!f.exists) {
                if (now - startTime > 6000 && !proofChecked) {
                    proofChecked = true;
                    var proof = new File(CFG.bridge + "/callproof.txt");
                    if (!proof.exists) {
                        w.close();
                        $.sleep(300);
                        log("FAIL: callSystem dead (no proof file)");
                        aggressiveCleanup();
                        return { error: "callSystem executes nothing here" };
                    }
                }
                if (now - startTime > 15000) {
                    w.close();
                    $.sleep(300);
                    log("FAIL: core did not start within 15s");
                    aggressiveCleanup();
                    return { error: "core did not start - see footer", cmd: lastCmd };
                }
                t.text = "starting core...";
                w.update();
                continue;
            }

            var txt = "";
            var data = null;
            var retries = 0;
            while (retries < 3) {
                try {
                    f.open("r");
                    txt = f.read();
                    f.close();
                    data = eval("(" + txt + ")");
                    if (data && data.state) break;  // Success
                } catch (e) {
                    try { f.close(); } catch (e2) {}
                    retries++;
                    if (retries < 3) $.sleep(300);  // Wait before retry
                }
            }
            if (!data || !data.state) { w.update(); continue; }

            if (data.state === "starting" || data.state === "downloading") {
                var pct = Math.floor(data.percent || 0);
                // STALL BREAKER: no progress for 3 min -> clean error instead of infinite hang
                if (pct !== lastPct) {
                    lastPct = pct;
                    lastMove = now;
                } else if (now - lastMove > 180000) {
                    w.close();
                    $.sleep(300);
                    log("STALL: stuck at " + pct + "% for 180s");
                    aggressiveCleanup();
                    return { error: "download stalled at " + pct + "% (log saved)" };
                }
                log("tick " + data.state + " " + pct + "%");
                bar.text = blocks(pct) + "  " + pct + "%";
                progressText.text = bar.text;
                paint(progressText, "accent", "12px Consolas");
                t.text = "01 FETCH - downloading " + pct + "%";
                paintStep(s1, "accent");
            } else if (data.state === "encoding") {
                log("tick encoding");
                bar.text = blocks(100) + "  merge";
                progressText.text = bar.text;
                paint(progressText, "accent", "12px Consolas");
                t.text = "02 ENCODE - ffmpeg merging...";
                paintStep(s1, "ok");
                paintStep(s2, "accent");
            } else if (data.state === "updating") {
                t.text = "updating yt-dlp engine...";
            } else if (data.state === "done") {
                log("DONE file=" + (data.file || "none"));
                bar.text = blocks(100) + "  100%";
                progressText.text = bar.text;
                paint(progressText, "ok", "12px Consolas");
                paintStep(s1, "ok");
                paintStep(s2, "ok");
                paintStep(s3, "accent");
                t.text = "03 TIMELINE - importing...";
                w.update();
                var result = { file: data.file || null };
                try { f.remove(); } catch (e) {}
                w.close();
                $.sleep(400);
                aggressiveCleanup();
                return result;
            } else if (data.state === "error") {
                log("CORE ERROR: " + (data.message || "unknown"));
                t.text = "ERROR";
                bar.text = String(data.message || "unknown").slice(0, 60);
                w.update();
                $.sleep(3000);
                var errorMsg = data.message || "unknown";
                try { f.remove(); } catch (e) {}
                w.close();
                $.sleep(400);
                aggressiveCleanup();
                return { error: errorMsg };
            }

            if (now - startTime > 600000) {
                w.close();
                $.sleep(400);
                log("TIMEOUT 10min");
                aggressiveCleanup();
                return { error: "timeout after 10 min" };
            }
            w.update();
        }
    }

    function autoImport(filePath) {
        var videoFile = new File(filePath);
        if (!videoFile.exists) { setStatus("file not found: " + filePath, "err"); log("IMPORT FAIL: missing " + filePath); return; }
        var prev = -1;
        for (var k = 0; k < 10; k++) {
            var cur = videoFile.length;
            if (cur > 0 && cur === prev) break;
            prev = cur;
            $.sleep(400);
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
        var url = urlInput.text.trim();
        url = url.replace(/"/g, "");
        if (!url) { setStatus("paste a URL first", "err"); return; }
        if (!CFG.configured || !(new File(CFG.exe)).exists) { setStatus("run scripts/install.ps1 first", "err"); setDebug("config missing: ~/.dropline/config.json", "err"); return; }

        busy = true;
        dropBtn.enabled = false;
        updateBtn.enabled = false;
        resetSteps();
        paintStep(s1, "accent");
        progressText.text = blocks(0) + "  0%";
        paint(progressText, "accent", "12px Consolas");
        aggressiveCleanup();

        var argArray = ["cli", "--url", url];
        var a = inInput.text.trim();
        var b = outInput.text.trim();
        if (a && b) { argArray.push("--start"); argArray.push(a); argArray.push("--end"); argArray.push(b); }
        if (audioCheck.value) { argArray.push("--audio-only"); }
        lastCmd = buildCmd(argArray);
        setDebug("launching core...", "muted");
        log("LAUNCH trim=" + (a && b ? a + "-" + b : "no") + " cmd=" + lastCmd);

        try {
            system.callSystem('cmd /c echo ok> ' + CFG.bridge.replace(/\//g, "\\") + '\\callproof.txt');
        } catch (e) {}
        system.callSystem(lastCmd);
        setStatus("working...", "text");

        var result = runModal();
        log("MODAL RETURNED error=" + (result.error || "none") + " file=" + (result.file || "none"));

        if (result.error) {
            setStatus("error: " + result.error, "err");
            if (result.cmd) setDebug("cmd -> " + result.cmd, "err");
            resetSteps();
        } else if (result.file) {
            if (updating) {
                setStatus("engine updated", "ok");
            } else {
                autoImport(result.file);
            }
        }
        unlock();
    }

    function launchUpdate() {
        if (busy) return;
        if (!CFG.configured || !(new File(CFG.exe)).exists) { setStatus("run scripts/install.ps1 first", "err"); return; }
        busy = true;
        updating = true;
        dropBtn.enabled = false;
        updateBtn.enabled = false;
        aggressiveCleanup();
        lastCmd = buildCmd(["update"]);
        log("LAUNCH UPDATE");
        system.callSystem(lastCmd);
        var result = runModal();
        if (result.error) {
            setStatus("update error: " + result.error, "err");
        } else {
            setStatus("engine updated", "ok");
        }
        unlock();
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

    setDebug((CFG.configured ? "core OK" : "run install.ps1") + " · dropline v1.0", "muted");
    log("PANEL LOADED v1.5");

    if (pal instanceof Window) {
        pal.center();
        pal.show();
    } else {
        pal.layout.layout(true);
    }
})(this);