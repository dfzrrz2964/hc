/* ============================================================
   黑城残响 · 变量操作引擎 (VAR MODEL v1)
   基于《黑城纪年》变量 schema 的操作协议:
   LLM 在正文外输出 <vars>[命令数组]</vars> → 引擎逐条校验并写入前端 state

   命令语法 (JSON 数组, 每条一个对象):
     { "op":"set",   "path":"属性.力量", "value":12 }            赋值
     { "op":"add",   "path":"货币.铜板", "value":50 }            数值加
     { "op":"sub",   "path":"生命值",    "value":5 }             数值减(资源下限 0)
     { "op":"mul",   "path":"攻击",      "value":2 }             数值乘
     { "op":"div",   "path":"幸运",      "value":2 }             数值除(保留2位)
     { "op":"merge", "path":"装备",      "value":{...} }         深合并对象(新增/更新装备·物品·任务·技能·人物)
     { "op":"del",   "path":"背包.xxx" }                          删除键
     { "op":"clamp", "path":"好感度",    "min":-100, "max":100 }  钳制范围
     { "op":"push",  "path":"技能",      "value":"s4" }           数组追加
     { "op":"pull",  "path":"光环",      "value":"hunter" }       数组移除
     { "op":"bag",   "action":"add|remove|set", "ref":"干粮", "qty":2 }  背包物品增减

   路径规则:
     - 点分路径, 可直接用快照中的真实键 (角色.等级 / 属性.力量 / 生命.当前)
     - 也可用 schema 别名 (等级 / 生命值 / 货币.铜板 / 所在位置 ...), 见 ALIAS
     - 好感度自动钳制 -100~100; 位阶/装备品质校验枚举; 数值字段自动转数字
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 枚举 (来自变量 schema) ---------- */
  /* 初始位阶: 三种族选择, 平行关系 (猎奴/黑城卫/异种), 非上下级 */
  var START_RANKS = ["猎奴", "黑城卫", "异种"];
  /* 晋升位阶: 从初始位阶之上沿军阶晋升 */
  var PROMO_RANKS = ["小卒", "悍卒", "什长", "百夫长", "千夫长",
    "普通战将", "准卓越战将", "卓越战将", "准传奇战将", "传奇战将", "准史诗战将", "史诗战将"];
  var RANKS = START_RANKS.concat(PROMO_RANKS);
  var QUALITIES = ["白色", "绿色", "蓝色", "紫色", "金色", "红色", "黑色"];

  /* ---------- 字段别名: schema 名 → state 真实路径 ---------- */
  var ALIAS = {
    "等级": "角色.等级",
    "位阶": "角色.位阶",
    "当前经验值": "角色.经验",
    "升级经验值": "角色.经验上限",
    "职业": "角色.主职业",
    "副职业": "角色.副职业",
    "自由属性点": "角色.自由属性点",
    "战力评价": "角色.战力评价",
    "兵种评级": "角色.兵种评级",
    "力量": "属性.力量",
    "敏捷": "属性.敏捷",
    "智力": "属性.智力",
    "攻击": "属性.攻击",
    "防御": "属性.防御",
    "穿透": "属性.穿透",
    "幸运": "属性.幸运",
    "魅力": "属性.魅力",
    "当前生命值": "生命.当前",
    "生命值": "生命.当前",
    "生命值上限": "生命.上限",
    "当前气力值": "气力.当前",
    "气力值": "气力.当前",
    "气力值上限": "气力.上限",
    "货币.铜板": "角色.货币.铜钱",
    "货币.银两": "角色.货币.银两",
    "货币.金锭": "角色.货币.金锭",
    "所在位置": "地点",
    "时间": "@time" /* 特殊: "黑城纪年YYYY年M月D日 HH:MM" → 日期对象 */,
    /* 动态内容详情 (与渲染层读取位置一致; merge 时写 技能详情/光环详情/天赋详情/任务详情.名称) */
    "技能详情": "技能详情",
    "光环详情": "光环详情",
    "天赋详情": "天赋详情",
    "任务详情": "任务详情",
    "装备详情": "装备详情",
    "背包详情": "背包详情"
  };

  /* ---------- 工具 ---------- */
  function num(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
    return NaN;
  }
  function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }

  /* 路径解析: 别名(含最长前缀) → 真实路径段; "@time" 特殊标记 */
  function resolvePath(path) {
    if (!path) return null;
    var p = String(path).trim();
    if (!p) return null;
    if (ALIAS[p]) return ALIAS[p] === "@time" ? ["@time"] : ALIAS[p].split(".");
    var segs = p.split(".");
    for (var i = segs.length; i >= 1; i--) {
      var pre = segs.slice(0, i).join(".");
      if (ALIAS[pre]) {
        var tail = segs.slice(i);
        var base = ALIAS[pre].split(".");
        if (base[0] === "@time") return ["@time"].concat(tail);
        return base.concat(tail);
      }
    }
    return segs;
  }

  function getByPath(obj, segs) {
    var cur = obj;
    for (var i = 0; i < segs.length; i++) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = cur[segs[i]];
    }
    return cur;
  }
  function setByPath(obj, segs, value) {
    var cur = obj;
    for (var i = 0; i < segs.length - 1; i++) {
      var k = segs[i];
      if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
      cur = cur[k];
    }
    cur[segs[segs.length - 1]] = value;
  }
  function removeByPath(obj, segs) {
    if (!segs.length) return;
    var parent = obj;
    for (var i = 0; i < segs.length - 1; i++) {
      if (parent == null || typeof parent !== "object") return;
      parent = parent[segs[i]];
    }
    if (parent && typeof parent === "object") delete parent[segs[segs.length - 1]];
  }
  function deepMerge(target, patch) {
    if (!isObj(target) || !isObj(patch)) return patch;
    Object.keys(patch).forEach(function (k) {
      var pv = patch[k];
      if (pv === null || pv === undefined) return;
      if (Array.isArray(pv)) { target[k] = pv.slice(); }
      else if (isObj(pv)) {
        if (!isObj(target[k])) target[k] = {};
        deepMerge(target[k], pv);
      } else { target[k] = pv; }
    });
    return target;
  }

  /* 资源字段 (sub 下限 0): 生命/气力/货币/数量/耐久 */
  function isResource(segs) {
    var p = segs.join(".");
    return /^(生命|气力)/.test(p) || p.indexOf("货币") >= 0 || p.indexOf("数量") >= 0 || p.indexOf("耐久") >= 0;
  }

  /* 类型/范围校验 (按 schema 规则) */
  function coerce(path, value) {
    var p = String(path || "");
    if (p === "位阶" || p === "角色.位阶") return RANKS.indexOf(value) >= 0 ? value : undefined;
    if (/装备品质|品质$/.test(p) && QUALITIES.indexOf(value) >= 0) return value;
    if (p.indexOf("好感度") >= 0) {
      var n = num(value);
      return isNaN(n) ? undefined : Math.max(-100, Math.min(100, n));
    }
    if (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value))) return Number(value);
    return value;
  }

  /* 时间字符串 → 日期对象 ("黑城纪年217年3月17日 14:30" / "... 酉时")
     同时保留 24 小时制 时/分 与十二时辰, 供 UI 双制式显示 */
  var SHICHEN = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  /* 时辰 → 代表小时 (子23 丑1 寅3 ... 亥21) */
  function shichenToHour(s) {
    var idx = SHICHEN.indexOf(String(s || "").replace(/时$/, ""));
    if (idx < 0) return NaN;
    return (idx === 0) ? 23 : (idx * 2 - 1);
  }
  /* 小时 → 时辰 (如 18 → 酉时) */
  function hourToShichen(h) {
    return SHICHEN[Math.floor(((h + 1) % 24) / 2)] + "时";
  }
  function parseTime(s) {
    if (!s || typeof s !== "string") return null;
    var m = s.match(/黑城纪年(\d+)年(\d{1,2})月(\d{1,2})日\s*(\S+)/);
    if (!m) return null;
    var t = m[4], 时辰 = t, 时, 分;
    var hm = t.match(/^(\d{1,2}):(\d{2})$/);
    if (hm) {
      时 = +hm[1]; 分 = +hm[2];
      时辰 = hourToShichen(时);
    } else {
      var hh = shichenToHour(时辰);
      if (!isNaN(hh)) { 时 = hh; 分 = 0; }
    }
    return { 年: +m[1], 月: +m[2], 日: +m[3], 时辰: 时辰, 时: 时, 分: 分 };
  }

  /* 货币名 → 货币栏键 (bag 操作货币时自动转货币栏, 防止货币被写入背包) */
  var CURRENCY = { "铜板": "铜钱", "铜钱": "铜钱", "银两": "银两", "金锭": "金锭" };

  /* 背包物品操作 (现有背包数组结构 [{id,ref,qty}]) */
  function bagOp(state, cmd) {
    var bag = state.背包;
    if (!Array.isArray(bag)) bag = state.背包 = [];
    var ref = cmd.ref || cmd.name;
    var qty = num(cmd.qty != null ? cmd.qty : 1);
    if (!ref || isNaN(qty)) return false;
    var action = cmd.action || "add";
    /* 货币自愈: bag 操作货币名 → 转货币栏增减, 绝不进背包 */
    var curKey = CURRENCY[ref];
    if (curKey) {
      if (!state.角色) state.角色 = {};
      if (!state.角色.货币) state.角色.货币 = {};
      var cur = state.角色.货币[curKey] || 0;
      if (action === "remove") cur = Math.max(0, cur - qty);
      else if (action === "set") cur = qty;
      else cur = cur + qty;
      state.角色.货币[curKey] = cur;
      return true;
    }
    var idx = bag.findIndex(function (b) { return b.ref === ref; });
    if (action === "remove") {
      if (idx >= 0) {
        bag[idx].qty -= qty;
        if (bag[idx].qty <= 0) bag.splice(idx, 1);
        return true;
      }
      return false;
    }
    if (action === "set") {
      if (idx >= 0) bag[idx].qty = qty;
      else bag.push({ id: "it" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), ref: ref, qty: qty });
      return true;
    }
    /* add */
    if (idx >= 0) bag[idx].qty = (bag[idx].qty || 0) + qty;
    else bag.push({ id: "it" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), ref: ref, qty: qty });
    return true;
  }

  /* 升级公式 (与 data.js EXP 一致; 100 × 10^等级) */
  function nextExp(lv) {
    var E = window.GAME_DATA && window.GAME_DATA.EXP;
    if (E && typeof E.升级所需经验 === "function") return E.升级所需经验(lv);
    return Math.round(100 * Math.pow(10, lv));
  }

  /* 升级自动结算: 经验达到上限 → 等级+1, 生命值上限+2(回复至上限), 自由属性点+2 */
  function grantLevel(state, changes) {
    var R = state.角色;
    if (!R || !(R.经验 >= 0) || !(R.经验上限 > 0)) return;
    var lv0 = R.等级 || 0, times = 0;
    while (R.经验 >= R.经验上限) {
      R.经验 -= R.经验上限;
      R.等级 = (R.等级 || 0) + 1;
      state.生命.上限 = (state.生命.上限 || 0) + 2;
      state.生命.当前 = state.生命.上限;
      R.自由属性点 = (R.自由属性点 || 0) + 2;
      R.经验上限 = nextExp(R.等级);
      times++;
    }
    if (times && changes) changes.push("升级 ×" + times + "：等级 " + lv0 + "→" + R.等级 + "，生命值上限 +" + (times * 2) + "，自由属性点 +" + (times * 2));
  }

  /* 命令 → 人类可读描述 (弹幕用) */
  function describe(cmd, segs) {
    if (!cmd || typeof cmd !== "object") return "";
    var op = cmd.op || "set";
    var path = cmd.path || "";
    var label = function (p) { return String(p || "").replace(/^角色\./, "").replace(/^属性\./, "").replace(/^生命\./, "生命").replace(/^气力\./, "气力"); };
    if (op === "bag") {
      var ref = cmd.ref || cmd.name || "";
      var qty = cmd.qty != null ? cmd.qty : 1;
      if (cmd.action === "remove") return "失去 " + ref + " ×" + qty;
      if (cmd.action === "set") return "背包 " + ref + " = " + qty;
      return "获得 " + ref + " ×" + qty;
    }
    if (op === "merge") return "更新 " + label(path);
    if (op === "del") return "移除 " + label(path);
    if (op === "push") return "追加 " + label(path) + " +" + cmd.value;
    if (op === "pull") return "移除 " + label(path) + " -" + cmd.value;
    if (op === "clamp") return "钳制 " + label(path);
    var v = cmd.value;
    if (op === "add") return label(path) + " +" + v;
    if (op === "sub") return label(path) + " -" + v;
    if (op === "mul") return label(path) + " ×" + v;
    if (op === "div") return label(path) + " ÷" + v;
    return label(path) + " → " + (typeof v === "object" ? JSON.stringify(v) : v);
  }

  /* ---------- 命令执行器 ---------- */
  function apply(state, commands) {
    if (!state || !Array.isArray(commands)) return { ok: 0, err: 0, changes: [] };
    var ok = 0, err = 0, changes = [];
    commands.forEach(function (cmd) {
      try {
        if (!cmd || typeof cmd !== "object") { err++; return; }
        var op = cmd.op || "set";
        if (op === "bag") { if (bagOp(state, cmd)) { ok++; changes.push(describe(cmd)); } else err++; return; }

        var segs = resolvePath(cmd.path);
        if (!segs) { err++; return; }
        if (segs[0] === "@time") {
          var t = parseTime(cmd.value);
          if (t) { state.日期 = t; ok++; changes.push(describe(cmd)); } else err++;
          return;
        }

        switch (op) {
          case "set": {
            var v = coerce(cmd.path, cmd.value);
            if (v === undefined) { err++; return; }
            setByPath(state, segs, v); ok++; changes.push(describe(cmd)); break;
          }
          case "add": {
            var n = num(cmd.value);
            if (isNaN(n)) { err++; return; }
            var cur = getByPath(state, segs);
            setByPath(state, segs, (typeof cur === "number" ? cur : 0) + n); ok++; changes.push(describe(cmd)); break;
          }
          case "sub": {
            var n2 = num(cmd.value);
            if (isNaN(n2)) { err++; return; }
            var cur2 = getByPath(state, segs);
            var r = (typeof cur2 === "number" ? cur2 : 0) - n2;
            if (isResource(segs)) r = Math.max(0, r);
            setByPath(state, segs, r); ok++; changes.push(describe(cmd)); break;
          }
          case "mul": {
            var n3 = num(cmd.value);
            if (isNaN(n3)) { err++; return; }
            var cur3 = getByPath(state, segs);
            setByPath(state, segs, (typeof cur3 === "number" ? cur3 : 0) * n3); ok++; changes.push(describe(cmd)); break;
          }
          case "div": {
            var n4 = num(cmd.value);
            if (isNaN(n4) || n4 === 0) { err++; return; }
            var cur4 = getByPath(state, segs);
            setByPath(state, segs, Math.round(((typeof cur4 === "number" ? cur4 : 0) / n4) * 100) / 100); ok++; changes.push(describe(cmd)); break;
          }
          case "merge": {
            if (!isObj(cmd.value)) { err++; return; }
            var target = getByPath(state, segs);
            if (!isObj(target)) target = {};
            deepMerge(target, cmd.value);
            setByPath(state, segs, target); ok++; changes.push(describe(cmd)); break;
          }
          case "del": {
            removeByPath(state, segs); ok++; changes.push(describe(cmd)); break;
          }
          case "clamp": {
            var c = getByPath(state, segs);
            if (typeof c !== "number") c = num(cmd.value != null ? cmd.value : c);
            if (isNaN(c)) { err++; return; }
            var mn = num(cmd.min), mx = num(cmd.max);
            if (!isNaN(mn)) c = Math.max(mn, c);
            if (!isNaN(mx)) c = Math.min(mx, c);
            setByPath(state, segs, c); ok++; changes.push(describe(cmd)); break;
          }
          case "push": {
            var arr = getByPath(state, segs);
            if (!Array.isArray(arr)) arr = [];
            if (arr.indexOf(cmd.value) < 0) arr.push(cmd.value);
            setByPath(state, segs, arr); ok++; changes.push(describe(cmd)); break;
          }
          case "pull": {
            var arr2 = getByPath(state, segs);
            if (!Array.isArray(arr2)) arr2 = [];
            var vi = arr2.indexOf(cmd.value);
            if (vi >= 0) arr2.splice(vi, 1);
            setByPath(state, segs, arr2); ok++; changes.push(describe(cmd)); break;
          }
          default: err++;
        }
      } catch (e) { err++; }
    });
    /* 升级自动结算 (经验达到升级经验值 → 每级 生命值上限+2 / 自由属性点+2) */
    grantLevel(state, changes);
    selfHeal(state);
    return { ok: ok, err: err, changes: changes };
  }

  /* ---------- 状态自愈: 把 LLM 常见错写自动归位 ----------
     ① 背包里残留的货币条目 → 并入货币栏 (如 bag 写错 ref=铜板)
     ② 装备栏非标准键 (如 装备.戒指 / 装备.武器) → 迁移到标准 12 槽位 (空槽优先) */
  function selfHeal(state) {
    if (!state || typeof state !== "object") return state;
    /* ① 背包残留货币 → 货币栏 */
    var bag = state.背包;
    if (Array.isArray(bag)) {
      var kept = [];
      bag.forEach(function (b) {
        var key = b && CURRENCY[b.ref];
        if (key && b.qty != null && !isNaN(b.qty)) {
          if (!state.角色) state.角色 = {};
          if (!state.角色.货币) state.角色.货币 = {};
          state.角色.货币[key] = (state.角色.货币[key] || 0) + b.qty;
        } else kept.push(b);
      });
      if (kept.length !== bag.length) state.背包 = kept;
    }
    /* ② 装备栏非标准键 → 标准槽位
       部位名键 (label 匹配, 如 戒指→戒指1/戒指2, 武器→武器1) 与 类型名键 (武器/防具/其他→组内空槽) 都迁移;
       键=装备名等无法识别时保留数据 */
    var gear = state.装备;
    if (gear && typeof gear === "object") {
      var SLOTS = (window.GAME_DATA && window.GAME_DATA.GEAR_SLOTS) || [];
      if (SLOTS.length) {
        Object.keys(gear).forEach(function (k) {
          if (SLOTS.some(function (s) { return s.key === k; })) return;
          var cands = SLOTS.filter(function (s) { return s.label === k; });
          if (!cands.length && (k === "武器" || k === "防具" || k === "其他")) {
            cands = SLOTS.filter(function (s) { return s.group === k; });
          }
          if (!cands.length) return; // 键=装备名等无法识别: 保留数据
          var v = gear[k];
          if (typeof v !== "string") return; // 非装备名字符串: 保留不迁移
          var empty = cands.filter(function (s) { return !gear[s.key]; })[0];
          var target = (empty || cands[0]).key;
          if (target !== k && !gear[target]) gear[target] = v;
          delete gear[k];
        });
      }
    }
    return state;
  }

  /* ---------- 快照: 当前变量 → 紧凑 JSON (注入系统提示) ---------- */
  function snapshot(state) {
    if (!state) return "{}";
    var r = state.角色 || {};
    var out = {
      角色: {
        姓名: r.姓名, 位阶: r.位阶, 等级: r.等级, 当前经验值: r.经验, 升级经验值: r.经验上限,
        职业: r.主职业, 副职业: r.副职业, 战力评价: r.战力评价, 兵种评级: r.兵种评级,
        自由属性点: r.自由属性点, 货币: r.货币
      },
      属性: state.属性,
      当前生命值: (state.生命 || {}).当前,
      生命值上限: (state.生命 || {}).上限,
      当前气力值: (state.气力 || {}).当前,
      气力值上限: (state.气力 || {}).上限,
      生命: state.生命,
      气力: state.气力,
      背包: (state.背包 || []).map(function (b) { return { 名称: b.ref, 数量: b.qty }; }),
      装备: state.装备,
      /* 动态内容: 详情对象与渲染层读取位置一致 (merge 时写 技能详情/光环详情/天赋详情/任务详情.名称) */
      技能详情: state.技能详情 || {},
      光环详情: state.光环详情 || {},
      天赋详情: state.天赋详情 || {},
      任务详情: state.任务详情 || {},
      任务进度: state.任务进度,
      周围人物: state.周围人物 || {},
      时间: (state.日期 ? (function (d) {
        var t = d.时辰 || "";
        if (d.时 != null) t += (t ? " " : "") + ("0" + d.时).slice(-2) + ":" + ("0" + (d.分 != null ? d.分 : 0)).slice(-2);
        return "黑城纪年" + (d.年 || "?") + "年" + (d.月 || "?") + "月" + (d.日 || "?") + "日 " + t;
      })(state.日期) : ""),
      所在位置: state.地点,
      天气: state.天气
    };
    return JSON.stringify(out);
  }

  window.VAR_MODEL = {
    apply: apply,
    snapshot: snapshot,
    parseTime: parseTime,
    hourToShichen: hourToShichen,
    shichenToHour: shichenToHour,
    getByPath: getByPath,
    setByPath: setByPath,
    resolvePath: resolvePath,
    describe: describe,
    selfHeal: selfHeal,
    ALIAS: ALIAS,
    RANKS: RANKS,
    START_RANKS: START_RANKS,
    PROMO_RANKS: PROMO_RANKS,
    QUALITIES: QUALITIES
  };
})();
