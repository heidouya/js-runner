// settings.js —— 设置弹窗、主题、字号、自动运行、导入导出、清空确认、运行按钮
(function () {
  "use strict";

  var JR = (window.JR = window.JR || {});

  JR.initSettings = function () {
    var settingsBtn = document.getElementById("settingsBtn");
    var settingsMask = document.getElementById("settingsMask");
    var closeSettingsBtn = document.getElementById("closeSettings");
    var themeDesc = document.getElementById("themeDesc");

    JR.state.isDark = !(localStorage.getItem(JR.THEME_KEY) === "default");
    if (!JR.state.isDark) {
      document.body.classList.add("light-mode");
    }

    function updateThemeDesc() {
      themeDesc.textContent = "当前：" + (JR.state.isDark ? "暗黑" : "浅色");
    }
    function openSettings() {
      updateThemeDesc();
      settingsMask.classList.add("show");
    }
    function closeSettings() {
      settingsMask.classList.remove("show");
    }
    settingsBtn.onclick = openSettings;
    closeSettingsBtn.onclick = closeSettings;
    settingsMask.onclick = function (e) {
      if (e.target === settingsMask) closeSettings();
    };
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && settingsMask.classList.contains("show")) {
        closeSettings();
      }
    });
    updateThemeDesc();

    // ===== 字体大小设置 =====
    var editorFontValueEl = document.getElementById("editorFontValue");
    var consoleFontValueEl = document.getElementById("consoleFontValue");
    var editorFontMinusBtn = document.getElementById("editorFontMinus");
    var editorFontPlusBtn = document.getElementById("editorFontPlus");
    var consoleFontMinusBtn = document.getElementById("consoleFontMinus");
    var consoleFontPlusBtn = document.getElementById("consoleFontPlus");

    function readFont(key, conf) {
      var raw = parseInt(localStorage.getItem(key), 10);
      if (Number.isNaN(raw)) return conf.def;
      return Math.min(conf.max, Math.max(conf.min, raw));
    }

    var editorFontSize = readFont(JR.EDITOR_FONT_KEY, JR.FONT_RANGE.editor);
    var consoleFontSize = readFont(JR.CONSOLE_FONT_KEY, JR.FONT_RANGE.console);

    function applyFontSizes() {
      document.documentElement.style.setProperty("--editor-font-size", editorFontSize + "px");
      document.documentElement.style.setProperty("--console-font-size", consoleFontSize + "px");
      editorFontValueEl.textContent = editorFontSize + "px";
      consoleFontValueEl.textContent = consoleFontSize + "px";
      // 字号变化后重算 CodeMirror 的行高与渲染尺寸
      if (JR.state.editor) JR.state.editor.refresh();
    }

    function stepFont(target, delta) {
      var conf = JR.FONT_RANGE[target];
      var current = target === "editor" ? editorFontSize : consoleFontSize;
      var next = Math.min(conf.max, Math.max(conf.min, current + delta));
      if (next === current) return;
      if (target === "editor") {
        editorFontSize = next;
        localStorage.setItem(JR.EDITOR_FONT_KEY, String(next));
      } else {
        consoleFontSize = next;
        localStorage.setItem(JR.CONSOLE_FONT_KEY, String(next));
      }
      applyFontSizes();
    }

    editorFontMinusBtn.onclick = function () {
      stepFont("editor", -1);
    };
    editorFontPlusBtn.onclick = function () {
      stepFont("editor", 1);
    };
    consoleFontMinusBtn.onclick = function () {
      stepFont("console", -1);
    };
    consoleFontPlusBtn.onclick = function () {
      stepFont("console", 1);
    };

    applyFontSizes();

    // ===== 自动运行开关 =====
    var autoRunToggle = document.getElementById("autoRunToggle");
    JR.state.autoRun = localStorage.getItem(JR.AUTORUN_KEY) !== "off";
    autoRunToggle.checked = JR.state.autoRun;

    autoRunToggle.onchange = function () {
      JR.state.autoRun = autoRunToggle.checked;
      localStorage.setItem(JR.AUTORUN_KEY, JR.state.autoRun ? "on" : "off");
      if (!JR.state.autoRun) clearTimeout(JR.state.runTimer);
    };

    // ===== 主题切换 =====
    var toggleThemeBtn = document.getElementById("toggleTheme");
    toggleThemeBtn.onclick = function () {
      JR.state.isDark = !JR.state.isDark;
      if (JR.state.isDark) {
        JR.state.editor.setOption("theme", "monokai");
        document.body.classList.remove("light-mode");
        localStorage.setItem(JR.THEME_KEY, "monokai");
      } else {
        JR.state.editor.setOption("theme", "default");
        document.body.classList.add("light-mode");
        localStorage.setItem(JR.THEME_KEY, "default");
      }
      updateThemeDesc();
    };

    // ===== 导入 / 保存 JS 文件 =====
    var importJsBtn = document.getElementById("importJs");
    var saveJsBtn = document.getElementById("saveJs");
    var fileInput = document.getElementById("fileInput");

    importJsBtn.onclick = function () {
      fileInput.click();
    };
    fileInput.onchange = function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (evt) {
        JR.state.editor.setValue(evt.target.result);
        fileInput.value = "";
        closeSettings();
      };
      reader.readAsText(file);
    };

    saveJsBtn.onclick = function () {
      var code = JR.state.editor.getValue();
      var blob = new Blob([code], { type: "text/plain" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = JR.buildFileName();
      a.click();
      URL.revokeObjectURL(url);
      closeSettings();
    };

    // ===== 清空确认弹窗 =====
    var clearEditorBtn = document.getElementById("clearEditor");
    var confirmMask = document.getElementById("confirmMask");
    var closeConfirmBtn = document.getElementById("closeConfirm");
    var confirmCancelBtn = document.getElementById("confirmCancel");
    var confirmClearBtn = document.getElementById("confirmClear");

    function openConfirm() {
      confirmMask.classList.add("show");
      // 默认聚焦「取消」，避免误按回车直接清空
      confirmCancelBtn.focus();
    }
    function closeConfirm() {
      confirmMask.classList.remove("show");
      clearEditorBtn.focus();
    }

    clearEditorBtn.onclick = openConfirm;
    closeConfirmBtn.onclick = closeConfirm;
    confirmCancelBtn.onclick = closeConfirm;
    confirmMask.onclick = function (e) {
      if (e.target === confirmMask) closeConfirm();
    };
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && confirmMask.classList.contains("show")) {
        closeConfirm();
      }
    });

    confirmClearBtn.onclick = function () {
      JR.state.editor.setValue("");
      JR.clearConsole();
      closeConfirm();
    };

    // ===== 运行按钮 =====
    var runBtn = document.getElementById("runBtn");
    runBtn.onclick = function () {
      clearTimeout(JR.state.runTimer);
      JR.run();
    };
  };
})();
