// core.js —— 常量、全局状态、通用工具
// 所有模块共用 window.JR 这一个命名空间，按 index.html 里的加载顺序初始化
(function () {
  "use strict";

  var JR = (window.JR = window.JR || {});

  // localStorage 键名
  JR.STORAGE_KEY = "js_runner_code";
  JR.THEME_KEY = "js_runner_theme";
  JR.AUTORUN_KEY = "js_runner_autorun";
  JR.EDITOR_FONT_KEY = "js_runner_editor_font";
  JR.CONSOLE_FONT_KEY = "js_runner_console_font";
  JR.LOOP_GUARD_KEY = "js_runner_loop_guard";

  // 死循环保护：同一行循环累计执行超过 1 秒，判定为死循环并指出行号
  JR.LOOP_GUARD_MS = 1000;
  // 关闭保护时，执行超过 5 秒只在控制台提示，不终止
  JR.SLOW_WARN_MS = 5000;

  // 字号区间与默认值
  JR.FONT_RANGE = {
    editor: { min: 12, max: 48, def: 25 },
    console: { min: 10, max: 28, def: 14 }
  };

  JR.defaultCode = `console.log("编辑器默认自动运行代码，可以在设置页面进行修改~");
`;

  // 跨模块共享的运行状态
  JR.state = {
    editor: null,     // CodeMirror 实例，由 editor.js 创建后赋值
    isDark: true,     // 当前是否深色主题
    autoRun: true,    // 是否自动运行
    runTimer: null,   // 自动运行的防抖定时器
    worker: null,     // 当前执行代码的 Worker
    slowTimer: null,  // 关闭死循环保护时，用来提示「执行太久」的计时器
    loopGuard: false  // 死循环保护开关，默认关闭
  };

  // 保存文件名：年-月-日-时-分-秒.js，例如 2026-11-11-00-15-30.js
  JR.buildFileName = function () {
    var d = new Date();
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    var date = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join("-");
    var time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join("-");
    return date + "-" + time + ".js";
  };
})();
