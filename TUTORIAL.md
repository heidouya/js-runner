# JS 在线运行器：从零到进阶

这份教程从头讲一个「在浏览器里写 JS、点一下就能看到输出」的工具是怎么搭起来的。
所有代码都取自本项目的 `index.html`，不是示意性伪代码。

---

## 开篇：先看清全貌

### 成品是什么

一个 HTML 文件，打开就是一个深色代码编辑器，左边写代码、下面看输出。不装 Node、不跑构建、没有 `package.json`，双击或者起个本地静态服务就能用。

最终具备的能力：

| 能力 | 说明 |
| --- | --- |
| 编辑 | CodeMirror 5，行号、自动补括号、Tab 缩进、`Ctrl-/` 注释 |
| 运行 | 代码在隔离的 `iframe` 里执行，输出回流到页面 |
| 补全 | 全局对象 + 本文档自己声明的变量/函数/参数 + 对象与类成员 + Date 等内建实例成员 |
| 格式化 | Prettier（babel 解析器），按 2 空格、加分号、双引号重排 |
| 设置 | 编辑器字号、控制台字号、自动运行开关、深浅主题、导入/导出 .js |
| 细节 | 深浅两套配色、自定义滚动条、手机窄屏布局、清空二次确认 |

### 一次「运行」到底发生了什么

先把这条链路记住，后面每章都是在这条链上加东西：

```
你敲键盘
   │
   ▼
CodeMirror（#cm-editor 里的那个编辑器实例）
   │  editor.getValue() 拿到整段字符串
   ▼
runCode()
   │  新建一个 iframe，把「拦截 console 的代码 + 你的代码」塞进 srcdoc
   ▼
iframe 内部（隔离的执行环境）
   │  console.log 被替换过：先 postMessage 给父页面，再调用原生 log
   ▼
父页面（index.html 自己的 window）
   │  message 事件 → appendLog('[log] ' + 文本)
   ▼
#console 容器末尾追加一行，并滚到底部
```

补全和格式化走的是另外两条独立链路：

- **补全**：`inputRead` 事件 → 判断触发字符 → `cm.showHint()` → 我们注册的 hint 函数合并「默认候选 + 自己收集的名字 + 成员表」
- **格式化**：点「格式化」→ `prettier.format(代码, {parser:'babel', plugins:[...]})` → `editor.setValue(结果)`

### 文件结构

```
js-runner/
├── index.html    ← 全部代码都在这里（CSS + HTML + 一个 <script type="module">）
├── README.md     ← 功能与使用说明
└── imgs/         ← 截图
```

`index.html` 内部大致分三段：

1. `<style>`：暗色主题、亮色主题（`body.light-mode`）、弹窗、移动端 `@media`、滚动条
2. `<body>`：工具栏、编辑器容器、控制台、两个弹窗（设置 / 清空确认）
3. `<script type="module">`：编辑器初始化、设置、补全、运行、格式化、导入导出

### 外部依赖

全部走 CDN，`<head>` 里同步加载：

```
CodeMirror 5.65.16
  lib/codemirror.js, lib/codemirror.css
  mode/javascript/javascript.js
  theme/monokai.css, theme/default.css
  addon/hint/show-hint.js, addon/hint/show-hint.css, addon/hint/javascript-hint.js
  addon/edit/closebrackets.js
  addon/comment/comment.js

acorn 8.14 + acorn-loose 8.4     （head 里 defer）
Prettier 3.3.2                    （模块顶部静态 import，三个 .mjs）
```

### 怎么读这份教程

每章对应一个能跑起来的中间版本（下面叫 v0、v1……）。建议按顺序看：每章都从前一章的某个「不够用」开始，讲清楚为什么不够、怎么改、改完怎么验证。

代码片段和 `index.html` 一致，可以对照着看。章节末尾有「验证」一节，照着操作就能确认自己那版是对的。

### 章节与提交历史对照

| 章 | 内容 | 对应提交 |
| --- | --- | --- |
| 1 | 最小运行器 | initial: js-runner |
| 2 | 隔离执行环境 | （同批） |
| 3 | 接入 CodeMirror | 修改编辑器样式 |
| 4 | 输出面板 | 控制台打印数组/普通对象 |
| 5 | 持久化与首次进入 | 首次进入默认代码改为提示文案… |
| 6 | 界面结构 | 添加设置弹窗… / 清空按钮增加二次确认弹窗 |
| 7 | 字号与主题 | 设置面板增加编辑器与控制台字号设置 |
| 8 | 补全第一级 | 修复输入标点时误弹代码提示 / 修复输入数字时误弹补全提示 |
| 9 | 补全第二级 | 补全支持当前文件内声明的变量和函数 / 引入 acorn 解析… |
| 10 | 补全第三级 | 补全支持对象与类实例的成员提示 / 支持 Date、数组等内建实例的成员提示 |
| 11 | 格式化 | initial: js-runner（初版就有） |
| 12 | 性能 | 无提交，只有测量与方案分析 |
| 13 | 适配与细节 | 添加移动端窄屏适配 / 滚动条改为自定义样式… |

---

## 第 1 章 · 最小运行器：一个输入框加一个按钮

**本章目标**：让「写代码 → 看到结果」这件事先跑通，不追求好看。
**产出**：v1。

### 1.1 先想清楚「运行」是什么意思

浏览器自带 JS 引擎，写好的一段代码要么是被页面的 `<script>` 执行，要么是在某个时机被显式调用。要做一个「用户随手写、随时跑」的工具，就要在运行时把一段字符串变成可执行的代码。

两种常见做法：

```js
// 做法一：eval
eval('console.log(1 + 1)');

// 做法二：Function 构造器
new Function('console.log(1 + 1)')();
```

两者都能执行字符串，区别在于作用域：

- `eval` 在**调用它的那个作用域**里执行，能读写外部变量，也能往外部作用域里塞新变量
- `new Function` 体在**全局作用域**里执行，拿不到外层的局部变量

对运行器来说，`new Function` 更好预测：用户代码不会意外改到我们页面的局部变量。

### 1.2 最小可用的三件套

```html
<textarea id="code">console.log("hello")</textarea>
<button id="run">运行</button>
<div id="console"></div>
```

```js
document.getElementById("run").onclick = () => {
  let out = "";
  const fakeLog = (...args) => { out += args.join(" ") + "\n"; };
  try {
    new Function("console", "console.log(arguments[0])")(fakeLog);
  } catch (e) {
    out += "[error] " + e.message;
  }
  document.getElementById("console").textContent += out;
};
```

这里第一次出现了「替换 `console`」的思路：不直接让用户代码写页面，而是给它一个自己的 `console`，把输出收集起来再统一显示。这个思路会一直用到最后。

### 1.3 为什么这一步不算完成

跑起来之后问题立刻暴露：

```js
// 用户写这段
while (true) {}
```

页面直接卡死，连关都关不掉——代码和页面是**同一个线程、同一个环境**。

再试：

```js
var a = 1;      // 污染了页面的全局变量
console.log = 1; // 把页面的 console 整个覆盖掉
window.location = "https://example.com"; // 页面被跳走
```

结论：只要用户代码和我们共享一个环境，就永远不安全、不稳定。

### 验证

1. 写 `console.log("hello")`，点运行，控制台出现 `hello`
2. 写 `throw new Error("boom")`，点运行，控制台出现 `[error] boom`
3. 写 `while(true){}`，点运行 —— 页面卡死。**这是本章要记住的现象**

### 本章 checkpoint

- 知道 `eval` 与 `new Function` 在作用域上的差别
- 知道运行器可以被用户代码搞坏，以及为什么会坏

---

## 第 2 章 · 隔离：把代码关进 iframe

**本章目标**：让用户代码跑在一个独立环境里，卡死不影响我们的页面。
**前置**：第 1 章那个会卡死的版本。
**产出**：v2。

### 2.1 iframe 和 sandbox

```js
iframe = document.createElement('iframe');
iframe.sandbox = "allow-scripts";   // 只允许执行脚本，其它一律禁止
iframe.style.display = 'none';
document.body.appendChild(iframe);
```

`sandbox` 属性的作用是「默认全禁，逐个放行」。只给 `allow-scripts` 时，iframe 里的代码：

- 可以执行 JS
- 不能访问父页面的 DOM、变量
- 不能读 cookie、localStorage（它是独立源）
- 不能弹窗、不能提交表单

一件容易踩的事：**不要同时加 `allow-same-origin`**。两个属性一起用，iframe 就获得了和父页面相同的源，等于自己把隔离拆了。

### 2.2 用 srcdoc 塞代码

不写 iframe 的 `src`，而是直接把一段完整 HTML 作为字符串赋给 `srcdoc`：

```js
const code = editor.getValue();
const html = `
<!DOCTYPE html>
<html>
<body>
<script>
  // 这里是拦截器，固定不变
  ${code}
<\/script>
</body>
</html>
`;
iframe.srcdoc = html;
```

注意结尾的 `<\/script>`：这段 HTML 自己也写在 JS 的模板字符串里，直接写 `</script>` 会让外层脚本提前结束，把 `<\/script>` 转义一下才对。

### 2.3 把输出传回父页面

iframe 里没有我们的 `#console`，所以要跨窗口通信：

