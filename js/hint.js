// hint.js —— 代码补全：触发时机 + 当前文档声明的名字 + 成员提示
(function () {
  "use strict";

  var JR = (window.JR = window.JR || {});

  // 只在输入标识符字符（字母、下划线、$、汉字）时弹出补全，
  // 输入数字、分号、冒号、句号、括号、空白等字符时不触发
  // （数字开不了标识符，写数值时弹窗只会干扰）
  // 例外：标识符后输入 "."（成员访问）时要弹出成员提示
  var HINT_TRIGGER = /^[A-Za-z_$\u4e00-\u9fff]$/;
  var MEMBER_DOT = /[A-Za-z_$][\w$]*\.$/;

  // ===== 补全候选里加入当前文档自己声明的变量 / 函数 =====
  // CodeMirror 自带的 JS 提示只覆盖全局对象、关键字和少量局部作用域，
  // 这里收集全文的 const/let/var、function/class 名、参数、catch 参数等，合并进候选列表。
  // acorn-loose 可用时走真实语法树（更准），加载失败则退回正则扫描。
  var baseJsHint = CodeMirror.hint.javascript;

  function collectNamesWithRegex(code) {
    var names = new Set();
    var takeDeclarators = function (raw) {
      String(raw).split(",").forEach(function (piece) {
        var left = piece.split("=")[0];
        var ids = left.match(/[A-Za-z_$][\w$]*/g) || [];
        ids.forEach(function (id) {
          names.add(id);
        });
      });
    };

    var m;
    // const / let / var（含逗号连声明、解构）
    var declRe = /\b(?:const|let|var)\s+([^;\n]+)/g;
    while ((m = declRe.exec(code))) takeDeclarators(m[1]);

    // function / class 名字
    var fnRe = /\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g;
    while ((m = fnRe.exec(code))) names.add(m[1]);

    // 函数参数
    var paramRe = /\bfunction\s*[A-Za-z_$]*\s*\(([^)]*)\)/g;
    while ((m = paramRe.exec(code))) takeDeclarators(m[1]);

    // 箭头函数参数
    var arrowRe = /(?:\(([^()]*)\)|[A-Za-z_$][\w$]*)\s*=>/g;
    while ((m = arrowRe.exec(code))) {
      if (m[1]) {
        takeDeclarators(m[1]);
      } else {
        var id = m[0].match(/[A-Za-z_$][\w$]*/);
        if (id) names.add(id[0]);
      }
    }

    return names;
  }

  // 从绑定模式（Identifier / 解构 / 默认值 / rest）里取出所有被声明的名字
  function addPatternIds(pattern, out) {
    if (!pattern || typeof pattern.type !== "string") return;
    switch (pattern.type) {
      case "Identifier":
        out.add(pattern.name);
        break;
      case "ObjectPattern":
        pattern.properties.forEach(function (p) {
          addPatternIds(p.type === "RestElement" ? p.argument : p.value, out);
        });
        break;
      case "ArrayPattern":
        pattern.elements.forEach(function (el) {
          addPatternIds(el, out);
        });
        break;
      case "AssignmentPattern":
        addPatternIds(pattern.left, out);
        break;
      case "RestElement":
        addPatternIds(pattern.argument, out);
        break;
      default:
        break;
    }
  }

  function ensureSet(map, key) {
    var set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    return set;
  }

  // 对象键 / 类成员的显示名
  function keyName(node) {
    if (!node) return null;
    if (node.type === "Identifier") return node.name;
    if (node.type === "Literal") {
      if (typeof node.value === "string" || typeof node.value === "number") return String(node.value);
    }
    return null;
  }

  // 对象字面量的键名 -> 变量名
  function addObjectKeys(objNode, varName, members) {
    var set = ensureSet(members, varName);
    (objNode.properties || []).forEach(function (p) {
      if (p && p.type === "Property" && !p.computed) {
        var k = keyName(p.key);
        if (k) set.add(k);
      }
    });
  }

  // 类的方法 / 字段名 -> 类名，以及赋值给变量的匿名类
  function addClassMembers(classNode, varName, classMembers, members) {
    var set = new Set();
    var body = (classNode.body && classNode.body.body) || [];
    body.forEach(function (m) {
      if (!m) return;
      if (m.type !== "MethodDefinition" && m.type !== "PropertyDefinition") return;
      if (m.type === "MethodDefinition" && m.kind === "constructor") return;
      if (m.key && m.key.type === "PrivateIdentifier") return;
      var k = keyName(m.key);
      if (k) set.add(k);
    });
    if (classNode.id && classNode.id.name) {
      classMembers.set(classNode.id.name, set);
      var target = ensureSet(members, classNode.id.name);
      set.forEach(function (k) {
        target.add(k);
      });
    }
    if (varName) {
      var target2 = ensureSet(members, varName);
      set.forEach(function (k) {
        target2.add(k);
      });
    }
  }

  // 内建构造函数的实例（new Date() / new Map() 等），成员名从原型上现取
  var BUILTIN_CTORS = new Set(["Date", "Array", "Map", "Set", "WeakMap", "WeakSet", "RegExp", "Promise", "Error", "TypeError", "RangeError"]);
  var builtinMemberCache = new Map();

  function getBuiltinMembers(ctorName) {
    if (builtinMemberCache.has(ctorName)) return builtinMemberCache.get(ctorName);
    var set = new Set();
    var ctor = window[ctorName];
    if (ctor && ctor.prototype) {
      Object.getOwnPropertyNames(ctor.prototype).forEach(function (n) {
        if (n !== "constructor") set.add(n);
      });
    }
    builtinMemberCache.set(ctorName, set);
    return set;
  }

  function collectWithAst(code) {
    var names = new Set();
    var members = new Map();       // 变量名 -> 可用成员名
    var classMembers = new Map();  // 类名 -> 成员名
    var instances = [];            // [变量名, 类名]
    var builtins = new Map();      // 变量名 -> 内建类型名
    var ast = window.acorn.loose.parse(code, { ecmaVersion: "latest" });
    var stack = [ast];
    while (stack.length) {
      var node = stack.pop();
      if (!node || typeof node.type !== "string") continue;
      switch (node.type) {
        case "VariableDeclarator":
          addPatternIds(node.id, names);
          if (node.id.type === "Identifier" && node.init) {
            if (node.init.type === "ObjectExpression") {
              addObjectKeys(node.init, node.id.name, members);
            } else if (node.init.type === "NewExpression" && node.init.callee && node.init.callee.type === "Identifier") {
              var ctorName = node.init.callee.name;
              // Date / Map 这类内建构造出来的实例，成员直接从运行时原型取
              if (BUILTIN_CTORS.has(ctorName)) {
                builtins.set(node.id.name, ctorName);
              } else {
                instances.push([node.id.name, ctorName]);
              }
            } else if (node.init.type === "ArrayExpression" || node.init.type === "ArrayPattern") {
              builtins.set(node.id.name, "Array");
            } else if (node.init.type === "ClassExpression") {
              addClassMembers(node.init, node.id.name, classMembers, members);
            }
          }
          break;
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression":
          if (node.id) names.add(node.id.name);
          (node.params || []).forEach(function (p) {
            addPatternIds(p, names);
          });
          break;
        case "ClassDeclaration":
        case "ClassExpression":
          if (node.id) names.add(node.id.name);
          addClassMembers(node, null, classMembers, members);
          break;
        case "AssignmentExpression":
          // cfg.newProp = 1 这类后补属性也收进成员表
          if (
            node.left &&
            node.left.type === "MemberExpression" &&
            !node.left.computed &&
            node.left.object &&
            node.left.object.type === "Identifier" &&
            node.left.property
          ) {
            var prop = keyName(node.left.property);
            var objName = node.left.object.name;
            if (prop && objName) ensureSet(members, objName).add(prop);
          }
          break;
        case "CatchClause":
          addPatternIds(node.param, names);
          break;
        case "ImportDeclaration":
          (node.specifiers || []).forEach(function (s) {
            if (s.local) names.add(s.local.name);
          });
          break;
        default:
          break;
      }
      for (var key in node) {
        if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
        var val = node[key];
        if (Array.isArray(val)) {
          for (var i = 0; i < val.length; i++) {
            var child = val[i];
            if (child && typeof child.type === "string") stack.push(child);
          }
        } else if (val && typeof val === "object" && typeof val.type === "string") {
          stack.push(val);
        }
      }
    }

    instances.forEach(function (pair) {
      var set = classMembers.get(pair[1]);
      if (set) {
        var target = ensureSet(members, pair[0]);
        set.forEach(function (k) {
          target.add(k);
        });
      }
    });

    return { names: names, members: members, builtins: builtins };
  }

  var userDataCache = { gen: -1, astReady: false, names: new Set(), members: null, builtins: null };

  function getUserData(cm) {
    var gen = cm.changeGeneration();
    var astReady = !!(window.acorn && window.acorn.loose);
    if (userDataCache.gen === gen && userDataCache.astReady === astReady) {
      return userDataCache;
    }
    userDataCache.gen = gen;
    userDataCache.astReady = astReady;
    userDataCache.members = null;
    userDataCache.builtins = null;
    userDataCache.names = collectNamesWithRegex(cm.getValue());
    if (astReady) {
      try {
        var data = collectWithAst(cm.getValue());
        userDataCache.names = data.names;
        userDataCache.members = data.members;
        userDataCache.builtins = data.builtins;
      } catch (e) {
        // 解析器异常时退回正则结果，不影响补全可用性
      }
    }
    return userDataCache;
  }

  JR.initHint = function () {
    var editor = JR.state.editor;

    editor.on("inputRead", function (cm, change) {
      if (cm.state.completeActive) return;
      var typed = change.text.join("");
      if (typed === ".") {
        var cur = cm.getCursor();
        var before = cm.getLine(cur.line).slice(0, cur.ch);
        if (MEMBER_DOT.test(before)) cm.showHint();
        return;
      }
      if (!HINT_TRIGGER.test(typed)) return;
      cm.showHint();
    });

    CodeMirror.registerHelper("hint", "javascript", function (cm, options) {
      var base = (baseJsHint && baseJsHint(cm, options)) || { list: [], from: cm.getCursor() };
      var cur = cm.getCursor();
      var before = cm.getLine(cur.line).slice(0, cur.ch);
      var prefixMatch = /[A-Za-z_$][\w$]*$/.exec(before);
      var prefix = prefixMatch ? prefixMatch[0] : "";
      var head = before.slice(0, before.length - prefix.length);

      // 注释、字符串里不补全自定义名字
      var tokenType = cm.getTokenAt(cur).type || "";
      if (/comment|string/.test(tokenType)) return base;

      var baseList = base.list || [];
      var existing = new Set(baseList.map(function (it) {
        return typeof it === "string" ? it : it.text;
      }));
      var list = baseList.slice();
      var data = getUserData(cm);

      // 对象成员访问（foo.bar）：用语法树反查 foo 声明的对象键 / 类成员 / 内建实例原型
      if (head.endsWith(".")) {
        var ownerMatch = /([A-Za-z_$][\w$]*)$/.exec(head.slice(0, -1));
        if (!ownerMatch) return base;
        var set = data.members ? data.members.get(ownerMatch[1]) : null;
        if (!set && data.builtins) {
          var ctor = data.builtins.get(ownerMatch[1]);
          if (ctor) set = getBuiltinMembers(ctor);
        }
        if (!set) return base;
        set.forEach(function (name) {
          if (existing.has(name)) return;
          if (prefix && !name.startsWith(prefix)) return;
          existing.add(name);
          list.push(name);
        });
        if (list.length === baseList.length) return base;
        return {
          list: list,
          from: CodeMirror.Pos(cur.line, cur.ch - prefix.length),
          to: cur
        };
      }

      data.names.forEach(function (name) {
        // 名字已经完整敲出来（与当前前缀完全一致）就不再作为候选
        if (name === prefix || existing.has(name)) return;
        if (prefix && !name.startsWith(prefix)) return;
        existing.add(name);
        list.push(name);
      });

      if (list.length === baseList.length) return base;

      return {
        list: list,
        from: base.from || CodeMirror.Pos(cur.line, cur.ch - prefix.length),
        to: base.to || cur
      };
    });
  };
})();
