// runner.js —— 把代码放进沙箱 iframe 运行，收集 console 输出
(function () {
  "use strict";

  var JR = (window.JR = window.JR || {});

  // 代码发生变化后的自动运行（350ms 防抖）
  JR.debounceRun = function () {
    clearTimeout(JR.state.runTimer);
    if (!JR.state.autoRun) return;
    JR.state.runTimer = setTimeout(JR.run, 350);
  };

  JR.run = function () {
    var editor = JR.state.editor;
    if (!editor) return;
    if (JR.state.iframe) JR.state.iframe.remove();

    var iframe = document.createElement("iframe");
    iframe.sandbox = "allow-scripts";
    iframe.style.display = "none";
    document.body.appendChild(iframe);
    JR.state.iframe = iframe;

    var code = editor.getValue();
    var html = `
<!DOCTYPE html>
<html>
<body>
<script>
const oldLog = console.log;
// 把参数转成可读文本：数组/普通对象展开成 [1, 2] / {a: 1}，而不是被 join 成 1,2
function fmt(v, depth, seen) {
  depth = depth || 0;
  seen = seen || new Set();
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  const t = typeof v;
  if (t === "string") return depth ? JSON.stringify(v) : v;
  if (t === "number" || t === "boolean" || t === "bigint") return String(v);
  if (t === "symbol") return v.toString();
  if (t === "function") return "[Function: " + (v.name || "anonymous") + "]";
  if (t !== "object") return String(v);
  if (seen.has(v)) return "[Circular]";
  if (depth >= 4) return Array.isArray(v) ? "[Array]" : "[Object]";
  try {
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      seen.add(v);
      const out = "[" + v.map(function (item) { return fmt(item, depth + 1, seen); }).join(", ") + "]";
      seen.delete(v);
      return out;
    }
    if (v instanceof Date) return v.toString();
    if (v instanceof Error) return v.name + ": " + v.message;
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return String(v);
    const keys = Object.keys(v);
    if (!keys.length) return "{}";
    seen.add(v);
    const out = "{" + keys.map(function (k) { return k + ": " + fmt(v[k], depth + 1, seen); }).join(", ") + "}";
    seen.delete(v);
    return out;
  } catch (e) {
    return String(v);
  }
}
console.log = function(...args) {
  const parts = [];
  for (let i = 0; i < args.length; i++) parts.push(fmt(args[i], 0, null));
  window.parent.postMessage({type:'log', data:parts.join(' ')}, '*');
  oldLog.apply(console, args);
};
window.onerror = function(msg,url,line,col,err){
  window.parent.postMessage({type:'error', data:msg + ' 行号:'+line}, '*');
}
${code}
<\/script>
</body>
</html>
    `;
    iframe.srcdoc = html;
  };

  JR.initRunner = function () {
    window.addEventListener("message", function (e) {
      if (e.data.type === "log") {
        JR.log("[log] " + e.data.data);
      } else if (e.data.type === "error") {
        JR.log("[error] " + e.data.data);
      }
    });
  };
})();