```js
// iframe 内部
const oldLog = console.log;
console.log = function(...args) {
  window.parent.postMessage({ type: 'log', data: args.join(' ') }, '*');
  oldLog.apply(console, args);   // 原生输出保留，DevTools 里也能看到
};

// 父页面
window.addEventListener('message', (e) => {
  if (e.data.type === 'log') {
    appendLog('[log] ' + e.data.data);
  }
});
```

调用顺序值得留意：先 `postMessage`，再调原生 `oldLog`。这样不管父页面那边怎么处理，原生 DevTools 里总有完整记录，出问题时有对照。

### 2.4 错误也要捞回来

iframe 里的异常，父页面看不见，得自己监听：

```js
window.onerror = function(msg, url, line, col, err) {
  window.parent.postMessage({ type: 'error', data: msg + ' 行号:' + line }, '*');
};
```

`sandbox` 导致 iframe 的报错不会冒到父页面，`onerror` 是唯一出口。

### 2.5 每次运行都新建 iframe

```js
function runCode() {
  if (iframe) iframe.remove();     // 上一个直接扔掉
  iframe = document.createElement('iframe');
  ...
  iframe.srcdoc = html;
}
```

不 `remove` 就会上一次留一个空壳，跑十次挂十个 iframe。

`remove()` 还有个副作用，很实用：**上次的定时器、事件监听、全局变量全部随环境销毁**。用户代码里写了 `setInterval`，重跑一次就自动清干净了，不用自己管。

### 验证

1. 写 `while(true){}` 再点运行：这一次只是 iframe 里死循环，页面本身还能动、能关
2. 写 `console.log("a", 1)`：主页面控制台出现 `[log] a 1`
3. 写 `throw new Error("boom")`：出现 `[error] ... 行号:5`
4. 写 `var a = 1` 运行后再写 `console.log(typeof a)` 运行：第二次是 `undefined`，说明每次都是干净环境

### 本章 checkpoint

- 理解 `sandbox` 默认全禁、逐项放行；知道为什么不能加 `allow-same-origin`
- 会用 `srcdoc` + `postMessage` 做父子通信
- 知道重跑时 `remove()` 顺带清掉了上一轮所有副作用

---

## 第 3 章 · 接入 CodeMirror

**本章目标**：把 `textarea` 换成真正的编辑器——行号、高亮、自动括号。
**前置**：v2 已经能跑。
**产出**：v3。

### 3.1 为什么要换成 CodeMirror

`textarea` 的问题不在「不能输入」，而在所有编辑体验都要自己写：行号、语法高亮、自动补括号、Tab 缩进、光标定位……每一项都是独立工程。这类需求有成熟的库，选一个接进去就行。

本项目用 **CodeMirror 5**（不是 6）：它是「引入几个文件、`CodeMirror(容器, 配置)` 一下就能用」的形态，不需要构建工具，最适合单文件项目。

### 3.2 四个必装文件

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/codemirror@5.65.16/lib/codemirror.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/codemirror@5.65.16/theme/monokai.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/codemirror@5.65.16/theme/default.css">

