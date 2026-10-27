/* ============================================================
   黑城残响 · 变量内核（腐化式 <set> 行式协议）
   ------------------------------------------------------------
   命令：<set>路径 运算符 值</set>   运算符：= · += · -=
   每行一条；同一对象的多个字段用块式写法（容器路径只写一次，
   子字段缩进，由 V.expand 展开）。路径必须在白名单内，
   每个 白名单根 由专用处理器校验字段/类型/范围，失败逐条进
   失败弹窗，成功飘弹幕。

   白名单（17 根）：
     货币.铜板/银两/金锭              非负整数（铜板→铜钱 自动映射）
     当前时间 = 全串 / .年/.月/.日/.时/.分/.时辰
     天气 = 文本
     玩家位置 = 文本（别名：所在位置 / 地点）
     属性.力量/敏捷/智力/攻击/防御/穿透/魅力/幸运   整数 ≥0
     角色.主职业/副职业/隐藏职业/兵种评级/战力评价 = 文本
     角色.自由属性点/灵视/疫抗/建城令 (≥0) / 声望 (整数)
     角色.位阶 = 枚举（只能晋升一阶或保持）
     生命.当前/上限（别名 生命值/生命值上限）    整数 ≥0，当前≤上限
     气力.当前/上限（别名 气力值/气力值上限）    同上
     经验 += 整数                                升级由引擎自动结算
     背包[名].数量/类型/效果
     装备.槽位 = 装备名 | 无                     12 槽 + 三类自动落空槽
     装备详情[名].装备类型/装备品质/耐久度.当前/耐久度.上限/精炼等级/
                绑定状态/穿戴要求/特效类型/特效详情/套装效果/精炼材料类型/
                基础属性.属性名
     技能[名].等级/消耗气力/效果
     光环[名].效果
     天赋[名].效果
     任务[名].类型/奖励/进度/进度上限/完成
     周围人物[名].等级/外貌/装备/内心想法/好感度/属性.字段

   升级/状态自愈沿用 VAR_MODEL / GD 的既有实现；本层不认识快照。
   ============================================================ */
