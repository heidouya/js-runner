// editor.js —— CodeMirror 初始化、首次进入的光标与聚焦、内容持久化
(function () {
  "use strict";

  var JR = (window.JR = window.JR || {});

  JR.initEditor = function () {
    var savedCode = localStorage.getItem(JR.STORAGE_KEY);
    var savedTheme = localStorage.getItem(JR.THEME_KEY);

    var editor = CodeMirror(document.getElementById("cm-editor"), {
      value: savedCode ?? JR.defaultCode,
      mode: "javascript",
      theme: savedTheme ?? "monokai",
      lineWrapping: true,
      lineNumbers: true,
      tabSize: 2,
      indentWithTabs: false,
      autoCloseBrackets: true,
      hintOptions: {
        completeSingle: false
      },
      extraKeys: {
        "Ctrl-Space": "autocomplete",
        "Ctrl-/": "toggleComment",
        "Cmd-/": "toggleComment",
        "Tab": function (cm) {
          if (cm.somethingSelected()) {
            cm.indentSelection("add");
          } else {
            cm.replaceSelection("  ", "end");
          }
        },
        "Shift-Tab": function (cm) {
          cm.indentSelection("subtract");
        }
      }
    });
    JR.state.editor = editor;

    // 首次进入（本地没有保存过代码）时默认内容为 defaultCode，
    // 让光标落在第二行并聚焦编辑器；若页面在后台标签打开，浏览器会忽略脚本聚焦，
    // 等窗口首次获得焦点后再聚焦一次
    var isFirstVisit = savedCode === null;

    if (isFirstVisit) {
      editor.setCursor({ line: 1, ch: 0 });
    }

    if (isFirstVisit || savedCode === "") {
      var focusEditor = function () {
        editor.focus();
        if (isFirstVisit) editor.setCursor({ line: 1, ch: 0 });
      };
      if (document.hasFocus()) {
        focusEditor();
      } else {
        window.addEventListener("focus", focusEditor, { once: true });
      }
    }

    // 编辑内容随时落盘，并按设置决定是否自动运行
    editor.on("change", function () {
      localStorage.setItem(JR.STORAGE_KEY, editor.getValue());
      JR.debounceRun();
    });
  };
})();