<script src="https://cdn.jsdelivr.net/npm/codemirror@5.65.16/lib/codemirror.js"></script>
<script src="https://cdn.jsdelivr.net/npm/codemirror@5.65.16/mode/javascript/javascript.js"></script>
```

四类文件缺一不可：

- `codemirror.css`：没有它编辑器连布局都是坏的
- `theme/*.css`：主题是纯 CSS，不加载就只是一个没颜色的框
- `mode/javascript/javascript.js`：语法高亮的规则表，不加载则整段代码同色
- `lib/codemirror.js`：本体

插件的加载方式一样，用到哪个加哪个：

```html
<script src=".../addon/edit/closebrackets.js"></script>   <!-- 自动补括号 -->
<script src=".../addon/hint/show-hint.js"></script>       <!-- 补全浮层 -->
<script src=".../addon/hint/javascript-hint.js"></script> <!-- JS 提示词库 -->
<script src=".../addon/comment/comment.js"></script>      <!-- Ctrl-/ 注释 -->
```

顺序要留意：插件脚本必须在 `lib/codemirror.js` **之后**，因为它依赖 `CodeMirror` 这个全局对象已经存在。

### 3.3 初始化

```js
const editor = CodeMirror(document.getElementById('cm-editor'), {
  value: savedCode ?? defaultCode,
  mode: "javascript",
  theme: savedTheme ?? "monokai",
  lineWrapping: true,
  lineNumbers: true,
  tabSize: 2,
  indentWithTabs: false,
  autoCloseBrackets: true,
  hintOptions: { completeSingle: false }
});
```

几个参数值得单独说：

- `mode: "javascript"`：对应你加载的 mode 文件。写成 `"js"` 也能识别，但和文件对应关系最容易记的是全名
- `lineWrapping: true`：长行折行。不开的话用户要横向滚动才能看到一行末尾
- `tabSize: 2` 配 `indentWithTabs: false`：按 Tab 插入两个空格而不是制表符。这样复制出去的代码在任何地方缩进都一致
- `autoCloseBrackets: true`：敲 `(` 自动补 `)`。需要 `closebrackets.js` 已加载
- `completeSingle: false`：补全只有一个候选时**不要**自动补上。这个设置很关键，否则用户打一个 `f` 就被自动改成 `function`，反而打断输入

### 3.4 自定义按键

`extraKeys` 用来接管按键：

```js
extraKeys: {
  "Ctrl-Space": "autocomplete",
  "Ctrl-/": "toggleComment",
  "Cmd-/": "toggleComment",
  "Tab": function(cm) {
    if (cm.somethingSelected()) cm.indentSelection("add");
    else cm.replaceSelection("  ", "end");
  },
  "Shift-Tab": function(cm) { cm.indentSelection("subtract"); }
}
```

- 值是字符串（`"autocomplete"`、`"toggleComment"`）时表示调用 CodeMirror 内置命令
- `Ctrl-/` 与 `Cmd-/` 写两条：macOS 上用户按 Cmd，Windows/Linux 按 Ctrl
- `Tab` 单独接管，是为了实现「有选区时整体缩进、没选区时插入两个空格」——不接管的话 Tab 会把焦点移出编辑器
- `autoCloseBrackets` 打开后，再输入闭合符号会被「跳过」而不是重复插入，这是插件的默认行为，不用额外处理

### 3.5 那个必须记住的坑：`refresh()`

CodeMirror 的渲染依赖它对字符宽度、行高的测量。只要**容器尺寸或字体**变了，它的测量就过期了，表现为：

- 光标位置和文字对不上
- 滚动条长度不对
- 折行位置错乱

解法就是调一次 `editor.refresh()`，让它重新测。项目里在字号设置处调它：

```js
function applyFontSizes() {
  document.documentElement.style.setProperty("--editor-font-size", editorFontSize + "px");
  ...
  editor.refresh();   // 字号变了，重新测量
}
```

什么时候必须调：改字号、弹窗打开导致容器尺寸变化、窗口 resize（CodeMirror 5 对 resize 有内置处理，但嵌套容器里不一定准）。

### 验证

1. 打开页面，编辑器有行号和语法高亮
2. 敲 `(` 自动出现 `)`；敲 `)` 时被跳过
3. 选中两行按 Tab，整体右移两格；按 Shift-Tab 退回
4. 选中一行按 `Ctrl-/`，行首出现 `//`，再按一次消失
5. 写一行超长代码，开启折行后不出现横向滚动条

### 本章 checkpoint

- 知道 CodeMirror 5 要哪几类文件、加载顺序有什么要求
- 能解释 `completeSingle: false` 为什么要关掉
- 记住「改尺寸/字号后要 `refresh()`」这一条

---

## 第 4 章 · 输出面板：把一堆值变成可读的文本

**本章目标**：让控制台输出的东西看起来像浏览器自己的 console。
**前置**：v3，已经有 `postMessage` 通路，但输出是 `[object Object]` 和 `3,4`。
**产出**：v4。

### 4.1 问题出在哪

最初一行代码是这样写的：

```js
console.log = function(...args) {
  window.parent.postMessage({ type: 'log', data: args.join(' ') }, '*');
  oldLog.apply(console, args);
};
```

`args.join(' ')` 会把每个参数转成字符串再拼起来。而 `String([3, 4])` 的结果是 `"3,4"`：

```js
[3, 4].join(' ')   // "3,4"  ← 数组的 toString 用逗号连接，没有空格
String([3, 4])     // "3,4"
String({ a: 1 })   // "[object Object]"
```

所以 `console.log([3, 4])` 打出来是 `3,4`，`console.log({a:1})` 打出来是 `[object Object]`。浏览器自己的 console 不是这么干的——它按类型分别渲染，数组显示成 `[3, 4]`。

### 4.2 按类型分派

核心是一个格式化函数，按值的类型决定怎么转成文本：

```js
function fmt(v, depth, seen) {
  depth = depth || 0;
  seen = seen || new Set();

  if (v === null) return "null";
  if (v === undefined) return "undefined";

  const t = typeof v;
  if (t === "string") return depth ? JSON.stringify(v) : v;   // 顶层字符串不加引号
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
      const out = "[" + v.map(item => fmt(item, depth + 1, seen)).join(", ") + "]";
      seen.delete(v);
      return out;
    }
    if (v instanceof Date) return v.toString();
    if (v instanceof Error) return v.name + ": " + v.message;

    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return String(v);
    ...
  } catch (e) {
    return String(v);
  }
}
```

几个设计决定，每个都能讲出理由：

**顶层字符串不加引号，嵌套的加。** `console.log("hi")` 应该输出 `hi`，但 `console.log(["a", "b"])` 里的元素显示 `["a", "b"]` 更清楚——否则看不出哪些是字符串。

**数组用 `", "` 连接。** 这就是为了修掉 `3,4` 那个问题：`[3, 4]` 而不是 `[3,4]`。

**只展开「普通对象」。** `Object.getPrototypeOf(v) === Object.prototype` 才继续往下展开。`Map`、`Set`、类实例的 proto 不是它，就退回 `String(v)` = `[object Map]`。这一点是刻意的：把 `Map` 强行展开成 `{}` 比原来还差。

**循环引用与深度上限。** `const a = {}; a.self = a;` 这种结构会让递归无限进行，`seen` 这个 Set 负责在第二次遇到同一个对象时返回 `[Circular]`。深度上限 4 是为了防止 `document` 这类巨大对象把控制台刷爆。

**`try/catch` 兜底。** 自定义对象的 getter 可能抛错，展开时抛错就退回 `String(v)`，不让格式化把整个输出搞崩。

### 4.3 接到 console 上

```js
console.log = function(...args) {
  const parts = [];
  for (let i = 0; i < args.length; i++) parts.push(fmt(args[i], 0, null));
  window.parent.postMessage({ type: 'log', data: parts.join(' ') }, '*');
  oldLog.apply(console, args);
};
```

每个参数独立格式化，再用空格拼接。这样 `console.log("hi", 1.5, true)` 得到 `hi 1.5 true`，和浏览器 console 的观感一致。

### 4.4 父页面那侧

```js
function appendLog(text) {
  consoleBox.textContent += text + '\n';
  consoleBox.scrollTop = consoleBox.scrollHeight;   // 滚到底
}
```

用 `textContent` 而不是 `innerHTML`：用户代码里可能打出 HTML 字符串，用 `innerHTML` 会被浏览器解析成真实节点（轻则显示错乱，重则 XSS）。`textContent` 始终按纯文本处理。

`scrollTop = scrollHeight` 是「追加一行就滚到底」的标准写法。

### 验证

```js
console.log([3, 4]);                       // 期望 [3, 4]
console.log("hi", 1.5, true, null, undefined);  // hi 1.5 true null undefined
console.log({a: 1, b: [2, 3]});            // {a: 1, b: [2, 3]}
console.log([1, ["x", "y"], {k: "v"}]);    // [1, ["x", "y"], {k: "v"}]
console.log([]);                            // []
function greet() {}
console.log(greet, new Date(2026, 0, 1));  // [Function: greet] Thu Jan 01 2026 ...
console.log(new Map([[1, 2]]));            // [object Map]
const c = {}; c.self = c; console.log(c);  // {self: [Circular]}
```

### 本章 checkpoint

- 知道 `String()` 与 `JSON.stringify()` 在数组、对象上的差别
- 理解为什么顶层字符串不加引号
- 知道为什么用 `textContent` 而不是 `innerHTML`
- 记住「Map/类实例不展开」是刻意的取舍，不是 bug

---

## 第 5 章 · 持久化与首次进入

**本章目标**：刷新不丢代码，第一次进来有个友好的开场。
**前置**：v4。
**产出**：v5。

### 5.1 存哪儿：localStorage

```js
const STORAGE_KEY = "js_runner_code";
const THEME_KEY = "js_runner_theme";

const savedCode = localStorage.getItem(STORAGE_KEY);
const savedTheme = localStorage.getItem(THEME_KEY);
```

`localStorage` 的三个特点决定了它适合这个场景：容量 5MB 左右够用、同步读写不用等、同源自动共享。

三种值要分清：

- `null`：从来没存过
- `""`：存过，但内容被清空了
- `"..."`：正常内容

`getItem` 返回 `null` 和 `""` 是两种完全不同的状态，后面「首次进入」的判断就靠这个差别。

### 5.2 什么时候写

```js
editor.on('change', () => {
  localStorage.setItem(STORAGE_KEY, editor.getValue());
  ...
});
```

每次内容变化都写。`localStorage` 同步写入会阻塞主线程，代码长的时候理论上该做防抖，但本地小文件（几百行）写入耗时在毫秒级，直接写反而省掉「什么时候存」的复杂度。真要注意性能，用 300ms 防抖即可。

### 5.3 默认内容与回填

```js
const defaultCode = `console.log("编辑器默认自动运行代码，可以在设置页面进行修改~");
`;

const editor = CodeMirror(..., {
  value: savedCode ?? defaultCode,     // 存过就用存的，没存过用默认
  ...
});
```

`??` 只在左值为 `null`/`undefined` 时取右边。这里不能用 `||`：如果用户把代码清空了，`savedCode` 是 `""`，用 `||` 会又变回默认代码，用户的清空操作就白做了。

### 5.4 第一次进来的光标位置

需求是：首次进入时光标停在第 2 行（默认那行代码的换行之后），并且编辑器要有焦点，用户可以立刻打字。

```js
const isFirstVisit = savedCode === null;

if (isFirstVisit) {
  editor.setCursor({ line: 1, ch: 0 });   // 行号从 0 开始，第 2 行就是 1
}
```

`setCursor` 的行列都从 0 起算，这是最容易写错的地方。

### 5.5 聚焦时要考虑后台标签

```js
if (isFirstVisit || savedCode === "") {
  const focusEditor = () => {
    editor.focus();
    if (isFirstVisit) editor.setCursor({ line: 1, ch: 0 });
  };
  if (document.hasFocus()) {
    focusEditor();
  } else {
    window.addEventListener("focus", focusEditor, { once: true });
  }
}
```

现象：页面在后台标签里打开（比如从别的页面点了个链接过来），马上调 `editor.focus()` 是无效的——浏览器不允许后台窗口抢焦点。用户切回来以后，光标就还是不在。

解法：先判断 `document.hasFocus()`，没焦点就挂一个一次性的 `focus` 监听，等用户第一次切到这个标签时再聚焦。

`{ once: true }` 保证这个监听执行一次就自行移除，不会每切一次都重设光标。

### 验证

1. 首次打开：编辑器里是那行提示文案，光标在第 2 行，直接打字能输入
2. 改成 `let a = 1`，刷新：内容还在
3. 把代码全删（内容变 `""`），刷新：为空，不是默认文案
4. 在另一个页面点链接跳到本页（后台加载），切回来时编辑器有焦点

### 本章 checkpoint

- 分清 `null` 和 `""` 在存储里的含义，以及为什么用 `??` 不用 `||`
- 知道 `setCursor` 从 0 起算
- 记住后台标签会忽略 `focus()`，需要 `focus` 事件兜底

---

## 第 6 章 · 界面结构：工具栏与两个弹窗

**本章目标**：功能长起来以后，按钮不能全堆在工具栏上。
**前置**：v5，已经有运行、清空、格式化、设置这些能力。
**产出**：v6。

### 6.1 信息分层

工具栏只放**高频、一眼就懂**的操作：

```html
<div class="btn-group">
  <button id="runBtn">运行</button>
  <button id="clearEditor">清空</button>
  <button id="formatCode">格式化</button>
  <button id="settingsBtn">设置</button>
</div>
```

低频的、带状态的、带选项的，收进「设置」里：字号、自动运行、主题、导入/导出。判断标准很朴素——**每天要用十次的和一个月改一次的，不该在同一层**。

### 6.2 弹窗的三层结构

```html
<div class="modal-mask" id="settingsMask">      <!-- 半透明遮罩，铺满全屏 -->
  <div class="settings-modal">                    <!-- 面板 -->
    <div class="settings-header">…</div>          <!-- 标题 + ✕ -->
    <div class="settings-body">…</div>            <!-- 内容区 -->
  </div>
</div>
```

显隐靠 class 切换，不直接改 `display`：

```css
.modal-mask { display: none; }
.modal-mask.show { display: flex; }
```

```js
function openSettings() { settingsMask.classList.add("show"); }
function closeSettings() { settingsMask.classList.remove("show"); }
```

好处是所有样式集中在 CSS 里，JS 只管状态；以后想加淡入动画，改 CSS 就行，不用动逻辑。

### 6.3 三种关闭方式

一个合格的弹窗，用户至少有三种直觉出口：

```js
closeSettingsBtn.onclick = closeSettings;          // 1. ✕
settingsMask.onclick = (e) => {                    // 2. 点遮罩
  if (e.target === settingsMask) closeSettings();
};
document.addEventListener("keydown", (e) => {      // 3. Esc
  if (e.key === "Escape" && settingsMask.classList.contains("show")) {
    closeSettings();
  }
});
```

第 2 条那个 `if (e.target === settingsMask)` 是重点。点击事件会冒泡：点面板内部，`e.target` 是面板里的某个元素，但事件也会经过遮罩。只有 `e.target` 恰好等于遮罩本身，才说明用户点的是「面板外面的空白处」，这时才该关。

Esc 的判断里带上 `classList.contains("show")`，避免面板没打开时也响应。

### 6.4 危险操作要二次确认

「清空」会同时清掉编辑器和控制台，且不可撤销。所以它不是直接执行，而是先弹确认框：

```js
clearEditorBtn.onclick = () => { openConfirm(); }

function openConfirm() {
  confirmMask.classList.add("show");
  confirmCancelBtn.focus();     // 默认聚焦「取消」
}
```

**默认焦点给「取消」**，理由很直接：用户下意识按回车时，应该是不执行。如果默认焦点在「确定清空」上，一次误按就把代码删了。

关闭后把焦点还给工具按钮：

```js
function closeConfirm() {
  confirmMask.classList.remove("show");
  clearEditorBtn.focus();
}
```

这是键盘可用性的常规做法：弹窗关掉后，焦点应该回到打开它的那个控件，而不是飘到页面起点。

### 6.5 布局用 flex，不靠宽度猜

```css
.header-bar { display: flex; align-items: center; justify-content: space-between; }
.btn-group  { display: flex; gap: 8px; }
```

标题在左、按钮在右，中间用 `space-between` 自动分开，按钮之间用 `gap` 而不是 `margin`——`gap` 不会在首尾多出空白，也不用处理「最后一个按钮不要右外边距」这种特例。

### 验证

1. 点「设置」弹出面板，四种方式都能关（✕、点遮罩、Esc、点面板内部不会关）
2. 点「清空」先弹确认框，焦点在「取消」上，直接回车不会清空
3. 点确认框的遮罩或 Esc，编辑器内容保持不变
4. 窗口拉宽拉窄，标题和按钮始终在两端，不重叠

### 本章 checkpoint

- 知道用 class 切显隐，而不是在 JS 里改 `display`
- 知道点遮罩关闭为什么要判断 `e.target === mask`
- 记住危险操作默认焦点给「取消」

---

## 第 7 章 · 字号与主题：两套不同的机制

**本章目标**：字号可调、主题可切，且都能记住。
**前置**：v6 的设置面板。
**产出**：v7。

### 7.1 字号为什么要走 CSS 变量

字号影响的地方不止编辑器：控制台、行号栏都跟着变。如果每个元素各写一个 `font-size`，改一次要动多处，还容易漏。

```css
:root {
  --editor-font-size: 25px;
  --console-font-size: 14px;
}
#cm-editor { font-size: var(--editor-font-size); }
#console   { font-size: var(--console-font-size); }
```

JS 只改一处：

```js
function applyFontSizes() {
  document.documentElement.style.setProperty("--editor-font-size", editorFontSize + "px");
  document.documentElement.style.setProperty("--console-font-size", consoleFontSize + "px");
  editorFontValueEl.textContent = editorFontSize + "px";
  consoleFontValueEl.textContent = consoleFontSize + "px";
  editor.refresh();    // 字号变了，CodeMirror 必须重新测量
}
```

`document.documentElement` 就是 `:root` 本身，`setProperty` 写入的值会立刻作用到所有引用这个变量的地方。

### 7.2 范围校验放在读和写两处

```js
const FONT_RANGE = {
  editor:  { min: 12, max: 48, def: 25 },
  console: { min: 10, max: 28, def: 14 }
};

function readFont(key, conf) {
  const raw = parseInt(localStorage.getItem(key), 10);
  if (Number.isNaN(raw)) return conf.def;
  return Math.min(conf.max, Math.max(conf.min, raw));   // 读的时候夹一次
}
```

读的时候夹一次很重要：用户可能在 DevTools 里把 `localStorage` 改成 `9999`，或者旧版本存过超出范围的值。夹住能保证界面永远不会因为这个崩掉。

写的时候也夹：

```js
function stepFont(target, delta) {
  const conf = FONT_RANGE[target];
  const current = target === "editor" ? editorFontSize : consoleFontSize;
  const next = Math.min(conf.max, Math.max(conf.min, current + delta));
  if (next === current) return;        // 到边界直接返回，不写存储
  ...
}
```

`if (next === current) return` 避免在边界上反复往 `localStorage` 写无意义的值，也避免按钮看起来没反应却一直在触发存储写入。

### 7.3 主题：两套机制要同步

这里有个容易搞混的点：**CodeMirror 的主题和页面的主题不是一回事**。

- 编辑器的配色由 `editor.setOption("theme", "monokai" | "default")` 控制，靠换 CSS 类，改的是 `.cm-s-monokai` 这类选择器下的颜色
- 页面其余部分（背景、按钮、控制台）由 `body.light-mode` 这个 class 控制，靠我们自己写的 CSS

所以切主题要**同时做两件事**：

```js
toggleThemeBtn.onclick = () => {
  isDark = !isDark;
  if (isDark) {
    editor.setOption("theme", "monokai");
    document.body.classList.remove("light-mode");
    localStorage.setItem(THEME_KEY, "monokai");
  } else {
    editor.setOption("theme", "default");
    document.body.classList.add("light-mode");
    localStorage.setItem(THEME_KEY, "default");
  }
  updateThemeDesc();
}
```

只改其中一个，就会出现「编辑器是浅色、控制台还是黑的」这种割裂。

### 7.4 自动运行开关

一个 `.switch` 样式的开关，比原生 checkbox 好看：

```html
<label class="switch">
  <input type="checkbox" id="autoRunToggle" checked>
  <span class="switch-slider"></span>
</label>
```

真正的 `input` 用 `opacity: 0` 藏起来，`span` 负责画滑块，点击 `label` 时原生 `input` 会被切换——所以 `input` 的 `change` 事件照常触发，逻辑不用自己造。

```js
let autoRun = localStorage.getItem(AUTORUN_KEY) !== "off";
autoRunToggle.checked = autoRun;

autoRunToggle.onchange = () => {
  autoRun = autoRunToggle.checked;
  localStorage.setItem(AUTORUN_KEY, autoRun ? "on" : "off");
  if (!autoRun) clearTimeout(runTimer);   // 关掉时把待执行的定时器清掉
};
```

判断写成 `!== "off"` 而不是 `=== "on"`：这样「从未设置过」和「设置为 on」都是开，默认就是开着，符合直觉。

### 验证

1. 编辑器字号调到 40px，编辑器行号、代码整体变大，光标位置仍然对得上（`refresh()` 生效）
2. 刷新页面，字号还是 40px
3. 一直点「−」到 12px，按钮不再变小，也不会再写存储
4. 切到浅色：编辑器、页面背景、控制台、按钮全部变浅，没有一处还是深色
5. 关掉自动运行，改代码不再自动执行；点「运行」仍能手动跑

### 本章 checkpoint

- 理解 CSS 变量在这类「一处改、多处生效」场景的价值
- 记住范围校验要在读和写两处都做
- 记住 CodeMirror 主题与页面主题是两套，必须同步

---

## 第 8 章 · 补全第一级：先把现成的用起来

**本章目标**：打字时能弹出候选，而且知道什么时候该弹、什么时候不该弹。
**前置**：v7。
**产出**：v8。

### 8.1 CodeMirror 的补全体系长什么样

三个角色：

- `show-hint.js`：负责浮层本身——弹出、定位、上下键选择、回车确认
- `javascript-hint.js`：负责提供候选词表（全局对象、关键字、少量局部作用域）
- `registerHelper("hint", "javascript", fn)`：把「候选来源」换成你自己的函数

默认用起来只要两步：

```js
// 1. 快捷键触发
extraKeys: { "Ctrl-Space": "autocomplete" }

// 2. （可选）自动触发
editor.on("inputRead", (cm) => cm.showHint());
```

第一步就有了：按 `Ctrl-Space` 弹候选。但用户期望的是「打字就弹」，于是 `inputRead` 上阵。

### 8.2 无条件的 inputRead 会变成噪音

```js
editor.on("inputRead", (cm) => cm.showHint());   // 最初就是这么写的
```

问题马上来了：敲 `;` 弹、敲 `:` 弹、敲 `,` 弹、敲 `.` 弹、敲中文标点也弹、写数字 `29` 也弹。用户每敲一个非字母字符都要看到一个浮层闪一下，很快就烦。

根因是 `inputRead` 只说明「有字符被输入」，不区分是什么字符。所以要在里面自己判断。

### 8.3 定义触发字符

```js
// 只在输入标识符字符（字母、下划线、$、汉字）时弹出补全
const HINT_TRIGGER = /^[A-Za-z_$\u4e00-\u9fff]$/;

editor.on('inputRead', function(cm, change) {
  if (cm.state.completeActive) return;      // 浮层已经开着，不要重入
  const typed = change.text.join("");
  if (!HINT_TRIGGER.test(typed)) return;
  cm.showHint();
});
```

三个细节：

**`\u4e00-\u9fff` 是中日韩统一表意文字区。** 中文变量名（`let 用户`）也该触发，否则中文标识符完全没有补全。

**`cm.state.completeActive` 判断。** 浮层已经显示时再调 `showHint`，会重建列表、丢掉当前的选中位置。跳过它。

**为什么第一次版本里这个正则还带了 `0-9`。** 最初的写法是 `/[A-Za-z0-9_$]/`，觉得「数字也是标识符的一部分」。这个判断错在两处：数字不能作为标识符的开头；而且在对象字面量里写值时（`age: 29`），敲 `2` 会弹出一整屏无关候选，纯属干扰。把数字移出去之后，写数值不再被打断。

### 8.4 但「标识符 + 点」要弹

只留字母之后，`obj.` 这种成员访问反而不弹了——`.` 不在触发集合里。这是个真实的取舍：`.` 既是「成员访问」，也是「数字小数点」。

```js
// 例外：标识符后输入 "." 时要弹出成员提示
const MEMBER_DOT = /[A-Za-z_$][\w$]*\.$/;

editor.on('inputRead', function(cm, change) {
  ...
  if (typed === ".") {
    const cur = cm.getCursor();
    const before = cm.getLine(cur.line).slice(0, cur.ch);
    if (MEMBER_DOT.test(before)) cm.showHint();
    return;                                  // 点号不做普通触发
  }
  ...
});
```

`MEMBER_DOT` 要求句点是**紧跟在标识符后面**的：`obj.` 命中，`1.`（数字小数点）不命中。这就是用正则区分两种含义的办法——看前一个字符是什么。

### 8.5 名字敲全了就不该再提示

现象：`const person` 打到 `pers` 时，候选里出现了 `person` 自己。用户正在声明它，把它当候选提示毫无意义。

修正只有一行：

```js
data.names.forEach((name) => {
  // 名字已经完整敲出来（与当前前缀完全一致）就不再作为候选
  if (name === prefix || existing.has(name)) return;
  ...
});
```

`prefix` 是当前光标前的那个标识符片段（用 `/[A-Za-z_$][\w$]*$/` 从光标所在行截出来的）。

这里有过一次反复：一开始把这行删了，理由是「语法树里拿到的就是已声明的名字，应该都提示」，结果用户立刻截图指出来——声明到一半时提示自己正在声明的名字，是明显的干扰。加回来才算对。

### 8.6 结果如何合并

光有触发规则还不够，还要把「默认候选」和「我们自己收集的候选」合到一起：

```js
CodeMirror.registerHelper("hint", "javascript", function(cm, options) {
  const base = (baseJsHint && baseJsHint(cm, options)) || { list: [], from: cm.getCursor() };
  const baseList = base.list || [];
  const existing = new Set(baseList.map(it => typeof it === "string" ? it : it.text));
  const list = baseList.slice();
  ...
  if (list.length === baseList.length) return base;   // 没新增任何东西，交回默认结果
  return { list, from: ..., to: ... };
});
```

要点：

- 先保存原生函数 `const baseJsHint = CodeMirror.hint.javascript;`，再注册自己的，否则会覆盖后拿不到原实现
- 用 `Set` 去重，默认候选里已有的名字不再重复加
- 如果一个都没新增，直接把 `base` 返回——避免我们自己构造的 `from/to` 干扰默认行为

### 8.7 注释和字符串里不该补全

```js
const tokenType = cm.getTokenAt(cur).type || "";
if (/comment|string/.test(tokenType)) return base;
```

`getTokenAt` 能拿到光标所在 token 的类型（`comment`、`string`、`variable-2` 等）。在注释或字符串里，用户输入的是自然语言或文本内容，弹代码候选是错的。

### 验证

1. 敲字母 `f`：弹候选，包含 `function`、`false` 等
2. 敲 `;` `:` `,` `.`（在数字后）`（`：都不弹
3. 写 `const obj = {a: 1};` 换行写 `obj.`：弹成员列表（此时可能为空，下一章补数据）
4. 写 `const person`，继续敲 `pers`：候选里不再有 `person`
5. 在 `//` 注释里敲字母：不弹

### 本章 checkpoint

- 知道 `inputRead` 是「任何输入」都会触发，必须自己过滤字符
- 知道数字为什么不能放在触发集合里
- 理解 `.` 的两种含义怎么用正则区分
- 记住「名字等于前缀就跳过」这条排除规则

---

## 第 9 章 · 补全第二级：认识你自己写的名字

**本章目标**：让补全包含当前文件里自己声明的变量、函数、参数。
**前置**：v8。
**产出**：v9。

### 9.1 第一版：正则扫描

```js
function collectNamesWithRegex(code) {
  const names = new Set();
  const takeDeclarators = (raw) => {
    String(raw).split(",").forEach((piece) => {
      const left = piece.split("=")[0];
      const ids = left.match(/[A-Za-z_$][\w$]*/g) || [];
      ids.forEach((id) => names.add(id));
    });
  };

  let m;
  const declRe = /\b(?:const|let|var)\s+([^;\n]+)/g;   // const/let/var 声明
  while ((m = declRe.exec(code)) !== null) takeDeclarators(m[1]);

  // function / class 名、参数列表……
  return names;
}
```

正则方案覆盖了最常见的情况：`const a = 1, b = 2;`、`const { x, y } = obj;`、`function foo(bar)`、箭头函数参数。

### 9.2 正则的天花板

试几段代码就会发现它的边界：

```js
// 1. 注释里的「声明」会被收进来
// const fake = 1;