(function () {
  'use strict';

  const V = {};

  /* ---------- 工具 ---------- */
  let getState = function () { return null; };
  let danmakuFn = null;
  V.attach = function (fn) { getState = fn; };
  V.setDanmaku = function (fn) { danmakuFn = fn; };

  const num = v => {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v == null ? '' : v).replace(/[¥￥,\s，]/g, '');
    if (s === '' || isNaN(Number(s))) return null;
    return Number(s);
  };
  const parseBool = v => /^(true|是|1|开|已触发|已完成|已绑定)$/i.test(String(v == null ? '' : v).trim()) ? true
    : /^(false|否|0|关|未触发|未完成|未绑定)$/i.test(String(v == null ? '' : v).trim()) ? false : null;
  const parseVal = s => {
    s = String(s == null ? '' : s).trim();
    if (/^-?[\d,，]+(\.\d+)?$/.test(s)) return num(s);
    const b = parseBool(s); if (b !== null) return b;
    const m = /^[“"『「](.*)[”"』」]$/.exec(s); return m ? m[1] : s;
  };
  const cut = (t, n) => { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n) + '…' : t; };
  const esc = t => String(t == null ? '' : t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const pad2 = n => String(n).padStart(2, '0');
  const BAD_KEY = k => k === '__proto__' || k === 'constructor' || k === 'prototype';
  const segAt = (path, i) => path[i] && (path[i].seg || path[i].key);

  /* 运算：= += -= （其余运算符在解析层已不可能出现，这里兜底） */
  function applyOp(cur, op, n) {
    if (op === '=') return n;
    if (op === '+=') return (Number(cur) || 0) + n;
    if (op === '-=') return (Number(cur) || 0) - n;
    throw '运算符只支持 = += -=';
  }

  /* ---------- 路径解析：a.b[k].c ---------- */
  function parsePath(s) {
    const segs = [], re = /([^.\[\]]+)|\[([^\]]*)\]/g;
    let m, last = 0;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last && /[^\s.\[]/.test(s.slice(last, m.index))) return null;
      segs.push(m[1] !== undefined ? { seg: m[1].trim() } : { key: (m[2] || '').trim() });
      last = re.lastIndex;
    }
    return segs.length && last === s.length ? segs : null;
  }

  /* ---------- 命令解析（容错：冒号当 = ；漏运算符补 = ） ---------- */
  V.parse = line => {
    let s = String(line == null ? '' : line).trim().replace(/^[-*·]\s+/, '');
    if (!s) return null;
    let m = /^(.+?)\s*(\+=|-=|=)\s*(.*)$/.exec(s);
    if (!m) {
      const mc = /^([^.\[\]:：]+(?:[.\[][^:：]*)*)\s*[：:]\s*(.*)$/.exec(s);
      if (mc && /(\.[^.\[\]]+|\][^.\[\]]+)$/.test(mc[1]))
        m = /^(.+?)\s*(=)\s*(.*)$/.exec(mc[1].trim() + ' = ' + mc[2].trim());
    }
    if (!m) {
      const sp = /^(\S+)\s+(.+)$/.exec(s);
      if (sp && /(\.[^.\[\]]+|\][^.\[\]]+)$/.test(sp[1]) && sp[2].trim().length <= 60)
        m = /^(.+?)\s*(=)\s*(.*)$/.exec(sp[1] + ' = ' + sp[2].trim());
    }
    if (!m) return { raw: s, error: '命令格式错误（应为：路径 运算符 值）' };
    const path = parsePath(m[1].trim());
    if (!path) return { raw: s, error: '路径解析失败：「' + cut(m[1], 24) + '」' };
    return { raw: s, op: m[2], path: path, rawVal: m[3].trim(), value: parseVal(m[3]) };
  };

  /* ---------- 块式展开：容器行进栈, 缩进子行挂到最近容器 ----------
     LLM 常忘给子字段缩进：根在白名单的赋值行独立成命令；
     根不在白名单的赋值行挂到最近的容器路径行（哪怕没缩进）。 */
  V.expand = lines => {
    const arr = (lines || []).map(l => String(l == null ? '' : l));
    const out = [], stack = [];
    /* 漏运算符: 「路径 值」且路径以 .字段 / ] 结尾, 值 ≤60 字且不含运算符 → 视为赋值行 */
    const missingOp = body => {
      const sp = /^(\S+)\s+(.{1,60})$/.exec(body);
      return !!(sp && /(\.[^.\[\]]+|\][^.\[\]]+)$/.test(sp[1]) && !/[=＋：:]/.test(sp[2]));
    };
    const hasAssign = body => /\s*(?:\+=|-=|=)\s*\S|[：:]\s*\S/.test(body) || missingOp(body);
    const rootOf = body => { const m = /^([^.\[\]:：]+)/.exec(body); return m ? m[1].trim() : ''; };
    for (const raw of arr) {
      if (!raw.trim()) continue;
      const indent = (raw.match(/^\s*/) || [''])[0].replace(/\t/g, '    ').length;
      const body = raw.trim();
      if (!hasAssign(body)) {
        while (stack.length && stack[stack.length - 1].col >= indent) stack.pop();
        stack.push({ col: indent, path: body });
        continue;
      }
      const root = rootOf(body);
      if (ROOTS.indexOf(root) !== -1 || ALIAS_ROOT[root]) {
        while (stack.length && stack[stack.length - 1].col >= indent) stack.pop();
        out.push(body);
        continue;
      }
      if (stack.length) {
        if (indent > 0) while (stack.length && stack[stack.length - 1].col >= indent) stack.pop();
        out.push(stack.map(x => x.path).concat([body]).join('.'));
      } else {
        out.push(body);
      }
    }
    return out;
  };

  /* ---------- 白名单根 + 枚举 ---------- */
  const ROOTS = ['货币', '当前时间', '天气', '玩家位置', '属性', '角色', '生命', '气力',
    '经验', '背包', '装备', '装备详情', '技能', '光环', '天赋', '任务', '周围人物'];
  const ALIAS_ROOT = {
    所在位置: '玩家位置', 地点: '玩家位置',
    生命值: '生命', 当前生命值: '生命', 生命值上限: '生命',
    气力值: '气力', 当前气力值: '气力', 气力值上限: '气力',
    当前经验值: '经验',
    /* 用户 schema 的扁平路径: 顶层角色字段可直接作为根 */
    等级: '角色', 位阶: '角色', 职业: '角色', 战力评价: '角色',
    兵种评级: '角色', 自由属性点: '角色',
    时间: '当前时间',
    力量: '属性', 敏捷: '属性', 智力: '属性', 攻击: '属性',
    防御: '属性', 穿透: '属性', 幸运: '属性', 魅力: '属性'
  };
  /* 扁平根缺省子字段 (等级 = 角色.等级 之类的整条顶层路径) */
  const ROLE_DEFAULT = {
    等级: '等级', 位阶: '位阶', 职业: '主职业', 战力评价: '战力评价',
    兵种评级: '兵种评级', 自由属性点: '自由属性点'
  };
  const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  const ATTRS = ['力量', '敏捷', '智力', '攻击', '防御', '穿透', '魅力', '幸运'];
  const SLOTS = ['武器1', '武器2', '武器3', '武器4', '头盔', '护甲', '手套', '靴子', '项链', '戒指1', '戒指2', '特殊装备'];
  const GROUPS = { 武器: ['武器1', '武器2', '武器3', '武器4'], 防具: ['头盔', '护甲', '手套', '靴子'], 其他: ['项链', '戒指1', '戒指2', '特殊装备'] };
  const EQ_TYPES = ['武器', '防具', '其他'];
  const QUALITIES = ['白色', '绿色', '蓝色', '紫色', '金色', '红色', '黑色'];
  const ITEM_TYPES = ['装备', '消耗品', '材料', '重要物品', '工具', '信物'];
  const QUEST_TYPES = ['主线', '支线', '日常', '隐藏'];
  const NPC_ATTRS = ['当前生命值', '生命值上限', '当前气力值', '气力值上限'].concat(ATTRS);

  function ensure(obj, k, def) { if (!obj[k] || typeof obj[k] !== 'object') obj[k] = def || {}; return obj[k]; }

  /* ---------- 各根处理器 ---------- */
  const H = {};

  H.货币 = function (c) {
    const sub = segAt(c.path, 1);
    const MAP = { 铜板: '铜钱', 铜钱: '铜钱', 银两: '银两', 金锭: '金锭' };
    const key = MAP[sub];
    if (!key) throw '货币只认 铜板 / 银两 / 金锭';
    const n = num(c.value); if (n === null) throw '货币须为整数';
    const s = getState();
    if (!s.角色) s.角色 = {};
    if (!s.角色.货币 || typeof s.角色.货币 !== 'object') s.角色.货币 = { 铜钱: 0, 银两: 0, 金锭: 0 };
    const cur = s.角色.货币[key] || 0;
    const next = applyOp(cur, c.op, n);
    if (next < 0) throw '货币不足（当前 ' + cur + '）';
    s.角色.货币[key] = next;
    const d = next - cur;
    return { kind: d >= 0 ? 'gain' : 'loss', display: '货币·' + sub + ' ' + (d >= 0 ? '+' : '') + d + ' → ' + next };
  };

  H.当前时间 = function (c) {
    const s = getState();
    if (!s.日期 || typeof s.日期 !== 'object') s.日期 = { 年: 1, 月: 1, 日: 1, 时辰: '子时', 时: 0, 分: 0 };
    const sub = segAt(c.path, 1);
    if (!sub) {
      if (c.op !== '=') throw '当前时间只支持 =';
      const t = (window.VAR_MODEL && VAR_MODEL.parseTime) ? VAR_MODEL.parseTime(String(c.rawVal || '')) : null;
      if (!t) throw '时间格式应为「黑城纪年1年1月2日 08:30」或「黑城纪年1年1月2日 酉时」';
      Object.assign(s.日期, t);
      return { kind: 'time', display: '时间 → 黑城纪年' + t.年 + '年' + t.月 + '月' + t.日 + '日 ' + (t.时 != null ? pad2(t.时) + ':' + pad2(t.分 == null ? 0 : t.分) : t.时辰) };
    }
    if (c.op !== '=') throw '当前时间.' + sub + ' 只支持 =';
    if (sub === '时辰') {
      const name = String(c.value == null ? '' : c.value).trim();
      if (SHICHEN.indexOf(name.replace(/时$/, '')) < 0) throw '时辰应为 子时~亥时';
      s.日期.时辰 = name;
      const hh = (window.VAR_MODEL && VAR_MODEL.shichenToHour) ? VAR_MODEL.shichenToHour(name) : NaN;
      if (!isNaN(hh)) { s.日期.时 = hh; s.日期.分 = 0; }
      return { kind: 'time', display: '时辰 → ' + name };
    }
    const RANGE = { 年: [1, 9999], 月: [1, 12], 日: [1, 31], 时: [0, 23], 分: [0, 59] };
    const rg = RANGE[sub];
    if (!rg) throw '当前时间只有 年 / 月 / 日 / 时 / 分 / 时辰 子字段';
    const n = num(c.value); if (n === null) throw '当前时间.' + sub + ' 须为整数';
    if (n < rg[0] || n > rg[1]) throw '当前时间.' + sub + ' 越界（' + rg[0] + '~' + rg[1] + '）';
    s.日期[sub] = n;
    return { kind: 'time', display: sub + ' → ' + n };
  };

  H.天气 = function (c) {
    if (c.op !== '=') throw '天气只支持 =';
    const t = String(c.value == null ? '' : c.value).trim();
    if (!t || t.length > 12) throw '天气应为简短文本（如：阴云 / 小雨 / 雷暴）';
    getState().天气 = t;
    return { kind: 'time', display: '天气 → ' + t };
  };

  H.玩家位置 = function (c) {
    if (c.op !== '=') throw '玩家位置只支持 =';
    const t = String(c.value == null ? '' : c.value).trim();
    if (!t || t.length > 40) throw '位置应为简短文本（≤40 字）';
    getState().地点 = t;
    return { kind: 'time', display: '位置 → ' + t };
  };

  H.属性 = function (c) {
    /* 扁平根 (力量/敏捷/…) 缺省子字段 = 根名本身 */
    const sub = segAt(c.path, 1) || (ATTRS.indexOf(c.rawRoot) >= 0 ? c.rawRoot : null);
    if (ATTRS.indexOf(sub) < 0) throw '属性只认：' + ATTRS.join(' / ');
    const n = num(c.value); if (n === null) throw '属性.' + sub + ' 须为整数';
    const s = getState(); if (!s.属性 || typeof s.属性 !== 'object') s.属性 = {};
    const cur = s.属性[sub] || 0;
    const next = applyOp(cur, c.op, n);
    if (next < 0) throw '属性.' + sub + ' 不能为负（当前 ' + cur + '）';
    s.属性[sub] = next;
    const d = next - cur;
    return { kind: d >= 0 ? 'gain' : 'loss', display: sub + ' ' + (d >= 0 ? '+' : '') + d + ' → ' + next };
  };

  H.角色 = function (c) {
    let sub = segAt(c.path, 1);
    if (!sub) sub = ROLE_DEFAULT[c.rawRoot] || null;
    if (!sub) throw '角色需要子字段，如 角色.自由属性点';
    const s = getState();
    if (!s.角色 || typeof s.角色 !== 'object') s.角色 = {};
    if (sub === '等级' || sub === '经验上限') throw '等级/升级经验值由引擎自动结算——请写 经验 += 数值';
    if (sub === '位阶') {
      if (c.op !== '=') throw '位阶只支持 =';
      const RANKS = (window.VAR_MODEL && VAR_MODEL.RANKS) || [];
      const START = (window.VAR_MODEL && VAR_MODEL.START_RANKS) || [];
      const next = String(c.value == null ? '' : c.value).trim();
      if (RANKS.indexOf(next) < 0) throw '位阶须为枚举值（猎奴/黑城卫/异种 或 晋升链）';
      const old = s.角色.位阶 || next;
      /* 晋升规则: 保持不变 或 晋升一阶; 三种族初始位阶的下一阶恒为「小卒」 */
      const rankOk = old === next ||
        (START.indexOf(old) >= 0 ? next === '小卒'
          : (RANKS.indexOf(old) >= 0 && RANKS.indexOf(next) === RANKS.indexOf(old) + 1));
      if (!rankOk) throw '位阶只能晋升一阶或保持（当前 ' + old + '）';
      s.角色.位阶 = next;
      return { kind: 'rank', display: old === next ? '位阶 保持 ' + next : '位阶晋升 ' + old + ' → ' + next };
    }
    const TEXT = ['主职业', '副职业', '隐藏职业', '兵种评级', '战力评价'];
    if (TEXT.indexOf(sub) >= 0) {
      if (c.op !== '=') throw '角色.' + sub + ' 只支持 =';
      const t = String(c.value == null ? '' : c.value).trim();
      if (!t || t.length > 20) throw '角色.' + sub + ' 应为简短文本';
      s.角色[sub] = t;
      return { kind: 'rank', display: sub + ' → ' + cut(t, 16) };
    }
    const INT = { 自由属性点: 0, 灵视: 0, 疫抗: 0, 建城令: 0, 声望: -100 };
    if (INT[sub] !== undefined) {
      const n = num(c.value); if (n === null) throw '角色.' + sub + ' 须为整数';
      const cur = s.角色[sub] || 0;
      const next = applyOp(cur, c.op, n);
      if (next < INT[sub]) throw '角色.' + sub + ' 不能低于 ' + INT[sub];
      s.角色[sub] = next;
      const d = next - cur;
      return { kind: d >= 0 ? 'gain' : 'loss', display: sub + ' ' + (d >= 0 ? '+' : '') + d + ' → ' + next };
    }
    throw '未知角色字段「' + cut(sub, 12) + '」（等级/经验由引擎结算；货币请写 货币.X）';
  };

  /* 生命/气力 共用工厂 */
  function vital(root, display, map, curDef, maxDef) {
    return function (c) {
      /* 裸别名根 (生命值/当前生命值/生命值上限…) 无子字段 → 按根推断 当前/上限 */
      const raw = segAt(c.path, 1) || VITAL_DEFAULT[c.rawRoot] || VITAL_DEFAULT[c.root] || '当前';
      const key = map[raw];
      if (!key) throw root + '只认 当前 / 上限（别名 ' + Object.keys(map).join('/') + '）';
      const n = num(c.value); if (n === null) throw root + '.' + key + ' 须为整数';
      const s = getState();
      if (!s[root] || typeof s[root] !== 'object') s[root] = { 当前: curDef, 上限: maxDef };
      const cur = s[root][key] || 0;
      let next = applyOp(cur, c.op, n);
      /* 伤害语义: 超量伤害钳到 0 (受损/倒下), 不整条拒绝 */
      if (key === '当前' && next < 0) next = 0;
      if (key === '上限' && next < 0) throw root + '.上限 不能为负';
      if (key === '当前' && s[root].上限 != null && next > s[root].上限) next = s[root].上限;
      s[root][key] = next;
      const d = next - cur;
      return { kind: d >= 0 ? 'gain' : 'loss', display: display + key + ' ' + (d >= 0 ? '+' : '') + d + ' → ' + next };
    };
  }
  const VITAL_DEFAULT = { 生命: '当前', 生命值: '当前', 当前生命值: '当前', 生命值上限: '上限', 气力: '当前', 气力值: '当前', 当前气力值: '当前', 气力值上限: '上限' };
  H.生命 = vital('生命', '生命', { 当前: '当前', 生命值: '当前', 当前生命值: '当前', 上限: '上限', 生命值上限: '上限' }, 10, 10);
  H.气力 = vital('气力', '气力', { 当前: '当前', 气力值: '当前', 当前气力值: '当前', 上限: '上限', 气力值上限: '上限' }, 5, 5);

  H.经验 = function (c) {
    const n = num(c.value); if (n === null) throw '经验须为整数';
    const s = getState();
    if (!s.角色 || typeof s.角色 !== 'object') s.角色 = {};
    const cur = s.角色.经验 || 0;
    const next = applyOp(cur, c.op, n);
    if (next < 0) throw '经验不能为负';
    const lvBefore = s.角色.等级 || 0;
    s.角色.经验 = next;
    if (window.GAME_DATA && GAME_DATA.grantExp) GAME_DATA.grantExp(s, 0);   // 结算升级（含连续升级）
    const ups = (s.角色.等级 || 0) - lvBefore;
    const d = next - cur;
    return { kind: d >= 0 ? 'gain' : 'loss', display: '经验 ' + (d >= 0 ? '+' : '') + d + ' → ' + s.角色.经验 + (ups > 0 ? ' · 升级 ×' + ups : '') };
  };

  /* 背包工具: 增减一条 {id, ref, qty} */
  function bagAdd(s, name, qty) {
    if (!Array.isArray(s.背包)) s.背包 = [];
    let it = s.背包.find(b => b && b.ref === name);
    if (it) it.qty = (it.qty || 0) + qty;
    else s.背包.push({ id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ref: name, qty: qty });
    return it;
  }

  H.背包 = function (c) {
    const name = segAt(c.path, 1);
    if (!name) throw '背包需要 [物品名]，如 背包[干粮].数量';
    if (BAD_KEY(name)) throw '非法物品名';
    const FIELD_MAP = { 物品数量: '数量', 物品类型: '类型', 物品效果: '效果' };
    const field = FIELD_MAP[segAt(c.path, 2)] || segAt(c.path, 2) || '数量';
    const s = getState();
    if (!s.背包详情 || typeof s.背包详情 !== 'object') s.背包详情 = {};
    const detail = ensure(s.背包详情, name, {});

    if (field === '数量') {
      const n = num(c.value); if (n === null) throw '背包[名].数量 须为整数';
      if (!Array.isArray(s.背包)) s.背包 = [];
      let it = s.背包.find(b => b && b.ref === name);
      const cur = it ? (it.qty || 0) : 0;
      let next = applyOp(cur, c.op, n);
      /* 消耗语义: 用超量钳到 0 并移除 (喝掉最后一瓶), 不整条拒绝 */
      if (next < 0) next = 0;
      if (next === 0) {
        if (it) s.背包.splice(s.背包.indexOf(it), 1);
      } else if (it) {
        it.qty = next;
      } else {
        s.背包.push({ id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ref: name, qty: next });
      }
      return { kind: next >= cur ? 'gain' : 'loss', display: name + ' × ' + next };
    }
    if (field === '类型') {
      if (c.op !== '=') throw '背包[名].类型 只支持 =';
      const t = String(c.value == null ? '' : c.value).trim();
      if (ITEM_TYPES.indexOf(t) < 0) throw '类型只认：' + ITEM_TYPES.join(' / ');
      detail.物品类型 = t;
      return { kind: 'gain', display: name + ' 类型 → ' + t };
    }
    if (field === '效果') {
      if (c.op !== '=') throw '背包[名].效果 只支持 =';
      const t = String(c.value == null ? '' : c.value).trim();
      if (!t || t.length > 120) throw '效果应为简短文本（≤120 字）';
      detail.物品效果 = t;
      return { kind: 'gain', display: name + ' 效果已记录' };
    }
    throw '背包只有 数量 / 类型 / 效果';
  };

  H.装备 = function (c) {
    /* 装备[装备名] (方括号键) → 名称字典 = 装备详情 (用户 schema: 装备 按名建库) */
    if (c.path[1] && c.path[1].key) return H.装备详情(c);
    if (c.op !== '=') throw '装备只支持 =（卸下写 = 无）';
    const slotRaw = segAt(c.path, 1);
    if (!slotRaw) throw '装备需要槽位，如 装备.武器1 = 锈铁短刀';
    const s = getState();
    if (!s.装备 || typeof s.装备 !== 'object') s.装备 = {};
    SLOTS.forEach(k => { if (!(k in s.装备)) s.装备[k] = null; });
    const val = String(c.rawVal == null ? '' : c.rawVal).trim();
    const isUnequip = !val || val === '无' || val === 'null' || val === '卸下';
    let key = slotRaw;
    if (SLOTS.indexOf(slotRaw) < 0) {
      if (GROUPS[slotRaw]) {
        key = GROUPS[slotRaw].find(k => !s.装备[k]);
        if (!key) throw slotRaw + ' 组槽位已满，请指定具体槽位';
      } else {
        throw '未知槽位「' + cut(slotRaw, 12) + '」（可用：武器1~4/头盔/护甲/手套/靴子/项链/戒指1/戒指2/特殊装备 或 武器/防具/其他）';
      }
    }
    const old = s.装备[key];
    if (isUnequip) {
      s.装备[key] = null;
      if (old) bagAdd(s, old, 1);
      return { kind: 'loss', display: '卸下 ' + cut(old, 12) + '（' + key + '）' };
    }
    if (old && old !== val) bagAdd(s, old, 1);   // 换装: 旧装备回背包
    s.装备[key] = val;
    return { kind: 'gain', display: key + ' ← ' + cut(val, 14) };
  };

  H.装备详情 = function (c) {
    const name = segAt(c.path, 1);
    if (!name) throw '装备详情需要 [装备名]';
    if (BAD_KEY(name)) throw '非法装备名';
    const s = getState();
    if (!s.装备详情 || typeof s.装备详情 !== 'object') s.装备详情 = {};
    const d = ensure(s.装备详情, name, {});
    const f1 = segAt(c.path, 2);

    if (f1 === '耐久度') {
      const key = segAt(c.path, 3) || '当前';
      if (key !== '当前' && key !== '上限') throw '耐久度只有 当前 / 上限';
      const n = num(c.value); if (n === null) throw '耐久度.' + key + ' 须为整数';
      const cur = (d.耐久度 && d.耐久度[key]) || 0;
      const next = applyOp(cur, c.op, n);
      /* 耐久伤害语义: 当前钳到 0 (归零即破损); 上限不可为负 */
      if (key === '上限' && next < 0) throw '耐久度.上限 不能为负';
      const fin = (key === '当前' && next < 0) ? 0 : next;
      if (!d.耐久度 || typeof d.耐久度 !== 'object') d.耐久度 = {};
      d.耐久度[key] = fin;
      if (key === '当前' && d.耐久度.上限 != null && fin > d.耐久度.上限) d.耐久度.当前 = d.耐久度.上限;
      return { kind: c.op === '-=' ? 'loss' : 'gain', display: name + ' 耐久 ' + key + ' → ' + d.耐久度[key] };
    }
    if (f1 === '基础属性') {
      const attr = segAt(c.path, 3);
      if (!attr) {
        /* 基础属性 = "攻击+4，防御+2" (用户 schema 为字符串) */
        if (c.op !== '=') throw '基础属性 整串写入只支持 =';
        const t = String(c.value == null ? '' : c.value).trim();
        if (!t || t.length > 80) throw '基础属性 应为简短文本（≤80 字）';
        d.基础属性 = t;
        return { kind: 'gain', display: name + ' 基础属性已记录' };
      }
      const n = num(c.value); if (n === null) throw '基础属性.' + attr + ' 须为整数';
      const bag = ensure(d, '基础属性', {});
      const cur = bag[attr] || 0;
      const next = applyOp(cur, c.op, n);
      if (next < 0) throw '基础属性.' + attr + ' 不能为负';
      bag[attr] = next;
      return { kind: next >= cur ? 'gain' : 'loss', display: name + ' ' + attr + ' ' + (next >= cur ? '+' : '') + (next - cur) + ' → ' + next };
    }
    if (c.op !== '=') throw '装备详情.' + f1 + ' 只支持 =（耐久度/基础属性可用 += -=）';
    if (f1 === '装备类型') {
      const t = String(c.value == null ? '' : c.value).trim();
      if (EQ_TYPES.indexOf(t) < 0) throw '装备类型只认：' + EQ_TYPES.join(' / ');
      d.装备类型 = t;
      return { kind: 'gain', display: name + ' 类型 → ' + t };
    }
    if (f1 === '装备品质') {
      const t = String(c.value == null ? '' : c.value).trim();
      if (QUALITIES.indexOf(t) < 0) throw '装备品质只认：' + QUALITIES.join(' / ');
      d.装备品质 = t;
      return { kind: 'gain', display: name + ' 品质 → ' + t };
    }
    if (f1 === '精炼等级') {
      const n = num(c.value); if (n === null || n < 0 || n > 15) throw '精炼等级应为 0~15 的整数';
      d.精炼等级 = n;
      return { kind: 'gain', display: name + ' 精炼 → ' + n + ' 星' };
    }
    if (f1 === '绑定状态') {
      const b = parseBool(c.value);
      d.绑定状态 = b === null ? String(c.value == null ? '' : c.value).trim() : (b ? '已绑定' : '未绑定');
      return { kind: 'gain', display: name + ' 绑定 → ' + d.绑定状态 };
    }
    if (f1 === '等级要求') {
      const n = num(c.value); if (n === null || n < 0 || n > 999) throw '等级要求应为 0~999 的整数';
      d.等级要求 = n;
      return { kind: 'gain', display: name + ' 等级要求 → ' + n };
    }
    const TEXT = ['穿戴要求', '特效类型', '特效详情', '套装效果', '精炼材料类型'];
    if (TEXT.indexOf(f1) >= 0) {
      const t = String(c.value == null ? '' : c.value).trim();
      if (!t || t.length > 120) throw f1 + ' 应为简短文本（≤120 字）';
      d[f1] = t;
      return { kind: 'gain', display: name + ' ' + f1 + ' 已记录' };
    }
    throw '未知装备字段「' + cut(f1 || '', 12) + '」';
  };

  H.技能 = function (c) {
    const name = segAt(c.path, 1);
    if (!name) throw '技能需要 [技能名]';
    if (BAD_KEY(name)) throw '非法技能名';
    const s = getState();
    if (!s.技能详情 || typeof s.技能详情 !== 'object') s.技能详情 = {};
    const d = ensure(s.技能详情, name, { 技能等级: 1, 技能效果: '', 消耗气力: 0 });
    const FIELD_ALIAS = { 技能等级: '等级', 技能效果: '效果', 消耗气力: '消耗气力' };
    const f = FIELD_ALIAS[segAt(c.path, 2)] || segAt(c.path, 2) || '等级';
    if (f === '等级') {
      const n = num(c.value); if (n === null || n < 0 || n > 10) throw '技能等级应为 0~10 的整数';
      d.技能等级 = n;
      return { kind: 'gain', display: name + ' Lv.' + n };
    }
    if (f === '消耗气力') {
      const n = num(c.value); if (n === null || n < 0) throw '消耗气力应为 ≥0 的整数';
      d.消耗气力 = n;
      return { kind: 'gain', display: name + ' 消耗气力 ' + n };
    }
    if (f === '效果') {
      if (c.op !== '=') throw '技能[名].效果 只支持 =';
      const t = String(c.value == null ? '' : c.value).trim();
      if (!t || t.length > 160) throw '技能效果应为简短文本（≤160 字）';
      d.技能效果 = t;
      return { kind: 'gain', display: name + ' 效果已记录' };
    }
    throw '技能只有 等级 / 消耗气力 / 效果';
  };

  function dictEffect(rootKey, label) {
    return function (c) {
      const name = segAt(c.path, 1);
      if (!name) throw label + '需要 [名称]';
      if (BAD_KEY(name)) throw '非法名称';
      const s = getState();
      if (!s[rootKey] || typeof s[rootKey] !== 'object') s[rootKey] = {};
      const d = ensure(s[rootKey], name, {});
      const f = segAt(c.path, 2) || '效果';
      if (f !== '效果') throw label + '只有 效果 字段';
      if (c.op !== '=') throw label + '[名].效果 只支持 =';
      const t = String(c.value == null ? '' : c.value).trim();
      if (!t || t.length > 160) throw '效果应为简短文本（≤160 字）';
      d.效果 = t;
      return { kind: 'gain', display: name + ' 效果已记录' };
    };
  }
  H.光环 = dictEffect('光环详情', '光环');
  H.天赋 = dictEffect('天赋详情', '天赋');

  H.任务 = function (c) {
    const name = segAt(c.path, 1);
    if (!name) throw '任务需要 [任务名]';
    if (BAD_KEY(name)) throw '非法任务名';
    const s = getState();
    if (!s.任务详情 || typeof s.任务详情 !== 'object') s.任务详情 = {};
    if (!s.任务进度 || typeof s.任务进度 !== 'object') s.任务进度 = {};
    const detail = ensure(s.任务详情, name, {});
    const prog = ensure(s.任务进度, name, { cur: 0, max: 1, done: false });
    const FIELD_ALIAS = { 任务类型: '类型', 任务奖励: '奖励' };
    const f = FIELD_ALIAS[segAt(c.path, 2)] || segAt(c.path, 2) || '类型';
    if (f === '类型') {
      if (c.op !== '=') throw '任务[名].类型 只支持 =';
      const t = String(c.value == null ? '' : c.value).trim();
      if (QUEST_TYPES.indexOf(t) < 0) throw '任务类型只认：' + QUEST_TYPES.join(' / ');
      detail.任务类型 = t;
      return { kind: 'gain', display: '任务「' + cut(name, 12) + '」类型 → ' + t };
    }
    if (f === '奖励') {
      if (c.op !== '=') throw '任务[名].奖励 只支持 =';
      const t = String(c.value == null ? '' : c.value).trim();
      if (!t || t.length > 120) throw '任务奖励应为简短文本（≤120 字）';
      detail.任务奖励 = t;
      return { kind: 'gain', display: '任务「' + cut(name, 12) + '」奖励已记录' };
    }
    if (f === '进度' || f === '进度上限') {
      const n = num(c.value); if (n === null || n < 0) throw '任务' + f + '应为 ≥0 的整数';
      const key = f === '进度' ? 'cur' : 'max';
      prog[key] = n;
      if (prog.max != null && prog.cur > prog.max) prog.cur = prog.max;
      return { kind: 'gain', display: '任务「' + cut(name, 12) + '」' + f + ' → ' + n };
    }
    if (f === '完成') {
      const b = parseBool(c.value);
      if (b === null) throw '任务[名].完成 须为 是/否';
      prog.done = b;
      if (b && prog.max != null) prog.cur = prog.max;
      return { kind: 'gain', display: '任务「' + cut(name, 12) + '」' + (b ? '已完成' : '标记未完成') };
    }
    throw '任务只有 类型 / 奖励 / 进度 / 进度上限 / 完成';
  };

  H.周围人物 = function (c) {
    const name = segAt(c.path, 1);
    if (!name) throw '周围人物需要 [人名]';
    if (BAD_KEY(name)) throw '非法人名';
    const s = getState();
    if (!s.周围人物 || typeof s.周围人物 !== 'object') s.周围人物 = {};
    const d = ensure(s.周围人物, name, { 等级: 1, 属性: {}, 好感度: 0 });
    const f1 = segAt(c.path, 2) || '外貌';

    if (f1 === '好感度') {
      const n = num(c.value); if (n === null) throw '好感度须为整数';
      const cur = d.好感度 || 0;
      const next = Math.max(-100, Math.min(100, applyOp(cur, c.op, n)));
      d.好感度 = next;
      return { kind: next >= cur ? 'gain' : 'loss', display: name + ' 好感度 ' + (next >= cur ? '+' : '') + (next - cur) + ' → ' + next };
    }
    if (f1 === '等级') {
      const n = num(c.value); if (n === null || n < 0 || n > 100) throw 'NPC 等级应为 0~100 的整数';
      d.等级 = n;
      return { kind: 'gain', display: name + ' 等级 → ' + n };
    }
    if (f1 === '属性') {
      const attrRaw = segAt(c.path, 3);
      if (!attrRaw) {
        /* 属性 = 简述文本 (用户 schema: 属性为字符串, 如「力量型, 身负轻伤」) */
        if (c.op !== '=') throw '周围人物[名].属性 整串写入只支持 =';
        const t = String(c.value == null ? '' : c.value).trim();
        if (!t || t.length > 120) throw '属性 应为简短文本（≤120 字）';
        d.属性 = t;
        return { kind: 'gain', display: name + ' 属性已记录' };
      }
      const AMAP = { 生命值: '当前生命值', 当前生命值: '当前生命值', 生命值上限: '生命值上限', 气力值: '当前气力值', 当前气力值: '当前气力值', 气力值上限: '气力值上限' };
      const attr = AMAP[attrRaw] || attrRaw;
      if (NPC_ATTRS.indexOf(attr) < 0) throw 'NPC 属性只认：' + NPC_ATTRS.join(' / ');
      const n = num(c.value); if (n === null) throw '属性.' + attrRaw + ' 须为整数';
      const bag = ensure(d, '属性', {});
      const cur = bag[attr] || 0;
      let next = applyOp(cur, c.op, n);
      /* NPC 生命/气力伤害钳到 0; 其余属性不可为负 */
      if (/^当前/.test(attr) && next < 0) next = 0;
      if (!/^当前/.test(attr) && next < 0) throw '属性.' + attrRaw + ' 不能为负';
      bag[attr] = next;
      return { kind: next >= cur ? 'gain' : 'loss', display: name + ' ' + attrRaw + ' ' + (next >= cur ? '+' : '') + (next - cur) + ' → ' + next };
    }
    const TEXT = ['外貌', '装备', '内心想法'];
    if (TEXT.indexOf(f1) >= 0) {
      if (c.op !== '=') throw '周围人物[名].' + f1 + ' 只支持 =';
      const t = String(c.value == null ? '' : c.value).trim();
      if (!t || t.length > 120) throw f1 + ' 应为简短文本（≤120 字）';
      d[f1] = t;
      return { kind: 'gain', display: name + ' ' + f1 + ' 已记录' };
    }
    throw '未知人物字段「' + cut(f1, 12) + '」（可选：等级/外貌/装备/内心想法/好感度/属性.X）';
  };

  /* ---------- 执行 + 批量 ---------- */
  V.exec = cmd => {
    if (cmd.error) return { ok: false, raw: cmd.raw, error: cmd.error };
    let root = cmd.path[0] && cmd.path[0].seg;
    if (!root) return { ok: false, raw: cmd.raw, error: '路径解析失败' };
    root = ALIAS_ROOT[root] || root;
    if (ROOTS.indexOf(root) < 0) return { ok: false, raw: cmd.raw, error: '未知变量根「' + cut(root, 12) + '」' };
    const s = getState();
    if (!s || typeof s !== 'object') return { ok: false, raw: cmd.raw, error: '游戏状态未就绪' };
    try {
      const r = H[root]({ root: root, rawRoot: cmd.path[0] && (cmd.path[0].seg || cmd.path[0].key), path: cmd.path, op: cmd.op, value: c_val(cmd), rawVal: cmd.rawVal });
      return { ok: true, raw: cmd.raw, kind: r.kind, display: r.display };
    } catch (e) {
      return recoverDeep(cmd, { ok: false, raw: cmd.raw, error: String((e && e.message) || e) });
    }
  };

  /* ---------- 深段回切: 弱模型把 时间/位置/天气 写进其它根的容器块 ----------
     如「装备详情.X.当前时间 = …」→ 失败后扫描路径深段, 找到白名单根则以该根
     重新执行尾部命令（模型的本意）。全部失败才返回原错误。 */
  function recoverDeep(cmd, r0) {
    for (let i = 1; i < cmd.path.length; i++) {
      const seg = cmd.path[i].seg || cmd.path[i].key;
      if (!seg || BAD_KEY(seg)) continue;
      const target = ALIAS_ROOT[seg] || (ROOTS.indexOf(seg) >= 0 ? seg : null);
      if (!target) continue;
      try {
        const r = H[target]({ root: target, path: cmd.path.slice(i), op: cmd.op, value: c_val(cmd), rawVal: cmd.rawVal });
        return { ok: true, raw: cmd.raw, kind: r.kind, display: r.display, recovered: true };
      } catch (e2) { /* 尝试下一个深段 */ }
    }
    return r0;
  }
  function c_val(cmd) { return cmd.value; }

  /* ---------- 噪声过滤: 弱模型会把说明文字/泄漏标签写进 <set>, 静默丢弃 ----------
     候选命令 = 显式运算符行 / 冒号赋值形状 / 缺运算符形状 / 纯路径(容器)行 */
  V.isNoise = line => {
    const s = String(line == null ? '' : line).trim();
    if (!s) return true;
    if (/^<\//.test(s) || /^<[a-zA-Z]/.test(s)) return true;                 // 泄漏的标签
    if (/^[（\u201c"']/.test(s)) return true;                                // 以引号/括号开头的说明文字
    if (/\+=|-=|=/.test(s)) return false;                                   // 显式运算符 → 命令候选
    if (!/\s/.test(s) && !/[。！？!?，、；：]/.test(s)) return false;        // 纯路径行 → 可能是容器
    if (/[。！？!?]/.test(s)) return true;                                  // 含句读 → 散文
    if (/(\.[^.\[\]]+|\][^.\[\]]+)\s*[：:]\s*\S/.test(s)) return false;  // 冒号赋值形状
    const sp = /^(\S+)\s+(.{1,60})$/.exec(s);
    if (sp && /(\.[^.\[\]]+|\][^.\[\]]+)$/.test(sp[1])) return false;     // 缺运算符形状
    return true;                                                           // 其余视为散文
  };

  V.run = commands => {
    const ok = [], fail = [];
    V.expand((commands || []).filter(line => !V.isNoise(line))).forEach(line => {
      const cmd = V.parse(line);
      if (!cmd) return;
      const r = V.exec(cmd);
      (r.ok ? ok : fail).push(r);
    });
    return { ok: ok, fail: fail };
  };

  /* ---------- 反馈：弹幕 + 失败弹窗（挂载一次） ---------- */
  V.mount = () => {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('modalVarFail')) {
      const m = document.createElement('div');
      m.className = 'modal-layer';
      m.id = 'modalVarFail';
      m.setAttribute('role', 'dialog');
      m.setAttribute('aria-modal', 'true');
      m.innerHTML =
        '<div class="modal-backdrop" data-close-modal="modalVarFail"></div>' +
        '<div class="modal" style="width:min(92vw,460px)">' +
          '<div class="modal-head">' +
            '<span class="mh-icon" data-icon="alert"></span>' +
            '<div style="flex:1"><h3 id="varFailTitle">变量更新失败</h3><div class="sub">命令未通过白名单或语法校验</div></div>' +
            '<button class="icon-btn" data-close-modal="modalVarFail" aria-label="关闭"><span data-icon="x"></span></button>' +
          '</div>' +
          '<div class="modal-body"><ul class="varfail-list" id="varFailList"></ul></div>' +
        '</div>';
      document.body.appendChild(m);
      if (window.ICON_HYDRATE) window.ICON_HYDRATE(m);
    }
  };

  V.show = res => {
    res = res || { ok: [], fail: [] };
    const layer = document.getElementById('danmakuLayer');
    res.ok.forEach((r, i) => {
      const cls = r.kind === 'rank' ? 'is-rank' : r.kind === 'loss' ? 'is-loss' : r.kind === 'gain' ? 'is-gain' : '';
      if (danmakuFn) { danmakuFn(r.display, cls); return; }
      if (!layer) return;
      const el = document.createElement('div');
      el.className = 'danmaku-item' + (cls ? ' ' + cls : '');
      el.textContent = r.display;
      el.style.top = (12 + (i % 6) * 40) + 'px';
      layer.appendChild(el);
      setTimeout(() => el.remove(), 8000);
    });
    if (res.fail.length) {
      const list = document.getElementById('varFailList');
      if (list) {
        list.innerHTML = res.fail.map(f => '<li><code>' + esc(f.raw) + '</code><em>' + esc(f.error) + '</em></li>').join('');
        const t = document.getElementById('varFailTitle');
        if (t) t.textContent = '变量更新失败（' + res.fail.length + ' 条）';
        if (window.__APP && __APP.openModal) __APP.openModal('modalVarFail');
      }
    }
    if (typeof renderForKinds === 'function') return;   // 渲染由 app.js renderAll 统一处理
  };

  V.parseCommand = line => V.parse(line);
  V.isWhitelisted = cmd => !!cmd && !cmd.error && ROOTS.indexOf(cmd.path && cmd.path[0] && (cmd.path[0].seg || cmd.path[0].key)) >= 0;

  window.VARS = V;
})();
