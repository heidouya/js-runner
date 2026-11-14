// runner.js —— 在独立 Worker 线程里执行代码，支持死循环保护
// 死循环保护开启时：循环体插桩，同一行循环累计执行超过 1 秒就判定死循环并报出行号
// 死循环保护关闭时：不终止，执行超过 5 秒只在控制台提示「可能是死循环」
(function () {
  "use strict";

  var JR = (window.JR = window.JR || {});

  // 代码发生变化后的自动运行（350ms 防抖）
  JR.debounceRun = function () {
    clearTimeout(JR.state.runTimer);
    if (!JR.state.autoRun) return;
    JR.state.runTimer = setTimeout(JR.run, 350);
  };

  // ===== 循环插桩 =====
  // 给每个 while / for / do...while 的循环体开头插入一句 __jrGuard(行号)
  // 插入内容不换行，所以报错行号仍然和编辑器里看到的一致
  // 解析失败（代码本身有语法错误）返回 null，调用方按原样执行
  JR.instrument = function (src) {
    var acorn = window.acorn;
    if (!acorn) return null;

    var ast;
    try {
      ast = acorn.parse(src, { ecmaVersion: "latest", locations: true });
    } catch (e) {
      return null;
    }

    var edits = [];
    (function walk(n) {
      if (!n || typeof n.type !== "string") return;

      if (
        n.type === "WhileStatement" ||
        n.type === "ForStatement" ||
        n.type === "DoWhileStatement" ||
        n.type === "ForOfStatement" ||
        n.type === "ForInStatement"
      ) {
        // 每轮只做一次自增和位运算，每 256 轮才调一次检查函数，尽量不拖慢循环
        var ins = "if(!(++__jrN & 255))__jrCheck(" + n.loc.start.line + ");";
        var body = n.body;
        if (body.type === "BlockStatement") {
          edits.push({ pos: body.start + 1, text: ins });
        } else {
          // 单语句循环体：包成 { 守卫; 原语句 }
          edits.push({ pos: body.start, text: "{ " + ins + " " });
          edits.push({ pos: body.end, text: " }" });
        }
      }

      for (var k in n) {
        if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
        var v = n[k];
        if (Array.isArray(v)) {
          for (var i = 0; i < v.length; i++) walk(v[i]);
        } else if (v && typeof v.type === "string") {
          walk(v);
        }
      }
    })(ast);

    if (!edits.length) return src;

    // 从后往前插入，前面还没处理的位置不会因为后面的插入而错位
    edits.sort(function (a, b) {
      return b.pos - a.pos;
    });
    var out = src;
    for (var j = 0; j < edits.length; j++) {
      out = out.slice(0, edits[j].pos) + edits[j].text + out.slice(edits[j].pos);
    }
    return out;
  };

  // ===== Worker 源码 =====
  var WORKER_SRC = `
var __jrMs = 1000, __jrTripped = false, __jrStat = {}, __jrGuardOn = false, __jrN = 0;
// 循环检查：插桩的代码每 256 轮迭代才调一次这个函数
// （每轮都调函数会让大循环慢两三倍，只做一次自增和位与几乎无开销）
// 同一行循环累计执行超过 __jrMs 毫秒就抛出，由外层 catch 报出行号
function __jrCheck(line) {
  if (__jrTripped) throw new Error("__JR_LOOP__" + line);
  var now = Date.now();
  var st = __jrStat[line];
  if (!st) {
    __jrStat[line] = { last: now, acc: 0 };
    return;
  }
  st.acc += now - st.last;
  st.last = now;

  if (__jrGuardOn && st.acc >= __jrMs) {
    __jrTripped = true;
    throw new Error("__JR_LOOP__" + line + ":" + st.acc);
  }
}

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
console.log = function (...args) {
  const parts = [];
  for (let i = 0; i < args.length; i++) parts.push(fmt(args[i], 0, null));
  self.postMessage({ type: "log", data: parts.join(" ") });
  oldLog.apply(console, args);
};

// 异步回调里抛出的错误（比如 setTimeout 里的 throw）走这里
self.onerror = function (msg, url, line) {
  self.postMessage({ type: "error", data: msg + " 行号:" + line });
  return true;
};

self.onmessage = function (e) {
  var data = e.data || {};
  __jrMs = data.guardMs || 1000;
  __jrGuardOn = !!data.guardOn;
  try {
    // 用 new Function 而不是 eval：eval 的代码 V8 基本不做优化，
    // 一段 7000 万次的循环要跑十几秒，new Function 只要几十毫秒
    (new Function(data.code))();
  } catch (err) {
    var text = err && err.message ? err.message : String(err);
    var loop = /__JR_LOOP__(\\d+)/.exec(text);
    if (loop) {
      self.postMessage({
        type: "error",
        data: "第 " + loop[1] + " 行检测到死循环（该循环已连续执行超过 " + Math.round(__jrMs / 1000) + " 秒），已终止本次执行。如果这是正常的长计算，可以在设置里关闭死循环保护"
      });
    } else {
      // new Function 会在源码前加 2 行包装（function anonymous(...) 那一层），行号要减掉
      var m = /<anonymous>:(\\d+):(\\d+)/.exec(err && err.stack ? String(err.stack) : "");
      var lineNo = m ? Number(m[1]) - 2 : 0;
      self.postMessage({ type: "error", data: text + (lineNo > 0 ? " 行号:" + lineNo : "") });
    }
  }
  self.postMessage({ type: "done" });
};
`;

  // Worker 用 blob URL，只建一次
  var workerUrl = null;
  function getWorkerUrl() {
    if (!workerUrl) {
      workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
    }
    return workerUrl;
  }

  // 终止正在跑的 Worker，并撤掉提示计时器
  JR.stopWorker = function () {
    if (JR.state.worker) {
      JR.state.worker.terminate();
      JR.state.worker = null;
    }
    clearTimeout(JR.state.slowTimer);
    JR.state.slowTimer = null;
  };

  JR.run = function () {
    var editor = JR.state.editor;
    if (!editor) return;

    JR.stopWorker();

    var raw = editor.getValue();
    var guardOn = !!JR.state.loopGuard;
    var code = raw;
    // 只在开启保护时插桩：守卫负责 1 秒判定并报出行号。
    // 关闭时不动源码（让用户代码原样执行），代价是 5 秒提示给不出行号。
    // 插桩失败（代码本身有语法错误、acorn 没加载）就按原样执行，退回 5 秒提示
    var guardApplied = false;
    if (guardOn) {
      var patched = JR.instrument(raw);
      if (patched != null) { code = patched; guardApplied = true; }
    }

    var worker;
    try {
      worker = new Worker(getWorkerUrl());
    } catch (e) {
      JR.log("[error] 无法创建执行线程：" + (e.message || e));
      return;
    }
    JR.state.worker = worker;

    var finished = false;

    worker.onmessage = function (e) {
      var d = e.data || {};
      if (d.type === "log") {
        JR.log("[log] " + d.data);
      } else if (d.type === "error") {
        JR.log("[error] " + d.data);
      } else if (d.type === "done") {
        finished = true;
        clearTimeout(JR.state.slowTimer);
        JR.state.slowTimer = null;
      }
    };

    worker.onerror = function (ev) {
      finished = true;
      clearTimeout(JR.state.slowTimer);
      JR.state.slowTimer = null;
      JR.log("[error] " + (ev.message || "执行出错"));
    };

    // 主线程这一侧不卡：Worker 死循环时，只有那个线程满载，页面照常响应
    // 只有「保护开启且插桩生效」时不设这个计时器（守卫会自己报行号）
    if (!(guardOn && guardApplied)) {
      JR.state.slowTimer = setTimeout(function () {
        if (finished) return;
        JR.log(
          "[提示] 执行已超过 " + JR.SLOW_WARN_MS / 1000 + " 秒，可能是死循环，请检查代码是否有误" +
            "（可在设置里开启「死循环保护」定位到具体行）"
        );
      }, JR.SLOW_WARN_MS);
    }

    worker.postMessage({ code: code, guardMs: JR.LOOP_GUARD_MS, guardOn: guardOn });
  };
})();