// 2. 字符串里的也会
const s = "const notReal = 2";

// 3. 解构参数
function f({ x, y }) {}      // 正则只能拿到 x、y 的一部分情况

// 4. catch 参数被漏掉
try {} catch (e) {}          // e 拿不到

// 5. 嵌套与多行
const a = {
  b: 1
};
```

正则本身没有「语法结构」的概念，它只认字符模式，所以这些情况要么误收、要么漏收。要 100% 准确，需要一个真正的解析器。

### 9.3 引入 acorn

选择是 **acorn + acorn-loose**：

- `acorn`：标准 JS 解析器，遇到语法错误直接抛异常
- `acorn-loose`：基于 acorn 的容错版本，**代码不完整也能解析**，把看不懂的地方当空语句跳过

这一点至关重要。用户是在**写代码的过程中**请求补全的，此刻的文本十有八九是残缺的（`const person` 还没写完赋值），严格解析必然抛错，容错解析才能继续工作。

```js
const ast = window.acorn.loose.parse(code, { ecmaVersion: "latest" });
```

两个 UMD 包都是往 `window.acorn` 上挂东西，加载顺序：先 `acorn.js`，再 `acorn-loose.js`（后者依赖前者）。本项目为了不拖慢首屏，这两个脚本用 `defer` 放在 `head` 里。

### 9.4 遍历：用显式栈代替递归

```js
const stack = [ast];
while (stack.length) {
  const node = stack.pop();
  if (!node || typeof node.type !== "string") continue;

  switch (node.type) {
    case "VariableDeclarator": ...
    case "FunctionDeclaration": ...
    case "ClassDeclaration": ...
  }

  for (const key in node) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        const child = val[i];
        if (child && typeof child.type === "string") stack.push(child);
      }
    } else if (val && typeof val === "object" && typeof val.type === "string") {
      stack.push(val);
    }
  }
}
```

为什么不用「遍历到 `VariableDeclarator` 就递归子节点」的写法：深层嵌套的代码（大括号套大括号）会把调用栈压深，极端情况爆栈。显式栈把递归换成循环，深度由内存而不是调用栈决定。

`for (const key in node)` 这一圈是「通用子节点遍历」：AST 节点的子节点可能放在 `body`、`declarations`、`init`、`params` 等各种字段里，逐个判断太琐碎。跳过 `start`/`end`/`loc`/`range` 是为了绕开位置信息对象（它们不是节点）。

### 9.5 收集哪些结构

| 节点类型 | 收集什么 |
| --- | --- |
| `VariableDeclarator` | 声明的名字（含解构模式） |
| `FunctionDeclaration` / `FunctionExpression` / `ArrowFunctionExpression` | 函数名 + 所有参数 |
| `ClassDeclaration` / `ClassExpression` | 类名 |
| `CatchClause` | `catch (e)` 里的 e |
| `ImportDeclaration` | import 进来的本地名 |

`addPatternIds` 负责把一个「模式」拆成名字：`Identifier` 直接取名字，`ObjectPattern` / `ArrayPattern` 递归到里面的 `Property` / `RestElement`。

### 9.6 缓存：别每次都重新解析

补全在每次按键时都可能触发，每敲一个字母就完整解析一遍全文，几百行代码时会有明显的卡顿。

```js
const userDataCache = { gen: -1, astReady: false, names: new Set(), members: null };

