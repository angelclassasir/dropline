// Dropline v7 - beauty pass: green step completion, cards, Segoe UI/Consolas
// ES3 polyfill: ExtendScript has no String.trim (ES5)
if (!String.prototype.trim) {
    String.prototype.trim = function () { return String(this).replace(/^\s+/, "").replace(/\s+$/, ""); };
}

(function (thisObj) {
    var CFG = {
        exe: "C:\\Users\\angel\\.proyectos-photoshop\\dropline\\bin\\dropline-core.exe",
        bridge: "C:/Users/angel/DroplineDownloads"
    };

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

    // Pen cache: pens created ONCE per control (no GDI leak)
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

    // ============ HEADER ============
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

    // ============ INPUT CARD ============
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

    // ============ STEPS (equal columns, light up green on completion) ============
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

    // ============ CONSOLE CARD (progress + status) ============
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

    // ============ FOOTER (single clean tech line) ============
    var dbg = pal.add("statictext", undefined, "dropline v0.7");
    paint(dbg, "muted", "8px Consolas");
    function setDebug(msg, color) {
        dbg.text = msg;
        paint(dbg, color || "muted", "8px Consolas");
    }

    // ============ BUTTONS ============
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

    function clearBridge() {
        try {
            var old = new File(CFG.bridge + "/status.json");
            if (old.exists) old.remove();
            var proof = new File(CFG.bridge + "/callproof.txt");
            if (proof.exists) proof.remove();
        } catch (e) {}
    }

    function cmdSafe(s) { return String(s).replace(/([&|<>^])/g, "^$1"); }

    // ZERO double quotes: callSystem quote-wrapping mutilates quoted payloads
    function buildCmd(argArray) {
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
                        setStatus("callSystem executes nothing here", "err");
                        setDebug("debug: callSystem dead in this AE build", "err");
                        unlock();
                        return;
                    }
                }
                if (now - startTime > 15000) {
                    w.close();
                    setStatus("core did not start - see footer", "err");
                    setDebug("cmd -> " + lastCmd, "err");
                    unlock();
                    return;
                }
                t.text = "starting core...";
                w.update();
                continue;
            }

            var txt = "";
            f.open("r"); txt = f.read(); f.close();
            var data = null;
            try { data = eval("(" + txt + ")"); } catch (e) { data = null; }
            if (!data || !data.state) { w.update(); continue; }

            if (data.state === "starting" || data.state === "downloading") {
                var pct = Math.floor(data.percent || 0);
                bar.text = blocks(pct) + "  " + pct + "%";
                progressText.text = bar.text;
                paint(progressText, "accent", "12px Consolas");
                t.text = "01 FETCH - downloading " + pct + "%";
                paintStep(s1, "accent");
            } else if (data.state === "encoding") {
                bar.text = blocks(100) + "  merge";
                progressText.text = bar.text;
                paint(progressText, "accent", "12px Consolas");
                t.text = "02 ENCODE - ffmpeg merging...";
                paintStep(s1, "ok");
                paintStep(s2, "accent");
            } else if (data.state === "updating") {
                t.text = "updating yt-dlp engine...";
            } else if (data.state === "done") {
                bar.text = blocks(100) + "  100%";
                progressText.text = bar.text;
                paint(progressText, "ok", "12px Consolas");
                paintStep(s1, "ok");
                paintStep(s2, "ok");
                paintStep(s3, "accent");
                t.text = "03 TIMELINE - importing...";
                w.update();
                if (updating) {
                    setStatus("engine updated: " + (data.message || "ok"), "ok");
                } else if (data.file) {
                    autoImport(data.file);
                } else {
                    setStatus("done but no file reported", "err");
                }
                try { f.remove(); } catch (e) {}
                $.sleep(700);
                w.close();
                unlock();
                return;
            } else if (data.state === "error") {
                t.text = "ERROR";
                bar.text = String(data.message || "unknown").slice(0, 60);
                w.update();
                $.sleep(4000);
                w.close();
                setStatus("error: " + (data.message || "unknown"), "err");
                setDebug("cmd -> " + lastCmd, "err");
                resetSteps();
                try { f.remove(); } catch (e) {}
                unlock();
                return;
            }

            if (now - startTime > 600000) {
                w.close();
                setStatus("timeout after 10 min", "err");
                unlock();
                return;
            }
            w.update();
        }
    }

    function autoImport(filePath) {
        var videoFile = new File(filePath);
        if (!videoFile.exists) { setStatus("file not found: " + filePath, "err"); return; }
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) {
            setStatus("select a composition first", "err");
            paintStep(s3, "err");
            return;
        }
        try {
            var item = app.project.importFile(new ImportOptions(videoFile));
            var layer = comp.layers.add(item);
            layer.startTime = comp.time;
            setStatus("imported: " + videoFile.displayName, "ok");
            paintStep(s3, "ok");
        } catch (e) {
            setStatus("import failed: " + e.toString(), "err");
            paintStep(s3, "err");
        }
    }

    function launch() {
        if (busy) return;
        var url = urlInput.text.trim();
        url = url.replace(/"/g, "");
        if (!url) { setStatus("paste a URL first", "err"); return; }
        if (!(new File(CFG.exe)).exists) { setStatus("core exe missing!", "err"); setDebug("debug: exe NOT found", "err"); return; }

        busy = true;
        dropBtn.enabled = false;
        updateBtn.enabled = false;
        resetSteps();
        paintStep(s1, "accent");
        progressText.text = blocks(0) + "  0%";
        paint(progressText, "accent", "12px Consolas");
        clearBridge();

        var argArray = ["cli", "--url", url];
        var a = inInput.text.trim();
        var b = outInput.text.trim();
        if (a && b) { argArray.push("--start"); argArray.push(a); argArray.push("--end"); argArray.push(b); }
        lastCmd = buildCmd(argArray);
        setDebug("launching core...", "muted");

        // Probe: does callSystem execute anything at all inside this AE?
        try {
            system.callSystem('cmd /c echo ok> ' + CFG.bridge.replace(/\//g, "\\") + '\\callproof.txt');
        } catch (e) {}
        system.callSystem(lastCmd);
        setStatus("working...", "text");
        runModal();
    }

    function launchUpdate() {
        if (busy) return;
        if (!(new File(CFG.exe)).exists) { setStatus("core exe missing!", "err"); return; }
        busy = true;
        updating = true;
        dropBtn.enabled = false;
        updateBtn.enabled = false;
        clearBridge();
        lastCmd = buildCmd(["update"]);
        system.callSystem(lastCmd);
        runModal();
    }

    // Exceptions are ALWAYS visible, with line number
    dropBtn.onClick = function () {
        try { launch(); } catch (e) {
            setStatus("handler error: " + e.toString(), "err");
            setDebug("line " + e.line + " -> " + e.toString(), "err");
            unlock();
        }
    };
    updateBtn.onClick = function () {
        try { launchUpdate(); } catch (e) {
            setStatus("handler error: " + e.toString(), "err");
            setDebug("line " + e.line + " -> " + e.toString(), "err");
            unlock();
        }
    };

    setDebug("core " + ((new File(CFG.exe)).exists ? "OK" : "MISSING") + " · dropline v0.7", "muted");

    if (pal instanceof Window) {
        pal.center();
        pal.show();
    } else {
        pal.layout.layout(true);
    }
})(this);