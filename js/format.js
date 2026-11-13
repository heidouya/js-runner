// format.js —— Prettier 加载与「格式化」按钮
(function () {
  "use strict";

  var JR = (window.JR = window.JR || {});

  // Prettier 三个模块约 1.5MB，不放在静态 import 里：静态 import 一旦加载失败，
  // 整个脚本都不会执行，编辑器也就起不来（断网时实测如此）。
  // 改成后台空闲时预加载，失败只影响「格式化」这一个功能。
  var prettierBundle = null;
  var prettierLoading = null;

  function loadPrettier() {
    if (prettierBundle) return Promise.resolve(prettierBundle);
    if (!prettierLoading) {
      prettierLoading = Promise.all([
        import("https://unpkg.com/prettier@3.3.2/standalone.mjs"),
        import("https://unpkg.com/prettier@3.3.2/plugins/babel.mjs"),
        import("https://unpkg.com/prettier@3.3.2/plugins/estree.mjs")
      ]).then(function (mods) {
        prettierBundle = { prettier: mods[0], babel: mods[1], estree: mods[2] };
        return prettierBundle;
      });
    }
    return prettierLoading;
  }

  function preloadPrettier() {
    loadPrettier().catch(function () {
      prettierLoading = null; // 失败后清空，点「格式化」时再试一次
    });
  }

  JR.initFormat = function () {
    var formatCodeBtn = document.getElementById("formatCode");

    formatCodeBtn.onclick = async function () {
      var btnText = formatCodeBtn.textContent;
      formatCodeBtn.disabled = true;
      formatCodeBtn.textContent = "格式化中…";
      try {
        var raw = JR.state.editor.getValue();
        var bundle = await loadPrettier();
        var formatted = await bundle.prettier.format(raw, {
          parser: "babel",
          plugins: [bundle.babel, bundle.estree],
          tabWidth: 2,
          semi: true,
          singleQuote: false
        });
        // setValue 会把滚动位置和光标重置到开头，先记下来再还原
        var scrollInfo = JR.state.editor.getScrollInfo();
        var cursorPos = JR.state.editor.getCursor();
        JR.state.editor.setValue(formatted);
        JR.state.editor.setCursor({
          line: Math.min(cursorPos.line, JR.state.editor.lastLine()),
          ch: cursorPos.ch
        });
        JR.state.editor.scrollTo(scrollInfo.left, scrollInfo.top);
      } catch (err) {
        if (prettierBundle) {
          JR.log("[格式化失败] 语法错误：" + err.message);
        } else {
          JR.log("[格式化失败] 需要联网加载 Prettier，当前加载失败：" + err.message);
          prettierLoading = null; // 下次点击重新尝试
        }
      } finally {
        formatCodeBtn.disabled = false;
        formatCodeBtn.textContent = btnText;
      }
    };

    // 首屏不阻塞，空闲时后台预加载
    if (window.requestIdleCallback) {
      window.requestIdleCallback(preloadPrettier, { timeout: 3000 });
    } else {
      setTimeout(preloadPrettier, 800);
    }
  };
})();