function getUserData(cm) {
  const gen = cm.changeGeneration();
  const astReady = !!(window.acorn && window.acorn.loose);
  if (userDataCache.gen === gen && userDataCache.astReady === astReady) {
    return userDataCache;              // 内容没变，直接用上次结果
  }
  userDataCache.gen = gen;
  ...
}
```

`cm.changeGeneration()` 是 CodeMirror 给的「版本号」，每次内容变化就 +1。用它当缓存键，等于「内容变了我才重算」，比记录文本内容比对省事得多。

`astReady` 也要进缓存键：解析器是异步加载的，加载完成那一刻即使代码没变，也应该重新收集一次（换成更准的语法树结果）。

### 9.7 一定要有兜底

```js
userDataCache.names = collectNamesWithRegex(cm.getValue());   // 先按正则算一遍
if (astReady) {
  try {
    const data = collectWithAst(cm.getValue());
    userDataCache.names = data.names;      // 成功才覆盖
    ...
  } catch (e) {
    // 解析器异常时退回正则结果，不影响补全可用性
  }
}
```

解析器可能没加载完（网络慢）、可能因为极端语法抛错。这时补全不能整个失效，正则版本虽然不精确，但足够用。

### 验证

```js
const person = "x";
function calcTotal(items, rate) { return 0; }
try { throw 1 } catch (err) {}

