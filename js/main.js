// main.js —— 按依赖顺序初始化各模块
// 加载顺序见 index.html：core → console → runner → editor → hint → settings → format → main
(function () {
  "use strict";

  var JR = window.JR;

  JR.initConsole();
  JR.initEditor();
  JR.initHint();
  JR.initSettings();
  JR.initFormat();

  // 打开页面先跑一次，让默认示例的输出立刻可见
  JR.run();
})();
