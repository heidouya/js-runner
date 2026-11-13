// console.js —— 控制台输出区
(function () {
  "use strict";

  var JR = (window.JR = window.JR || {});
  var consoleBox = null;

  JR.initConsole = function () {
    consoleBox = document.getElementById("console");
    var clearBtn = document.getElementById("clearBtn");
    clearBtn.onclick = JR.clearConsole;
  };

  // 追加一行输出，并滚到底部
  JR.log = function (text) {
    if (!consoleBox) return;
    consoleBox.textContent += text + "\n";
    consoleBox.scrollTop = consoleBox.scrollHeight;
  };

  JR.clearConsole = function () {
    if (consoleBox) consoleBox.textContent = "";
  };
})();