// 然后输入
per      → 候选含 person
calc     → 候选含 calcTotal
err      → 候选含 err
// 在注释里写 // const fake = 1 之后
fa       → 不应出现 fake
```

### 本章 checkpoint

- 知道正则方案为什么不够：它没有语法结构
- 知道 `acorn-loose` 的价值是「残码也能解析」
- 会用显式栈遍历 AST，知道为什么要避免递归
- 会用 `changeGeneration()` 做缓存键
- 记住降级路径：解析失败必须退回正则

---

## 第 10 章 · 补全第三级：成员提示

**本章目标**：`obj.`、`instance.`、`cfg.` 之后能列出可用成员。
**前置**：v9 有语法树了。
**产出**：v10（当前版本）。

### 10.1 成员表和名字表不是一回事

名字表是「有哪些变量」：`person`、`calcTotal`。
成员表是「某个变量有哪些属性」：`person` 的 `name`、`age`。

所以数据结构变成两个：

```js
const names = new Set();      // 全局可用的名字
const members = new Map();    // 变量名 -> 该变量的成员名集合
```

### 10.2 四种来源

**对象字面量**：

```js
case "VariableDeclarator":
  if (node.init.type === "ObjectExpression") {
    addObjectKeys(node.init, node.id.name, members);
  }
```

`addObjectKeys` 遍历 `ObjectExpression.properties`，把每个 `key` 的名字收进去（`keyName()` 负责处理 `Identifier` 和字符串字面量两种键写法）。

**class 的方法与字段**：

```js
function addClassMembers(classNode, varName, classMembers, members) {
  // 收集 classNode.body.body 里的 MethodDefinition / PropertyDefinition 名字
  // 如果 varName 有值（class 表达式），直接挂到该变量上
  // 否则存进 classMembers，等 new 的时候再挂
}
```

类的方法名在 `MethodDefinition.key` 上，字段在 `PropertyDefinition.key` 上。

**`new 自定义类()` 的实例**：

```js
} else if (node.init.type === "NewExpression" && node.init.callee.type === "Identifier") {
  instances.push([node.id.name, node.init.callee.name]);   // 先记下来
}

// 遍历结束后统一挂载
instances.forEach(([varName, className]) => {
  const set = classMembers.get(className);
  if (set) {
    const target = ensureSet(members, varName);
    set.forEach(k => target.add(k));
  }
});
```

为什么先存再挂：`new` 出现的位置可能早于 class 定义，一次遍历走到 `new` 时 `classMembers` 里还没有那个类。攒起来最后处理，顺序就不影响了。

**后补属性**：

```js
const cfg = {};
cfg.newProp = 1;      // 这类赋值也要收
```

```js
case "AssignmentExpression":
  if (node.left.type === "MemberExpression" && !node.left.computed
      && node.left.object.type === "Identifier") {
    const prop = keyName(node.left.property);
    if (prop) ensureSet(members, node.left.object.name).add(prop);
  }
```

`!node.left.computed` 排除了 `cfg[key]` 这种计算属性——键是变量，静态分析拿不到值。

### 10.3 内建实例：从原型现取

`new Date()` 这一类没有「源码里的类定义」，成员表里自然是空的。但它们在运行时是有原型的：

```js
const BUILTIN_CTORS = new Set(["Date", "Array", "Map", "Set", "WeakMap", "WeakSet",
                               "RegExp", "Promise", "Error", "TypeError", "RangeError"]);

function getBuiltinMembers(ctorName) {
  if (builtinMemberCache.has(ctorName)) return builtinMemberCache.get(ctorName);
  const set = new Set();
  const ctor = window[ctorName];
  if (ctor && ctor.prototype) {
    Object.getOwnPropertyNames(ctor.prototype).forEach((n) => {
      if (n !== "constructor") set.add(n);
    });
  }
  builtinMemberCache.set(ctorName, set);
  return set;
}
```

两个好处：不用手写方法清单（浏览器有什么就提示什么），也不会因为版本更新而漏掉新方法。

数组字面量 `const arr = [1, 2]` 也归到 Array：

```js
} else if (node.init.type === "ArrayExpression") {
  builtins.set(node.id.name, "Array");
}
```

### 10.4 查的顺序决定「不会串味」

```js
if (head.endsWith(".")) {
  const ownerMatch = /([A-Za-z_$][\w$]*)$/.exec(head.slice(0, -1));
  if (!ownerMatch) return base;

  let set = data.members ? data.members.get(ownerMatch[1]) : null;   // 先查自己的成员表
  if (!set && data.builtins) {                                       // 查不到才看是不是内建
    const ctor = data.builtins.get(ownerMatch[1]);
    if (ctor) set = getBuiltinMembers(ctor);
  }
  if (!set) return base;                                             // 都没有，交回默认
  ...
}
```

顺序是 **先自己、后内建、都没有就退回默认**。如果反过来先查原型，用户自己定义的对象就会冒出一堆 `toString`、`hasOwnProperty`，把真正的业务字段淹没。

### 10.5 前缀也要过滤

成员列表同样要按已输入的部分过滤：

```js
set.forEach((name) => {
  if (existing.has(name)) return;
  if (prefix && !name.startsWith(prefix)) return;
  existing.add(name);
  list.push(name);
});
```

`cfg.a` 应该只出 `alphaKey` 这种以 `a` 开头的。

### 10.6 明确的能力边界

这套方案不覆盖的情况，写清楚比含糊过去有用：

- **函数返回值**：`getUser().` 没有变量名可查
- **`extends` 继承**：父类方法不在子类 `body` 里
- **深层链**：`obj.a.b.` 只看得到 `obj` 这一层
- **计算属性**：`cfg[key].`
- **静态成员**：`Date.now`、`Array.from` 在构造函数自身上，不在实例原型上
- **作用域遮蔽**：同名的内层变量不影响成员表（表是按名字索引的，没有作用域概念）

要覆盖这些，需要的是一个真正的语言服务（TypeScript Language Service 那类），成本和体积都是另一个量级。

### 验证

```js
const obj = { alphaKey: 1, betaKey: 2 };
obj.        → alphaKey、betaKey

class Foo { constructor(){ this.x = 1 } render(){} }
const f = new Foo();
f.          → render

const cfg = {}; cfg.extraProp = 1;
cfg.        → extraProp

const date = new Date();
date.       → getFullYear、getMonth、toISOString…（47 个）

const arr = [1, 2];
arr.        → length、push、map、filter…

zzz.        → 无候选（退回默认提示）
```

### 本章 checkpoint

- 知道成员表和名字表要分开维护
- 理解「先存 instances 再统一挂载」是为了避开声明顺序
- 理解「先查自己、后查内建」的顺序为什么重要
- 能说清这套方案的能力边界

---

## 第 11 章 · 格式化：Prettier 与它的代价

**本章目标**：一键把代码排整齐。
**前置**：v10。
**产出**：v11。

> 格式化功能在项目初版就有，这里把它单独成章，是因为它牵出了第 12 章的整个加载问题——一个「顺手加上去」的功能，代价比想象的大。

### 11.1 为什么引入 Prettier

自己写格式化器要处理缩进层级、运算符优先级、括号换行、对象/数组尾逗号……没有几百行做不完，而且永远有边界情况。Prettier 是这一个领域的事实标准，直接用它。

用法是「解析 → 打印」：

```js
const formatted = await prettier.format(raw, {
  parser: "babel",
  plugins: [prettierPluginBabel, prettierPluginEstree],
  tabWidth: 2,
  semi: true,
  singleQuote: false
});
```

### 11.2 为什么是 babel 解析器，还要配 estree

Prettier 3 把插件拆了出去，核心包不再自带语法解析能力：

- `standalone.mjs`：格式化引擎本体，不含任何语言支持
- `plugins/babel.mjs`：用 Babel 解析 JS，产出 **Babel AST**（节点名是 `File`、`ObjectProperty` 这一类）
- `plugins/estree.mjs`：把 Babel AST 转成 **ESTree AST**（节点名是 `Program`、`Property`），Prettier 的打印器认的是这种

少了任何一个，`format()` 都会报「找不到 parser」。`estree` 这个名字就是「ESTree 规范」，也是 ESLint 用的那套节点结构。

为什么不用 `acorn` 当解析器？Prettier 不提供 acorn 插件；而 babel 解析器更宽松，能接受一些规范外但常见的写法。

### 11.3 失败路径

```js
} catch (err) {
  appendLog('[格式化失败] 语法错误：' + err.message);
}
```

语法错误的代码不能格式化（解析就过不去），这时必须让用户看到「为什么不行」，而不是静默不动。

### 11.4 代价：加载体积

三个模块加起来 1.5MB 往上，其中 `babel.mjs` 一个就过 MB。它们是在模块顶部静态 `import` 的：

```js
import * as prettier from "https://unpkg.com/prettier@3.3.2/standalone.mjs";
import * as prettierPluginBabel from "https://unpkg.com/prettier@3.3.2/plugins/babel.mjs";
import * as prettierPluginEstree from "https://unpkg.com/prettier@3.3.2/plugins/estree.mjs";
```

静态 `import` 意味着：**打开页面就要下载并解析这 1.5MB，哪怕用户一次都不点格式化**。

这不是理论问题。实测首次打开时，这三个文件占了首屏下载量的大头，直接拖慢「打开就能用」的体验。第 12 章会讲怎么测量和怎么改，以及为什么本项目最终还是保留了这种写法。

### 验证

1. 输入 `const   a=1`，点「格式化」，变成 `const a = 1;`
2. 输入 `let b={x:1,y:[2,3]}`，格式化后是缩进对齐的多行结构
3. 输入 `function f( {` 这种不完整代码，点格式化，控制台出现 `[格式化失败] 语法错误：…`
4. 打开 DevTools 的 Network，首次加载能看到三个 `unpkg.com/prettier` 的请求

### 本章 checkpoint

- 知道 Prettier 3 必须配 `babel` + `estree` 两个插件，缺一不可
- 知道 `standalone` 不含语言支持
- 记住「静态 import 的东西，不管用不用都会下载」这件事

---

## 第 12 章 · 性能：首屏到底在等什么

**本章目标**：会测量，知道瓶颈在哪，知道有哪些解法以及各自的代价。
**前置**：v11。
**产出**：v12（可选优化，本项目保持现状）。

### 12.1 先测量，再优化

打开 DevTools → Network → 刷新，看三个数：

1. 请求数量
2. 传输字节总量（右下角）
3. 从请求到页面可交互的时间

本项目当前的一次干净刷新（未命中缓存）：**15 个外部请求**，加上本地 `index.html` 一共 16 条。分布是：

| 类别 | 数量 | 具体文件 |
| --- | --- | --- |
| CodeMirror 核心 + 模式 | 2 | `lib/codemirror.js`、`mode/javascript/javascript.js` |
| CodeMirror 插件 | 5 | show-hint.js、show-hint.css、javascript-hint.js、closebrackets.js、comment.js |
| CodeMirror 样式 | 3 | `lib/codemirror.css`、`theme/monokai.css`、`theme/default.css` |
| acorn | 2 | `acorn.js`、`acorn-loose.js` |
| Prettier | 3 | `standalone.mjs`、`plugins/babel.mjs`、`plugins/estree.mjs` |

体积上的账：CodeMirror 全家桶 0.4MB 左右，acorn 0.3MB 左右，Prettier 1.5MB 左右。**Prettier 一家占了三分之二还多，而它只服务于一个按钮。**

### 12.2 三种脚本加载方式

```html
<script src="a.js"></script>              <!-- 同步：下载完立即执行，会阻塞后面 -->
<script defer src="b.js"></script>        <!-- 等 DOM 解析完再按顺序执行 -->
<script async src="c.js"></script>        <!-- 下载完就执行，顺序不保证 -->
```

- 同步：多个之间互相等待，会拖慢首屏渲染
- `defer`：不阻塞解析，但要等其他资源都就绪
- `async`：谁先下载完谁先执行，**有依赖关系时不能用**

acorn 与 acorn-loose 有先后依赖（`acorn-loose` 读 `window.acorn`），所以是 `defer`，不能 `async`。

再进一步是动态注入：

```js
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("load failed: " + src));
    document.head.appendChild(el);
  });
}

window.addEventListener("load", () => {
  loadScript("https://cdn.jsdelivr.net/npm/acorn@8.14.0/dist/acorn.js")
    .then(() => loadScript("https://cdn.jsdelivr.net/npm/acorn-loose@8.4.0/dist/acorn-loose.js"))
    .catch(() => { /* 加载失败就继续用正则兜底 */ });
}, { once: true });
```

好处是首屏渲染不再和它抢带宽；代价是补全在加载完成前只能用正则结果——反正第 9 章已经写了兜底，这个代价可以接受。

### 12.3 Prettier 的按需加载

把静态 `import` 换成函数内的动态 `import()`：

```js
let prettierBundle = null;
async function loadPrettier() {
  if (!prettierBundle) {
    const [prettier, babel, estree] = await Promise.all([
      import("https://unpkg.com/prettier@3.3.2/standalone.mjs"),
      import("https://unpkg.com/prettier@3.3.2/plugins/babel.mjs"),
      import("https://unpkg.com/prettier@3.3.2/plugins/estree.mjs")
    ]);
    prettierBundle = { prettier, babel, estree };
  }
  return prettierBundle;
}
```

点击时的交互要配合：

```js
formatCodeBtn.onclick = async () => {
  const btnText = formatCodeBtn.textContent;
  try {
    formatCodeBtn.disabled = true;
    formatCodeBtn.textContent = "格式化中…";
    const { prettier, babel, estree } = await loadPrettier();
    const formatted = await prettier.format(editor.getValue(), {
      parser: "babel", plugins: [babel, estree],
      tabWidth: 2, semi: true, singleQuote: false
    });
    editor.setValue(formatted);
  } catch (err) {
    appendLog('[格式化失败] 语法错误：' + err.message);
  } finally {
    formatCodeBtn.disabled = false;
    formatCodeBtn.textContent = btnText;    // 无论成败都恢复
  }
};
```

`finally` 里恢复按钮状态是关键：加载失败、格式化抛错时按钮不能一直卡在「格式化中…」禁用着。

实测这一改：干净刷新时外部请求数从 15 降到 12，请求列表里不再出现 prettier，首屏下载量从约 2MB 降到约 0.6MB；首次点格式化时那 3 个请求才出现，格式化结果正确。

**取舍**：这一步本项目最终没有保留，仍是顶部静态 `import`。原因是首次点「格式化」时要等 1.5MB 下载，按钮会停顿一两秒——对「我刚写完想看看整齐的样子」这种即时反馈，比打开页面时多等一下更难受。两个方案都成立，取决于你更在意打开还是更在意点击。

> **可以直接对照的示例**：`examples/lazy-load/index.html` 就是按本章改造后的完整版本（acorn 延后加载 + Prettier 按需加载），功能和根目录版本一致。用同一个本地服务打开两个 URL，分别刷新一次数请求数，差别一眼可见：
>
> ```
> /index.html                       首屏 15 个外部请求（含 prettier 3 个，约 1.5MB）
> /examples/lazy-load/index.html    首屏 12 个外部请求（无 prettier）
> ```

### 12.4 缓存：第二次刷新为什么快

CDN 的响应头决定浏览器要不要回源：

```
codemirror: public, max-age=31536000, s-maxage=31536000, immutable
acorn:      public, max-age=31536000, s-maxage=31536000, immutable
prettier:   public, max-age=31536000
```

- `max-age` 一年：这一年内的刷新都不回源
- `immutable`：告诉浏览器「这 URL 的内容永不变化」，连条件请求（`If-None-Match`）都省了

所以「第二次刷新慢」通常不是方案问题，而是缓存被禁（DevTools 勾了 Disable cache）、换了浏览器/设备、或者 URL 版本号变了（本项目验证时加的 `?v=N` 就是为了绕过本地 `index.html` 的缓存）。

注意 `?v=N` 只影响 `index.html` 本身，CDN 的路径没变，缓存照常命中。

### 12.5 更彻底的一条路：本地化

把 CodeMirror 那 10 个文件下载到项目目录（比如 `lib/`），`index.html` 改相对路径引用：

```html
<link rel="stylesheet" href="lib/codemirror.css">
<script src="lib/codemirror.js"></script>
```

- 收益：首屏**零网络请求**，读本地文件；断网可用；不受 CDN 抖动影响（本次开发期间就遇到过 jsdelivr 偶发卡住导致页面停在 loading）
- 代价：项目从「单文件」变成「文件 + 目录」；升级版本要手动替换这 10 个文件

Prettier 那三个 `.mjs` 也可以在本地放，但 `file://` 协议下 ESM 的跨源规则更严格，双击打开的场景可能会报错，需要实测。

### 验证

1. DevTools Network 里数一数：这次刷新除了 `index.html`，有多少个外部请求
2. 勾上 Disable cache 再刷新，看总传输字节
3. 取消勾选再刷新一次，观察请求变成 `(disk cache)`，耗时明显下降
4. （可选）把 prettier 改成动态加载，再数一次请求数，对比首次点格式化时的等待

### 本章 checkpoint

- 会用 Network 面板数请求、看体积，而不是凭感觉判断「慢」
- 知道 `defer` 与 `async` 的区别，知道有依赖时不能用 `async`
- 理解 `max-age` + `immutable` 对二次刷新的意义
- 能说出按需加载和静态引入各自的代价

---

## 第 13 章 · 适配与细节：窄屏、滚动条、文件名

**本章目标**：让工具在手机上能用、在深色背景下看着干净。
**前置**：v12。
**产出**：v13（当前版本）。

### 13.1 移动端：只在窄屏生效

```css
/* ===== 移动端适配：只在窄屏生效，桌面布局不受影响 ===== */
@media (max-width: 768px) {
  .container { width: 100%; padding: 10px 12px; gap: 8px; }
  .header-bar { flex-wrap: wrap; gap: 8px; }
  h2 { font-size: 18px; }
  .btn-group { gap: 6px; }
  button { padding: 8px 10px; font-size: 13px; }
  .console-wrap { height: 150px; }
  #console { padding: 8px 10px; }
  .settings-modal { width: 100%; max-height: calc(100vh - 32px); overflow-y: auto; }
  .CodeMirror-hint { font-size: 14px; }
}
```

几条原则：

- **桌面规则一行都不动**。所有移动端改动都写在这个块里，桌面用户感知为零
- 标题和按钮分两行：`flex-wrap: wrap` 就够了，不用重排结构
- 按键盘的触控区域要够大：`padding: 8px 10px` 比桌面更大，小按钮在手机上点不中
- 设置弹窗限高：`max-height: calc(100vh - 32px)` + `overflow-y: auto`，内容比屏幕高时可以内部滚动，而不是把页面撑开

字号这里有个遗留问题：编辑器字号是从 JS 无条件写入 CSS 变量的（第 7 章），移动端 `@media` 里改不动它。要降就得在 JS 里判断「窄屏且用户没手动设置过」，属于跨层的逻辑，本项目没做。

### 13.2 怎么验证窄屏

调浏览器窗口宽度不可靠（有的环境窗口最小宽度固定），CDP 的设备模拟在某些环境里会报错。更稳的办法是**临时写一个固定尺寸的页面，把首页放进 iframe**：

```html
<iframe src="http://127.0.0.1:8765/index.html" style="width:375px;height:812px;border:0"></iframe>
```

iframe 内部视口就是 375px，媒体查询照常命中，能真实反映手机上的排版。验证完把这个临时文件删掉，不进项目。

### 13.3 滚动条：写对容器才算数

现象：深色编辑器右侧是一条系统默认的浅灰方块，很扎眼。

第一反应是给 `.CodeMirror-scroll` 写 `::-webkit-scrollbar`——**没用**。CodeMirror 5 的滚动条不在 `.CodeMirror-scroll` 上，而在两个专门的 div 上：

```
.CodeMirror-vscrollbar   垂直滚动条（overflow-y: scroll）
.CodeMirror-hscrollbar   水平滚动条（overflow-x: scroll）
```

所以选择器必须落到它们身上：

```css
#console::-webkit-scrollbar,
#cm-editor .CodeMirror-vscrollbar::-webkit-scrollbar,
#cm-editor .CodeMirror-hscrollbar::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

#console::-webkit-scrollbar-track,
#cm-editor .CodeMirror-vscrollbar::-webkit-scrollbar-track,
#cm-editor .CodeMirror-hscrollbar::-webkit-scrollbar-track {
  background: transparent;          /* 轨道不要实心带 */
}

#console::-webkit-scrollbar-thumb,
#cm-editor .CodeMirror-vscrollbar::-webkit-scrollbar-thumb,
#cm-editor .CodeMirror-hscrollbar::-webkit-scrollbar-thumb {
  background-color: #3c3c3c;
  border-radius: 8px;
  border: 2px solid transparent;    /* 透明边框做出「细条」的错觉 */
  background-clip: padding-box;     /* 边框不染色，只留内层 */
}
```

`border: 2px solid transparent` + `background-clip: padding-box` 这个组合值得单独说：滚动条的槽宽是固定的（10px），直接画一个 10px 的圆角色块会显得粗笨。加透明边框后，可见部分只有 10 - 2×2 = 6px，看起来是「细条浮在背景上」。

浅色主题换一套颜色，用 `body.light-mode` 前缀：

```css
body.light-mode #console::-webkit-scrollbar-thumb, ... {
  background-color: #cfcfcf;
}
```

Firefox 不支持 `::-webkit-scrollbar`，它有自己的标准属性：

```css
#console,
#cm-editor .CodeMirror-vscrollbar,
#cm-editor .CodeMirror-hscrollbar {
  scrollbar-width: thin;
  scrollbar-color: #3c3c3c transparent;
}
```

`scrollbar-color` 只有两个值：滑块色、轨道色。能调的比 webkit 少，但至少有细条和配色。

### 13.4 导出文件名

```js
function buildFileName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const date = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join("-");
  const time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join("-");
  return `${date}-${time}.js`;
}
```

两个要点：

- `getMonth()` 从 0 起算，必须 `+1`
- 所有数字都要 `padStart(2, "0")`，否则会出现 `2026-1-5-9-8-3.js` 这种排序混乱的文件名

下载本身用 Blob + 临时链接：

```js
const blob = new Blob([code], { type: "text/plain" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = buildFileName();
a.click();
URL.revokeObjectURL(url);      // 用完释放，否则这块内存挂到页面关闭
```

### 13.5 一个和代码无关、但用户会问的问题

导出的 `.js` 双击打不开，报「你的 Internet 安全设置阻止打开一个或多个文件」。

这不是代码问题。排查路径：

1. 文件属性里是否带 `Zone.Identifier`（下载来的文件会带，`ZoneId=4` 表示来自「Internet 区域」）
2. `.js` 的默认打开方式是不是 `WScript.exe`（Windows 默认把它交给「Windows 脚本宿主」执行）

`.js` 归 WSH 管，而 WSH 会拒绝执行带「受限区域」标记的脚本，于是就报这个错。两个解法：`Unblock-File` 去掉标记，或者把 `.js` 的默认打开方式改成编辑器/浏览器。

这类问题值得记住：**用户描述的「代码有问题」，有一半时候问题在路上，不在代码里。**

### 验证

1. 375px 宽度下：标题与按钮分两行、按钮不挤在一起、设置弹窗能滚动
2. 让编辑器滚动起来（放几十行代码），滚动条是深灰细条而不是浅灰方块
3. 切到浅色，滚动条变成浅灰细条
4. 点「保存JS」，文件名形如 `2026-11-14-01-20-05.js`
5. 双击导出的文件，能复现那个提示（这是系统行为，不是 bug）

### 本章 checkpoint

- 知道媒体查询要包住所有移动端改动，桌面不受影响
- 知道用固定尺寸 iframe 验证窄屏比调窗口可靠
- 记住 CodeMirror 的滚动条在 `.CodeMirror-vscrollbar` 上
- 理解透明边框 + `background-clip` 做出细条的原理

---

## 附录 A · 自测清单

不提供答案，自己在项目里验证。全过说明真的读懂了。

**环境与运行**
1. 直接双击 `index.html` 和通过 `http://127.0.0.1:8765` 打开，行为有差别吗？差别在哪？
2. 写 `while(true){}` 点运行，页面会卡死吗？为什么不会/会？
3. iframe 同时加 `allow-scripts` 和 `allow-same-origin` 会发生什么？

**编辑器**
4. 改字号后不调 `refresh()`，会出现什么现象？
5. `completeSingle: true` 时，输入 `f` 会发生什么？

**输出**
6. `console.log([3, 4])` 和 `console.log("3, 4")` 的输出，屏幕上看起来一样吗？代码里怎么区分？
7. `console.log(new Map([[1,2]]))` 输出什么？为什么不做成 `{1: 2}`？

**持久化**
8. 把编辑器内容全删后刷新，看到的是空白还是默认文案？为什么？
9. 页面在后台标签里打开，切回来时编辑器有焦点吗？

**补全**
10. 输入 `29` 时会弹补全吗？输入 `1.` 呢？
11. `const person` 敲到 `pers` 时，候选里有 `person` 吗？
12. 在 `// 注释` 里敲字母会弹候选吗？
13. `date.` 能出多少候选？其中 `setFullYear` 在吗？`Date.now` 在吗？

**性能**
14. 一次干净刷新（未命中缓存）除了 `index.html` 还有几个请求？
15. 第二次刷新这些请求还会走网络吗？看响应头的哪个字段能确认？
16. 把 Prettier 改成动态 `import()` 后，请求数变成多少？代价是什么？

---

## 附录 B · 踩坑索引

按「现象」查，方便以后遇到时对上号。

| 现象 | 原因 | 在哪一章 |
| --- | --- | --- |
| 页面被用户代码卡死 | 代码和页面同环境 | 1 → 2 |
| `</script>` 让脚本提前结束 | 模板字符串里的 HTML 标签 | 2 |
| 长代码光标位置错乱 | 字号/尺寸变化后没 `refresh()` | 3 |
| 输出 `3,4` 而不是 `[3, 4]` | `args.join(' ')` 的 `String()` 转换 | 4 |
| `Map` 显示成 `{}` | 强行展开非普通对象 | 4 |
| 清空后刷新又变回默认代码 | 用 `\|\|` 而不是 `??` | 5 |
| 后台标签打开时没有焦点 | 浏览器忽略后台 `focus()` | 5 |
| 点面板内部也把弹窗关了 | 没判断 `e.target === mask` | 6 |
| 回车误清空代码 | 默认焦点给了「确定」 | 6 |
| 编辑器浅色、控制台深色 | 两套主题机制没同步 | 7 |
| 敲 `;` `:` `,` 弹补全 | `inputRead` 无条件触发 | 8 |
| `age: 29` 敲 `2` 弹全量候选 | 触发正则含数字 | 8 |
| `obj.` 不弹成员 | `.` 不在触发集合 | 8 |
| 声明到一半提示自己 | 没排除 `name === prefix` | 8 |
| 注释里的假声明进了候选 | 正则没有语法概念 | 9 |
| 每次按键都卡一下 | 补全时重复解析全文 | 9 |
| `date.` 没有候选 | 只收集了源码里的类 | 10 |
| `obj.` 冒出一堆 `toString` | 查成员时先查了原型 | 10 |
| 点格式化按钮卡在「格式化中…」 | `finally` 里没恢复状态 | 12 |
| 滚动条怎么改都没反应 | 选择器写在了 `.CodeMirror-scroll` | 13 |
| 导出的 `.js` 双击被拦 | 文件带 `Zone.Identifier` + `.js` 关联 WSH | 13 |

---

## 附录 C · 术语

| 术语 | 一句话解释 |
| --- | --- |
| ESTree | 一套 AST 节点命名的行业规范，ESLint、Prettier 都用它 |
| UMD | 同时支持浏览器全局、CommonJS、AMD 的打包格式，`window.xxx` 就来自它 |
| srcdoc | iframe 的一个属性，值是一整段 HTML 字符串，直接在 iframe 里渲染 |
| `changeGeneration()` | CodeMirror 的内容版本号，每次编辑 +1，常用来做缓存键 |
| 缓存键（cache key） | 判断「能不能复用上次结果」的依据，这里用版本号 + 解析器是否就绪 |
| MOTW | Mark-of-the-Web，Windows 给下载文件打的「来源标记」，就是 `Zone.Identifier` |

