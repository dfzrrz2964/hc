/* ============================================================
   黑城残响 · 核心应用逻辑 (Part 1)
   状态管理 / 渲染层 / 模态 / 通知 / 编年史 / 战力榜 / 存档
   ============================================================ */
(function () {
  "use strict";

  const GD = window.GAME_DATA;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  /* ---------- 会话状态 ---------- */
  let state = GD.defaultStat();
  let chronicle = GD.CHRONICLE_SEED.slice();
  let lastAI = null;            // 最近一条 AI 消息元素
  let lastRaw = "";             // 最近一次协议原文
  let lastOptions = [];         // 当前可用选项
  let engineBusy = false;
  let typeJob = null;           // 打字机句柄
  let currentNpc = null;        // 当前对话 NPC id
  let unreadChronicle = false;
  let memoryMeta = [];          // 记忆分层: 按剧情区 AI 消息序数对齐的 {small, large}
  let worldSnaps = [];          // 世界快照: 每条 AI 回复自动打点 (退档用, 上限 30)

  const SETTINGS_KEY = "hce.settings";
  const SAVE_PREFIX = "hce.save.";          // 多槽位存档前缀: hce.save.<id>
  const LEGACY_SAVE_KEY = "hce.save.v1";    // 旧版单槽存档(迁移用)
  let currentSaveId = null;                 // 当前激活的存档槽 id

  const MEMORY_DEFAULT = { enabled: true, layers: 6, largeStart: 14 };
  const settings = Object.assign(
    { theme: "ink", speed: 3, fontSize: 15.5, typewriter: false, autosave: true, audio: false,
      ai: { enabled: false, baseUrl: "", apiKey: "", model: "", lorebook: true, preset: "" } },
    (function () { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } })()
  );
  // 兼容旧存档: ai 子对象浅合并
  settings.ai = Object.assign({ enabled: false, baseUrl: "", apiKey: "", model: "", lorebook: true, preset: "" }, settings.ai || {});
  // 记忆分层配置 (旧档补默认)
  settings.memory = Object.assign({}, MEMORY_DEFAULT, settings.memory || {});
  // 流式传输总开关 (旧版 typewriter 升级迁移)
  if (settings.streaming === undefined) settings.streaming = !!settings.typewriter;

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function uid() { return "it" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[rnd(arr.length)]; }

  /* ---------- 通知系统 (内部) ---------- */
  function toast(type, title, msg, dur) {
    const box = $("#toastContainer");
    const el = document.createElement("div");
    el.className = "toast " + type;
    const iconMap = { success: "check-circle", warn: "alert", error: "alert", info: "info" };
    el.innerHTML =
      '<span class="t-icon">' + window.ICON(iconMap[type] || "info") + "</span>" +
      '<span class="t-body"><span class="t-title">' + esc(title) + "</span>" +
      (msg ? '<span class="t-msg">' + esc(msg) + "</span>" : "") + "</span>" +
      '<i class="t-progress"></i>';
    const t = dur || (type === "error" ? 5200 : type === "warn" ? 4200 : 3400);
    el.style.setProperty("--t-dur", t + "ms");
    box.appendChild(el);
    const kill = function () {
      if (el.classList.contains("leaving")) return;
      el.classList.add("leaving");
      setTimeout(function () { el.remove(); }, 320);
    };
    el.addEventListener("click", kill);
    setTimeout(kill, t);
    return el;
  }
  window.__toast = toast;

  /* ---------- 变量更新弹幕: 从右往左飘过 ---------- */
  const danmakuLanes = []; // 记录每条弹幕的 top, 避免重叠
  function danmaku(text, cls) {
    const layer = $("#danmakuLayer");
    if (!layer) return;
    const el = document.createElement("div");
    el.className = "danmaku-item" + (cls ? " " + cls : "");
    el.textContent = text;
    // 取一条空闲轨道 (top 值), 6 条轨道轮换, 同轨道已有弹幕则顺延
    const laneCount = 6;
    let lane = 0;
    const now = Date.now();
    for (let i = 0; i < laneCount; i++) {
      if (!danmakuLanes[i] || now - danmakuLanes[i] > 4000) { lane = i; break; }
      lane = (lane + 1) % laneCount;
    }
    danmakuLanes[lane] = now;
    const dur = Math.max(5, Math.min(9, 5 + text.length * 0.04));
    el.style.setProperty("--t-dur", dur + "s");
    el.style.top = (12 + lane * 40) + "px";
    layer.appendChild(el);
    el.addEventListener("animationend", function () { el.remove(); });
    // 上限保护: 最多 30 条
    while (layer.children.length > 30) layer.firstChild.remove();
  }
  window.__danmaku = danmaku;

  /* ---------- 模态管理 ---------- */
  const openModals = [];
  function openModal(id) {
    const layer = $("#" + id);
    if (!layer) return;
    layer.classList.add("is-open");
    openModals.push(id);
    document.body.style.overflow = "hidden";
    // 标题画面可见时, 降低其层级让模态框浮于其上
    const ts = $("#titleScreen");
    if (ts && ts.classList.contains("is-visible")) ts.classList.add("is-under-modal");
    const f = layer.querySelector("button, [tabindex]");
    if (f) setTimeout(function () { f.focus(); }, 60);
  }
  function closeModal(id) {
    const layer = $("#" + id);
    if (!layer) return;
    layer.classList.remove("is-open");
    const i = openModals.indexOf(id);
    if (i >= 0) openModals.splice(i, 1);
    if (!openModals.length) {
      document.body.style.overflow = "";
      // 全部模态关闭后恢复标题画面层级
      const ts = $("#titleScreen");
      if (ts) ts.classList.remove("is-under-modal");
    }
    // 关闭创建向导且尚未开始任何游戏 → 回到标题画面
    if (id === "modalCreate" && !currentSaveId) {
      const ts2 = $("#titleScreen");
      if (ts2) ts2.classList.add("is-visible");
    }
  }
  function closeTopModal() { if (openModals.length) closeModal(openModals[openModals.length - 1]); }

  /* 通用确认框 */
  function confirmDialog(opts) {
    $("#confirmTitle").textContent = opts.title || "确认";
    $("#confirmBody").innerHTML = opts.body || "";
    $("#confirmIcon").innerHTML = window.ICON(opts.icon || "alert");
    const ok = $("#confirmOkBtn");
    ok.textContent = opts.okText || "确认";
    ok.className = "btn " + (opts.danger ? "btn-danger" : "btn-primary");
    openModal("modalConfirm");
    return new Promise(function (resolve) {
      ok.onclick = function () { closeModal("modalConfirm"); resolve(true); };
      ok.onclose = null;
      const layer = $("#modalConfirm");
      const old = layer._okHandler;
      layer._okHandler = ok.onclick;
      layer.querySelectorAll("[data-close-modal='modalConfirm']").forEach(function (b) {
        b.onclick = function () { closeModal("modalConfirm"); resolve(false); };
      });
    });
  }

  /* ---------- 格式化 ---------- */
  /* 天干地支纪年: 60 甲子循环 (1 → 甲子) */
  const GAN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
  const ZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  function ganZhiYear(y) {
    const i = ((Number(y) || 1) - 1) % 60;
    return GAN[i % 10] + ZHI[i % 12] + "年";
  }
  function fmtDate(d) {
    const MONTHS = ["正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月"];
    return "第" + d.年 + "年（" + ganZhiYear(d.年) + "） " + (MONTHS[d.月 - 1] || d.月 + "月") + " " + (d.日 < 10 ? "初" + "一二三四五六七八九十"[d.日 - 1] : d.日 + "日");
  }
  /* 十二时辰 + 24 小时制时钟 (如 酉时 · 18:30) */
  function fmtClock(d) {
    if (!d) return "";
    const parts = [];
    if (d.时辰) parts.push(d.时辰);
    if (d.时 != null) parts.push(("0" + d.时).slice(-2) + ":" + ("0" + (d.分 != null ? d.分 : 0)).slice(-2));
    return parts.join(" · ");
  }
  function fmtMoney(m) {
    const parts = [];
    if (m.铜钱) parts.push(m.铜钱 + " 铜板");
    if (m.银两) parts.push(m.银两 + " 银两");
    if (m.金锭) parts.push(m.金锭 + " 金锭");
    return parts.join(" · ") || "身无分文";
  }
  function powerLabel(R) {
    const L = (R && R.等级) || 0;
    if (L >= 20) return "名动一方";
    if (L >= 15) return "声名鹊起";
    if (L >= 10) return "小有名气";
    if (L >= 6) return "崭露头角";
    if (L >= 3) return "初出茅庐";
    if (L >= 1) return "低下";
    return "极低";
  }
  /* 装备品质: 兼容规范枚举 (白色/绿色/蓝色/紫色/金色/红色/黑色) 与内部 id (common/fine/...) */
  const QUALITY_CN = { 白色: "common", 绿色: "fine", 蓝色: "rare", 紫色: "legend", 金色: "epic", 红色: "myth", 黑色: "cursed" };
  function qualityKey(q) { return QUALITY_CN[q] || q; }
  function qualityColor(q) {
    q = qualityKey(q);
    return (GD.QUALITY_COLOR && GD.QUALITY_COLOR[q]) || "#b9b6ac";
  }
  function qualityLabel(q) {
    q = qualityKey(q);
    return (GD.QUALITY_LABEL && GD.QUALITY_LABEL[q]) || String(q || "普通");
  }

  /* LLM 动态详情合并: 背包详情 + 装备详情 (装备详情优先) */
  function dynInfo(ref) {
    const a = (state.背包详情 && state.背包详情[ref]) || null;
    const b = (state.装备详情 && state.装备详情[ref]) || null;
    return (a || b) ? Object.assign({}, a || {}, b || {}) : null;
  }

  /* 装备类型归一: 只有 武器/防具/其他 三种 (由槽位键/部位/物品类型推导) */
  const SLOT_GROUP = {
    "武器": "武器", "武器1": "武器", "武器2": "武器", "武器3": "武器", "武器4": "武器",
    "防具": "防具", "头盔": "防具", "护甲": "防具", "手套": "防具", "靴子": "防具",
    "其他": "其他", "项链": "其他", "戒指": "其他", "戒指1": "其他", "戒指2": "其他", "特殊装备": "其他"
  };
  function gearGroupOf(it) {
    if (!it) return null;
    const raw = it.group || it.slot || it.槽位 || it.装备部位 || it.装备类型 || it.type;
    return SLOT_GROUP[raw] || null;
  }

  /* 物品悬浮/标题统一格式: 装备 = 「名字 · 类型(武器/防具/其他) · 品质」, 非装备 = 名字 */
  function gearTitle(it) {
    if (!it) return "";
    const grp = gearGroupOf(it);
    return grp ? it.name + " · " + grp + " · " + qualityLabel(it.quality) : it.name;
  }

  /* 物品统一解析: 物品库基础 + LLM 动态详情 (背包详情/装备详情, 变量规范 §二/§四)
     LLM 新增物品不在 GD.ITEMS 中时, 由背包/详情生成可展示对象, 避免「物品不存在」 */
  function itemInfo(ref) {
    if (!ref) return null;
    const base = GD.ITEMS[ref] || null;
    const dyn = dynInfo(ref);
    if (!base && !dyn) return null;
    const it = {};
    Object.keys(base || {}).forEach(function (k) { it[k] = base[k]; });
    Object.keys(dyn || {}).forEach(function (k) {
      if (dyn[k] !== undefined && dyn[k] !== null) it[k] = dyn[k];
    });
    if (!it.name) it.name = ref;
    if (!it.type) it.type = (dyn && dyn.物品类型) || "材料";
    if (!it.icon) it.icon = "gem";
    // LLM 动态详情字段映射: 槽位/装备部位 → 可穿戴位置, 基础属性 → attrs (未知物品也可渲染/穿戴)
    if (!it.slot && dyn) it.slot = dyn.槽位 || dyn.装备部位 || dyn.slot;
    if (!it.attrs && dyn && dyn.基础属性 && typeof dyn.基础属性 === "object") it.attrs = dyn.基础属性;
    if (dyn && dyn.装备品质) it.quality = dyn.装备品质;
    if (!it.quality) it.quality = "common";
    if (!it.desc && dyn && dyn.物品效果) it.desc = dyn.物品效果;
    // 耐久度归一化: 装备详情.耐久度 (对象 {当前,上限} / "45/45" / 数值) → durability/maxDura
    // 可穿戴物品缺省 100/100, 保证所有装备都有耐久度
    if (dyn && dyn.耐久度 != null) {
      const dd = dyn.耐久度;
      if (typeof dd === "object" && dd !== null) {
        it.durability = dd.当前 != null ? dd.当前 : dd.cur;
        it.maxDura = dd.上限 != null ? dd.上限 : dd.max;
      } else if (typeof dd === "string" && /^\d+\s*\/\s*\d+$/.test(dd.trim())) {
        const mm = dd.trim().split("/");
        it.durability = +mm[0]; it.maxDura = +mm[1];
      } else if (typeof dd === "number") {
        it.durability = dd; it.maxDura = (it.maxDura != null ? it.maxDura : dd);
      }
    }
    if ((it.slot || it.槽位 || it.装备部位) && it.durability == null) { it.durability = 100; it.maxDura = 100; }
    if (it.durability != null && it.maxDura == null) it.maxDura = Math.max(it.durability, 1);
    // 装备类型归一: 装备一律归类为 武器/防具/其他 之一 (显示格式: 装备名 + 类型 + 品质)
    const grp = gearGroupOf(it);
    if (grp) it.group = grp;
    return it;
  }
  /* LLM 动态详情中规范字段 → 附加展示行 (穿戴要求/基础属性/耐久/精炼/镶嵌/绑定 由主渲染处理, 不重复) */
  function dynStatRows(dyn) {
    if (!dyn) return "";
    const rows = [];
    function push(k, v) {
      if (v === undefined || v === null || v === "") return;
      const val = (typeof v === "object" && !Array.isArray(v))
        ? Object.keys(v).map(function (x) { return x + " " + v[x]; }).join(" · ")
        : (Array.isArray(v) ? v.join("、") : String(v));
      rows.push('<div class="item-stat"><span class="k">' + A.esc(k) + '</span><span class="v">' + A.esc(val) + "</span></div>");
    }
    push("特效类型", dyn.特效类型);
    push("特效详情", dyn.特效详情);
    push("套装效果", dyn.套装效果);
    push("精炼材料类型", dyn.精炼材料类型);
    if (dyn.物品效果 && (!dyn.物品类型 || dyn.物品类型 !== "装备")) push("物品效果", dyn.物品效果);
    return rows.length ? '<div class="item-stats">' + rows.join("") + "</div>" : "";
  }

  /* ============================================================
     渲染层
     ============================================================ */

  /* ---- 顶部栏 ---- */
  function renderTop() {
    // 手机状态条 (≤760px 可见): 时间 + 地点/天气
    const msC = $("#msClock"); if (msC) msC.textContent = A.fmtDate(state.日期) + " · " + A.fmtClock(state.日期);
    const msL = $("#msLoc"); if (msL) msL.textContent = (state.地点 || "未知") + " · " + (state.天气 || "");
    $("#chipClockVal").textContent = fmtDate(state.日期);
    $("#chipTimeVal").textContent = fmtClock(state.日期);
    $("#chipLocationVal").textContent = state.地点;
    $("#chipWeatherVal").textContent = state.天气;
  }

  /* ---- 左栏: 身份 / 生命 / 属性 / 背包 ---- */
  function renderIdentity() {
    const R = state.角色;
    $("#idName").textContent = R.姓名;
    $("#idClass").textContent = "主职业: " + (R.主职业 || "无");
    $("#idSub").textContent = "副职业: " + (R.副职业 || "无");
    $("#chipRankTitle").textContent = "位阶: " + (R.位阶 || "猎奴");
    $("#chipRank").textContent = "战力:" + (R.战力评价 || "极低") + " · 兵种:" + (R.兵种评级 || "无");
    $("#chipPower").textContent = "等级:" + R.等级;
    $("#levelSeal").textContent = R.等级;
  }

  function renderVitals() {
    const hp = state.生命, st = state.气力, R = state.角色;
    const eq = equipBonus();
    const hpMax = hp.上限 + (eq.生命 || 0);
    const stMax = st.上限 + (eq.气力 || 0);
    $("#hpVal").textContent = hp.当前; $("#hpMax").textContent = hpMax;
    $("#staminaVal").textContent = st.当前; $("#staminaMax").textContent = stMax;
    $("#expVal").textContent = (GD.经验百分比(R.经验, R.经验上限)) + "%";
    $("#expMax").textContent = R.经验上限;
    $("#barHPFill").style.width = Math.max(0, Math.min(100, hp.当前 / hpMax * 100)) + "%";
    $("#barHP").classList.toggle("low", hp.当前 / hpMax < 0.3);
    $("#barStaminaFill").style.width = Math.max(0, Math.min(100, st.当前 / stMax * 100)) + "%";
    $("#barExpFill").style.width = Math.max(0, Math.min(100, R.经验 / R.经验上限 * 100)) + "%";
    // 货币 (角色.货币: 铜钱/银两/金锭)
    const m = R.货币 || {};
    const mParts = [];
    if (m.铜钱) mParts.push(m.铜钱 + " 铜板");
    if (m.银两) mParts.push(m.银两 + " 银两");
    if (m.金锭) mParts.push(m.金锭 + " 金锭");
    const mv = $("#moneyVal");
    if (mv) mv.textContent = mParts.join(" · ") || "身无分文";
  }

  const ATTR_ICONS = { 力量: "sword", 敏捷: "wind", 智力: "brain", 攻击: "zap", 防御: "shield", 穿透: "crosshair", 魅力: "star", 幸运: "dice" };
  const ATTR_MAX = { 力量: 30, 敏捷: 30, 智力: 30, 攻击: 30, 防御: 30, 穿透: 30, 魅力: 30, 幸运: 30 };

  /* 已穿戴装备属性加成合计 (attrs / 装备详情.基础属性): 面板显示 = 基础值 + 装备加成
     耐久归零的破损装备不提供加成 */
  const BONUS_KEYS = ["力量", "敏捷", "智力", "攻击", "防御", "穿透", "幸运", "魅力", "生命", "气力"];
  function equipBonus() {
    const out = {};
    const gear = state.装备 || {};
    Object.keys(gear).forEach(function (slot) {
      const ref = gear[slot];
      if (!ref) return;
      const it = itemInfo(ref);
      if (!it) return;
      if (it.durability != null && it.maxDura != null && it.durability <= 0) return; // 破损无加成
      const attrs = (it.attrs && typeof it.attrs === "object") ? it.attrs
        : (it.基础属性 && typeof it.基础属性 === "object") ? it.基础属性 : null;
      if (!attrs) return;
      Object.keys(attrs).forEach(function (k) {
        if (BONUS_KEYS.indexOf(k) >= 0 && typeof attrs[k] === "number") out[k] = (out[k] || 0) + attrs[k];
      });
    });
    return out;
  }

  function renderAttrs(target, allocMode) {
    const grid = $(target);
    if (!grid) return;
    const A = state.属性;
    const fp = state.角色.自由属性点 || 0;
    const eq = allocMode ? {} : equipBonus();
    grid.innerHTML = Object.keys(A).map(function (k) {
      const v = A[k];
      const b = eq[k] || 0;
      const total = v + b;
      const pct = Math.max(6, Math.min(100, total / ATTR_MAX[k] * 100));
      const ctrl = allocMode
        ? '<span class="a-ctrl">' +
          '<button class="mini-btn" data-attr-dec="' + k + '" aria-label="减少">' + window.ICON("minus", 10) + "</button>" +
          '<button class="mini-btn" data-attr-inc="' + k + '" aria-label="增加">' + window.ICON("plus", 10) + "</button></span>"
        : "";
      return '<div class="attr-cell' + (fp > 0 && allocMode ? " is-alloc" : "") + '" data-attr="' + k + '">' +
        '<div class="a-head"><span class="a-name">' + window.ICON(ATTR_ICONS[k] || "star") + k + '</span>' +
        '<span class="a-val">' + v + (b > 0 ? '<em class="a-bonus" title="装备加成">+' + b + "</em>" : "") + "</span></div>" + ctrl +
        '<div class="a-bar"><i style="width:' + pct + '%"></i></div></div>';
    }).join("");
    $("#freePtsVal").textContent = fp;
    $("#freePts").classList.toggle("has-pts", fp > 0 && allocMode);
  }

  function renderInvSummary() {
    const bag = state.背包 || [];
    $("#invCount").textContent = bag.length + "/20";
    const grid = $("#invGrid");
    const shown = bag.slice(0, 8);
    grid.innerHTML = shown.map(function (b) {
      const it = itemInfo(b.ref) || { name: b.ref, icon: "gem", quality: "common" };
      return '<button class="inv-slot q-border" data-item="' + esc(b.ref) + '" data-bag="1" title="' + esc(gearTitle(itemInfo(b.ref) || { name: b.ref })) + '" style="--qc:' + qualityColor(it.quality) + '">' +
        window.ICON(it.icon) + (b.qty > 1 ? '<span class="count">' + b.qty + "</span>" : "") + "</button>";
    }).join("");
    if (!shown.length) grid.innerHTML = '<span class="empty-state es-small" style="padding:14px 4px; grid-column:1/-1"><span class="es-icon">' + window.ICON("backpack") + '</span><span class="es-title" style="font-size:11px">背囊空空</span></span>';
    window.ICON_HYDRATE(grid);
  }

  /* ---- 右栏面板 ---- */
  /* 华夏舆图 · 中国地图 (数据源: js/china-map.js) */
  let CN_VIEW = null; // { minX, minY, w, h } 由数据包围盒动态计算

  function computeChinaView() {
    const regions = ((window.CHINA_MAP && window.CHINA_MAP.main_regions) || []).concat(
      (window.CHINA_MAP && window.CHINA_MAP.sub_regions) || []);
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    regions.forEach(function (r) {
      (r.points || []).forEach(function (p) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      });
    });
    if (minX > maxX) { minX = 0; minY = 0; maxX = 3200; maxY = 4000; }
    const padX = (maxX - minX) * 0.035, padY = (maxY - minY) * 0.05;
    return { minX: minX - padX, minY: minY - padY, w: (maxX - minX) + padX * 2, h: (maxY - minY) + padY * 2 };
  }

  function ensureChinaView() { if (!CN_VIEW) CN_VIEW = computeChinaView(); return CN_VIEW; }

  /* 当前视图 (缩放): { x, y, w, h }; null = 全图 */
  let mapView = null;

  function mapViewFull() {
    const v = ensureChinaView();
    return { x: v.minX, y: v.minY, w: v.w, h: v.h };
  }

  function mapPos(x, y) {
    const v = mapView || (mapView = mapViewFull());
    return { left: ((x - v.x) / v.w * 100) + "%", top: ((y - v.y) / v.h * 100) + "%" };
  }

  let CN_SVG_CACHE = null; // 静态地图 SVG 只生成一次,避免重复拼接 2000+ 点

  function chinaSvg() {
    if (CN_SVG_CACHE) return CN_SVG_CACHE;
    const v = ensureChinaView();
    const CM = window.CHINA_MAP || { main_regions: [], sub_regions: [] };
    let s = '<svg class="map-svg" viewBox="' + v.minX + " " + v.minY + " " + v.w + " " + v.h + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">';
    (CM.main_regions || []).forEach(function (r) {
      s += '<path class="cn-region cn-main" d="M' + (r.points || []).map(function (p) { return p[0] + " " + p[1]; }).join(" L") + ' Z"/>';
    });
    (CM.sub_regions || []).forEach(function (r) {
      const d = (r.points || []).map(function (p) { return p[0] + " " + p[1]; }).join(" L");
      if (!d) return;
      s += '<path class="cn-region cn-sub" fill="' + esc(r.color || "#8a8578") + '" d="M' + d + ' Z">' +
        (r.name ? "<title>" + esc(r.name) + "</title>" : "") + "</path>";
    });
    (CM.points_of_interest || []).forEach(function (c) {
      // 可点击城市圆点: 可见小圆点 + 放大的透明命中区 (悬停出现光晕, 点击查情报)
      s += '<circle class="cn-poi" cx="' + c.x + '" cy="' + c.y + '" r="4"></circle>';
      s += '<circle class="cn-poi-hit" cx="' + c.x + '" cy="' + c.y + '" r="13" data-node="' + esc(c.name) + '"><title>' + esc(c.name) + (c.sub_region ? " · " + esc(c.sub_region) : "") + "</title></circle>";
    });
    s += "</svg>";
    CN_SVG_CACHE = s;
    return s;
  }

  function renderMap() {
    const c = $("#mapCanvas");
    if (!c) return;
    // 地图在独立弹窗内: 仅在弹窗打开时渲染 (renderAll 高频调用, 避免无谓重建)
    const modal = $("#modalPanelMap");
    if (!modal || !modal.classList.contains("is-open")) return;
    ensureChinaView();
    // 静态地图 SVG 只构建一次(2000+ 点,重建成本高);之后仅刷新视图与标记层
    if (!c.querySelector(".map-svg")) {
      c.innerHTML = chinaSvg();
    }
    if (!mapView) mapView = mapViewFull();
    mapApplyView();
  }

  /* 缩放: 以地图坐标 (mx,my) 为锚点, factor < 1 放大 / > 1 缩小 */
  function mapZoomAt(mx, my, factor) {
    const full = mapViewFull();
    if (!mapView) mapView = full;
    const minW = full.w * 0.16;                       // 最大放大 ~6 倍
    const w = Math.min(full.w, Math.max(minW, mapView.w * factor));
    const h = w * (full.h / full.w);                  // 保持全图宽高比
    const rx = (mx - mapView.x) / mapView.w;
    const ry = (my - mapView.y) / mapView.h;
    let x = mx - rx * w, y = my - ry * h;
    x = Math.max(full.x, Math.min(full.x + full.w - w, x));
    y = Math.max(full.y, Math.min(full.y + full.h - h, y));
    mapView = { x: x, y: y, w: w, h: h };
    mapApplyView();
  }

  /* 把当前视图写入 SVG viewBox 并重算标记层百分比 */
  function mapApplyView() {
    const svg = document.querySelector("#mapCanvas .map-svg");
    if (svg && mapView) svg.setAttribute("viewBox", mapView.x + " " + mapView.y + " " + mapView.w + " " + mapView.h);
    renderMapMarker();
  }

  /* 当前位置标记层 (无城市名地标, 仅金色脉动点; 缩放后按当前视图重算) */
  function renderMapMarker() {
    const c = $("#mapCanvas");
    if (!c || !mapView) return;
    const old = c.querySelector(".map-node-layer");
    if (old) old.remove();
    const pois = (window.CHINA_MAP && window.CHINA_MAP.points_of_interest) || [];
    const cur = pois.find(function (poi) { return poi.name === state.地点; });
    if (!cur) return;
    const layer = document.createElement("div");
    layer.className = "map-node-layer";
    const p = mapPos(cur.x, cur.y);
    layer.innerHTML = '<div class="map-here" style="left:' + p.left + ";top:" + p.top + '" title="当前位置 · ' + esc(cur.name) + '">' + window.ICON("map-pin") + "</div>";
    c.appendChild(layer);
    window.ICON_HYDRATE(layer);
  }

  function showMapInfo(id) {
    // ① 兼容旧协议: 原九州幻想节点 (id 或名称均可, 供「当前地点情报」直开)
    const n = GD.MAP_NODES.find(function (x) { return x.id === id || x.name === id; });
    if (n) {
      const dng = { 低: "jade", 中: "gold", 极高: "crimson", 禁忌: "crimson" }[n.danger] || "gold";
      $("#mapInfoBody").innerHTML =
        '<div style="font-size:14px; letter-spacing:.14em; color:var(--paper); font-family:var(--font-display); margin-bottom:6px">' + esc(n.name) + "</div>" +
        '<div style="margin-bottom:8px"><span class="chip ' + dng + '">危险度 · ' + esc(n.danger) + "</span>" +
        (n.locked ? '<span class="chip crimson" style="margin-left:6px">封锁 · ' + esc(n.need || "") + "</span>" : "") + "</div>" +
        '<div style="font-size:11.5px; line-height:1.9; color:var(--paper-dim)">' + esc(n.desc) + "</div>" +
        (n.npcs ? '<div style="margin-top:10px; font-size:10px; letter-spacing:.18em; color:var(--paper-faint)">常驻人物 · ' + n.npcs.join(" / ") + "</div>" : "");
      return;
    }
    // ② 省会城市 POI
    const poi = ((window.CHINA_MAP && window.CHINA_MAP.points_of_interest) || []).find(function (x) { return x.name === id; });
    if (!poi) { $("#mapInfoBody").innerHTML = "选择地图上的城市以查看信息。"; return; }
    $("#mapInfoBody").innerHTML =
      '<div style="font-size:14px; letter-spacing:.14em; color:var(--paper); font-family:var(--font-display); margin-bottom:6px">' + esc(poi.name) + "</div>" +
      '<div style="margin-bottom:8px"><span class="chip azure">' + esc(poi.sub_region || "") + "</span></div>" +
      '<div style="font-size:11.5px; line-height:1.9; color:var(--paper-dim)">' + esc(poi.description || "") + "</div>";
  }

  function renderNpcList() {
    const list = $("#npcList");
    if (!list) return;
    const visible = GD.NPCS.filter(function (n) { return !n.hidden; });
    const dyn = state.周围人物 || {};
    const html = [];
    visible.forEach(function (n) {
      const rel = n.relation;
      const cls = rel >= 20 ? "jade" : rel >= 0 ? "gold" : "crimson";
      html.push('<button class="npc-row" data-npc="' + n.id + '">' +
        '<span class="np-avatar">' + window.ICON(n.icon) + "</span>" +
        '<span class="np-main"><span class="np-name">' + esc(n.name) + '</span><span class="np-sub">' + esc(n.role) + " · " + esc(n.location.split(" / ")[0]) + "</span></span>" +
        '<span class="np-rel"><span class="r-val">' + rel + '</span><span class="r-label">' + esc(n.relLabel) + "</span></span></button>");
    });
    // 动态人物 (AI 状态抓取, 好感度 -100..100)
    Object.keys(dyn).forEach(function (name) {
      const p = dyn[name] || {};
      const rel = Math.max(-100, Math.min(100, p.好感度 || 0));
      const cls = rel >= 20 ? "jade" : rel >= 0 ? "gold" : "crimson";
      const sub = (p.等级 ? "Lv." + p.等级 + " · " : "") + (p.外貌 || "").slice(0, 18) || "未知人物";
      html.push('<button class="npc-row" data-npc="dyn:' + esc(name) + '" title="' + esc(p.内心想法 || "") + '">' +
        '<span class="np-avatar">' + window.ICON("user") + "</span>" +
        '<span class="np-main"><span class="np-name">' + esc(name) + '</span><span class="np-sub">' + esc(sub) + "</span></span>" +
        '<span class="np-rel"><span class="r-val">' + rel + '</span><span class="r-label">' + esc(p.装备 || "") + "</span></span></button>");
    });
    list.innerHTML = html.join("");
    window.ICON_HYDRATE(list);
    const b = $("#tnpcBadge");
    if (b) { b.textContent = html.length; b.classList.remove("hidden"); }
  }

  /* 装备栏: 三组 (武器/防具/其他) × 4 槽位 = 12 槽位, 每组显示已装备数 */
  function renderGear() {
    const grid = $("#gearGrid");
    if (!grid) return;
    const groups = GD.GEAR_GROUPS || [{ id: "武器", icon: "sword" }, { id: "防具", icon: "shield" }, { id: "其他", icon: "gem" }];
    grid.innerHTML = groups.map(function (g) {
      const slots = GD.GEAR_SLOTS.filter(function (s) { return (s.group || "武器") === g.id; });
      const eqCount = slots.filter(function (s) { return state.装备[s.key]; }).length;
      return '<div class="gear-group">' +
        '<div class="gg-head"><span class="gg-icon">' + window.ICON(g.icon) + '</span>' + g.id +
        '<span class="gg-count">' + eqCount + " / " + slots.length + "</span></div>" +
        '<div class="gear-grid">' + slots.map(renderGearSlot).join("") + "</div></div>";
    }).join("");
    window.ICON_HYDRATE(grid);
    renderGearInv();
  }

  function renderGearSlot(slot) {
    const ref = state.装备[slot.key];
    let it = ref ? itemInfo(ref) : null;
    // LLM 新增/未知装备兜底: 装备栏仍可见可点击, 不再显示为空置
    if (ref && !it) it = { name: ref, icon: "gem", quality: "common", type: "装备", 未知: true };
    if (!it) {
      return '<div class="gear-slot is-empty" data-slot="' + slot.key + '">' +
        '<span class="gs-icon">' + window.ICON(slot.icon) + "</span>" +
        '<span class="gs-main"><span class="gs-name" style="color:var(--paper-faint)">空位</span><span class="gs-sub">' + esc(slot.group || slot.label || "") + '</span></span></div>';
    }
    const qc = qualityColor(it.quality);
    const broken = (it.durability != null && it.maxDura != null && it.durability <= 0);
    const dura = (it.durability != null && it.maxDura) ? Math.max(0, Math.min(100, Math.round(it.durability / it.maxDura * 100))) : 100;
    // 副行格式: 类型(武器/防具/其他) + 品质; 破损优先提示
    const grp = gearGroupOf(it) || SLOT_GROUP[slot.key] || "装备";
    const sub = broken
      ? grp + " · 已破损"
      : grp + " · " + (it.未知 ? "未知" : esc(qualityLabel(it.quality)));
    return '<div class="gear-slot' + (broken ? " is-broken" : "") + '" data-slot="' + slot.key + '" data-gear="' + esc(it.name) + '">' +
      '<span class="gs-icon" style="color:' + qc + '; border-color:' + qc + '66">' + window.ICON(it.icon) + "</span>" +
      '<span class="gs-main"><span class="gs-name" style="color:' + qc + '">' + esc(it.name) + '</span><span class="gs-sub">' + sub + "</span></span>" +
      '<i class="gs-badge" style="color:' + (broken ? "#7a7a80" : qc) + "; background:" + (broken ? "#7a7a80" : qc) + '"></i>' +
      '<span class="gs-dura' + (broken ? " is-empty-bar" : "") + '"><i style="width:' + dura + "%;" + (broken || dura <= 25 ? "background:var(--danger,#d6455f);" : "") + '"></i></span></div>';
  }

  function renderGearInv() {
    const g = $("#gearInvGrid");
    if (!g) return;
    const bag = state.背包 || [];
    g.innerHTML = bag.map(function (b) {
      const it = itemInfo(b.ref) || { name: b.ref, icon: "gem", quality: "common" };
      return '<button class="inv-slot q-border" data-item="' + esc(b.ref) + '" data-bag="1" style="--qc:' + qualityColor(it.quality) + '" title="' + esc(gearTitle(itemInfo(b.ref) || { name: b.ref })) + '">' +
        window.ICON(it.icon) + (b.qty > 1 ? '<span class="count">' + b.qty + "</span>" : "") + "</button>";
    }).join("");
    if (!bag.length) g.innerHTML = '<div class="empty-state" style="grid-column:1/-1; padding:16px"><span class="es-icon">' + window.ICON("backpack") + '</span><span class="es-title">背囊空空</span></div>';
    window.ICON_HYDRATE(g);
  }

  function renderSkills() {
    const s = $("#skillList");
    if (!s) return;
    const owned = state.技能 || [];
    const dyn = state.技能详情 || {};
    const html = GD.SKILLS.map(function (k) {
      const has = owned.indexOf(k.id) >= 0;
      const locked = !has && k.locked;
      return '<div class="skill-card' + (locked ? " is-locked" : "") + '" data-skill="' + k.id + '">' +
        '<div class="sk-head"><span class="sk-icon">' + window.ICON(k.icon) + "</span>" +
        '<div><div class="sk-title">' + esc(k.name) + '</div><div class="sk-sub">' + esc(k.type) + (has && k.level ? " · Lv." + k.level + "/" + k.maxLevel : "") + "</div></div></div>" +
        '<div class="sk-desc">' + esc(k.desc) + "</div>" +
        (k.cost ? '<div class="sk-meta"><span class="chip">气力 ' + k.cost + '</span></div>' : "") +
        (locked ? '<div class="sk-meta"><span class="chip crimson" style="margin-top:6px">未解锁 · ' + esc(k.locked === true ? "条件未知" : k.locked) + "</span></div>" : "") +
        "</div>";
    }).concat(Object.keys(dyn).map(function (name) {
      const d = dyn[name] || {};
      const lv = d.技能等级 || 0;
      const cost = d.消耗气力 || 0;
      return '<div class="skill-card" data-skill="' + esc(name) + '">' +
        '<div class="sk-head"><span class="sk-icon">' + window.ICON("zap") + "</span>" +
        '<div><div class="sk-title">' + esc(name) + '</div><div class="sk-sub">动态技能' + (lv ? " · Lv." + lv : "") + "</div></div></div>" +
        '<div class="sk-desc">' + esc(d.技能效果 || "无") + "</div>" +
        (cost ? '<div class="sk-meta"><span class="chip">气力 ' + cost + '</span></div>' : "") +
        "</div>";
    })).join("");
    s.innerHTML = html;
    window.ICON_HYDRATE(s);
  }

  function renderAuras() {
    const a = $("#auraList");
    if (!a) return;
    const owned = state.光环 || [];
    const dyn = state.光环详情 || {};
    const html = [];
    // 动态光环 (AI 状态抓取, 如「张天师1级佑护光环」)
    Object.keys(dyn).forEach(function (name) {
      const fx = (dyn[name] && dyn[name].效果) || "";
      html.push('<div class="aura-bar"><span class="au-icon">' + window.ICON("sparkles") + "</span>" +
        '<span class="au-main"><span class="au-name">' + esc(name) + '</span><span class="au-desc">' + esc(fx) + "</span></span>" +
        '<span class="au-dur">' + esc("动态") + "</span></div>");
    });
    // 静态光环 (AURAS 定义)
    owned.forEach(function (id) {
      const au = GD.AURAS[id];
      if (!au) return;
      html.push('<div class="aura-bar"><span class="au-icon">' + window.ICON(au.icon) + "</span>" +
        '<span class="au-main"><span class="au-name">' + esc(au.name) + '</span><span class="au-desc">' + esc(au.desc) + "</span></span>" +
        '<span class="au-dur">' + esc(au.dur) + "</span></div>");
    });
    a.innerHTML = html.length ? html.join("") : emptyState("sparkles", "无光环", "尚未获得任何光环");
    window.ICON_HYDRATE(a);
  }

  function emptyState(icon, title, sub) {
    return '<div class="empty-state"><span class="es-icon">' + window.ICON(icon) + '</span><span class="es-title">' + esc(title) + '</span><span class="es-sub">' + esc(sub) + "</span></div>";
  }

  function renderQuests() {
    const q = $("#questList");
    if (!q) return;
    const owned = state.任务 || [];
    const progMap = state.任务进度 || {};
    const dyn = state.任务详情 || {};
    const html = [];
    GD.QUESTS.filter(function (x) { return owned.indexOf(x.id) >= 0; }).forEach(function (x) {
      const typeCls = x.type === "main" ? "" : x.type === "hidden" ? "side hidden-q" : "side";
      const prog = progMap[x.id] || x.progress || { cur: 0, max: 1 };
      const pct = Math.max(0, Math.min(100, prog.cur / (prog.max || 1) * 100));
      const icon = x.type === "main" ? "flag" : x.type === "hidden" ? "skull" : "target";
      const stepLabel = x.steps[prog.cur] || x.steps[x.steps.length - 1] || "进行中";
      html.push('<div class="quest-card' + (prog.done ? " is-done" : "") + '" data-quest="' + x.id + '">' +
        '<div class="q-head"><span class="q-type ' + typeCls + '">' + window.ICON(icon) + "</span>" +
        '<span class="q-title">' + esc(x.name) + '</span></div>' +
        '<div class="q-desc">' + esc(x.desc) + "</div>" +
        '<div class="q-prog"><div class="bar quest"><div class="fill" style="width:' + pct + '%"></div></div>' +
        '<div style="font-size:9.5px; color:var(--paper-faint); letter-spacing:.1em; margin-top:4px">' + prog.cur + " / " + (prog.max || 1) + " · " + esc(stepLabel) + "</div></div>" +
        '<div class="q-reward"><span class="chip gold">' + esc(x.reward) + "</span></div></div>");
    });
    // 动态任务 (AI 状态抓取)
    Object.keys(dyn).forEach(function (name) {
      const d = dyn[name] || {};
      const typeCls = d.任务类型 === "主线" ? "" : "side";
      html.push('<div class="quest-card" data-quest="' + esc(name) + '">' +
        '<div class="q-head"><span class="q-type ' + typeCls + '">' + window.ICON(d.任务类型 === "主线" ? "flag" : "target") + "</span>" +
        '<span class="q-title">' + esc(name) + '</span></div>' +
        '<div class="q-desc">' + esc(d.任务类型 || "任务") + "</div>" +
        '<div class="q-reward"><span class="chip gold">' + esc(d.任务奖励 || "未知奖励") + "</span></div></div>");
    });
    q.innerHTML = html.length ? html.join("") : emptyState("target", "无事可做", "当前没有进行中的任务");
    window.ICON_HYDRATE(q);
    const b = $("#tquestBadge");
    if (b) { b.textContent = html.length; b.classList.remove("hidden"); }
  }

  function renderTalents() {
    const t = $("#talentList");
    if (!t) return;
    const owned = state.天赋 || [];
    const dyn = state.天赋详情 || {};
    const html = GD.TALENTS.filter(function (x) { return owned.indexOf(x.id) >= 0; }).map(function (x) {
      return '<div class="talent-card"><div class="tl-head"><span class="tl-icon">' + window.ICON(x.icon) + "</span>" +
        '<div><div class="tl-name">' + esc(x.name) + '</div><div class="tl-tier">' + esc(x.tier) + "</div></div></div>" +
        '<div class="tl-desc">' + esc(x.desc) + "</div></div>";
    }).concat(Object.keys(dyn).map(function (name) {
      const d = dyn[name] || {};
      return '<div class="talent-card"><div class="tl-head"><span class="tl-icon">' + window.ICON("hexagon") + "</span>" +
        '<div><div class="tl-name">' + esc(name) + '</div><div class="tl-tier">动态天赋</div></div></div>' +
        '<div class="tl-desc">' + esc(d.效果 || "无") + "</div></div>";
    })).join("");
    t.innerHTML = html.length ? html : emptyState("hexagon", "天赋未觉醒", "尚未获得任何天赋");
    window.ICON_HYDRATE(t);
  }

  function renderFaction() {
    const f = $("#factionHero");
    if (!f) return;
    const fac = state.阵营 || { 名称: "无归属", 声望: 0, 立场: "中立" };
    const stanceCls = { 友善: "jade", 中立: "gold", 敌视: "crimson", 毁灭: "crimson" }[fac.立场] || "gold";
    f.innerHTML = '<div class="fh-name">' + esc(fac.名称) + '</div>' +
      '<div class="fh-stance"><span class="chip ' + stanceCls + '">立场 · ' + esc(fac.立场) + "</span></div>" +
      '<div class="fh-desc">' + (fac.名称 === "无归属" ? "你不属于任何势力。黑城不会为无名者立碑，但也不会束缚你的刀。" : esc(fac.描述 || "你正效力于这一势力。")) + "</div>" +
      '<div class="fh-stats"><div class="fh-stat"><div class="v">' + fac.声望 + '</div><div class="k">声望</div></div>' +
      '<div class="fh-stat"><div class="v">' + (fac.立场 === "友善" ? "▲" : fac.立场 === "敌视" ? "▼" : "◆") + '</div><div class="k">倾向</div></div>' +
      '<div class="fh-stat"><div class="v">' + state.角色.灵视 + '</div><div class="k">灵视</div></div></div>';
    renderFactionRelations();
  }

  function renderFactionRelations() {
    const box = $("#factionRelations");
    if (!box) return;
    const list = GD.POWER_RANK.filter(function (r) { return !r.isOutside; }).slice(0, 8);
    box.innerHTML = list.map(function (r) {
      const cls = r.stance === "友善" ? "is-friendly" : r.stance === "敌视" ? "is-hostile" : "is-neutral";
      const v = r.stance === "友善" ? 72 : r.stance === "敌视" ? 22 : 48;
      return '<div class="relation-row ' + cls + '"><span class="rr-name">' + esc(r.name) + '</span>' +
        '<span class="rr-bar"><i style="width:' + v + '%"></i></span>' +
        '<span class="rr-val">' + esc(r.stance) + "</span></div>";
    }).join("");
  }

  /* ---- 战力榜 ---- */
  function renderPowerRank() {
    const t = $("#rankTable");
    if (!t) return;
    const rows = GD.POWER_RANK.slice().sort(function (a, b) { return (a.rank === 0 ? 999 : a.rank) - (b.rank === 0 ? 999 : b.rank); });
    t.innerHTML = rows.map(function (r) {
      const cls = r.isTop3 ? " is-top3" : r.isOutside ? " is-outside" : "";
      const no = r.rank;
      return '<div class="rank-row' + cls + '" data-rank="' + r.rank + '">' +
        '<span class="rk-no">' + no + "</span>" +
        '<span><span class="rk-name">' + esc(r.name) + ' · ' + esc(r.title) + '</span>' +
        '<div class="rk-sub">' + esc(r.leader) + " · " + esc(r.seat) + "</div></span>" +
        '<span class="rk-power">战力<b>' + r.power + '</b>' + esc(r.threat) + "</span>" +
        '<span class="rk-tag"><span class="chip ' + (r.stance === "友善" ? "jade" : r.stance === "敌视" ? "crimson" : r.stance === "毁灭" ? "crimson" : "gold") + '">' + esc(r.stance) + "</span></span></div>";
    }).join("");
    // 行点击展开详情
    $$(".rank-row", t).forEach(function (row) {
      row.addEventListener("click", function () {
        const r = GD.POWER_RANK.find(function (x) { return x.rank === Number(row.getAttribute("data-rank")); });
        if (!r) return;
        const d = row.querySelector(".rk-desc");
        if (d) { d.remove(); return; }
        const div = document.createElement("div");
        div.className = "rk-desc";
        div.style.cssText = "grid-column:1/-1;font-size:11.5px;line-height:1.85;color:var(--paper-dim);padding:6px 10px 2px;border-top:1px dashed rgba(201,162,39,.12);margin-top:4px";
        div.textContent = r.desc;
        row.appendChild(div);
      });
    });
  }

  /* ---- 编年史 ---- */
  function renderChronicle() {
    $("#chronicleCount").textContent = chronicle.length;
    const list = $("#chronicleList");
    list.innerHTML = chronicle.map(function (c, i) {
      return '<div class="chronicle-item">' +
        '<div class="ci-time">' + esc(c.time) + " · 第" + (i + 1) + "条</div>" +
        '<div class="ci-title">' + esc(c.title) + "</div>" +
        '<div class="ci-body">' + esc(c.body) + "</div>" +
        '<div class="ci-tags"><span class="chip gold" style="font-size:8.5px">' + (c.fromSum ? "协议落笔" : "世界书") + "</span>" +
        (c.fromSum ? '<span class="chip azure" style="font-size:8.5px">&lt;sum&gt;</span>' : "") + "</div></div>";
    }).join("");
    list.scrollTop = list.scrollHeight;
  }
  function pushChronicle(title, body, fromSum) {
    const d = state.日期;
    chronicle.push({ time: fmtDate(d) + " · " + fmtClock(d), title: title, body: body, fromSum: !!fromSum });
    unreadChronicle = true;
    const dot = $("#chronicleDot");
    if (dot) dot.classList.remove("hidden");
    renderChronicle();
  }

  /* ---- 存档 (多槽位, 每槽数据独立不互通) ---- */
  function newSaveId() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function saveKey(id) { return SAVE_PREFIX + id; }

  /* 迁移旧版单槽存档 → 首个多槽存档 */
  function migrateLegacySave() {
    try {
      const raw = localStorage.getItem(LEGACY_SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.state) return null;
      const id = newSaveId();
      data.id = id;
      data.slot = data.slot || "旧档";
      localStorage.setItem(saveKey(id), JSON.stringify(data));
      localStorage.removeItem(LEGACY_SAVE_KEY);
      return id;
    } catch (e) { return null; }
  }

  /* 列出所有存档槽 (按时间倒序) */
  function listSaves() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(SAVE_PREFIX) !== 0) continue;
      try {
        const data = JSON.parse(localStorage.getItem(k) || "null");
        if (!data || !data.state) continue;
        out.push({ id: data.id || k.slice(SAVE_PREFIX.length), key: k, data: data });
      } catch (e) { /* 跳过损坏存档 */ }
    }
    out.sort(function (a, b) { return String(b.data.time).localeCompare(String(a.data.time)); });
    return out;
  }

  /* 提取剧情区消息 → 会话记录数组 (存档用)
     AI 楼层正文优先取 __out.maintext (编辑后与打字机进行中都与显示一致) */
  function captureStory() {
    const out = [];
    $$("#storyScroll .msg").forEach(function (m) {
      const body = m.querySelector(".msg-body");
      if (!body) return;
      const cls = m.classList;
      if (cls.contains("is-ai")) {
        const o = m.__out || {};
        const txt = (typeof o.maintext === "string" && o.maintext) ? o.maintext : body.textContent;
        if (!txt) return;
        out.push({ role: "ai", content: txt });
      } else {
        if (!body.textContent) return;
        if (cls.contains("is-sys")) out.push({ role: "sys", content: body.textContent });
        else out.push({ role: "user", content: body.textContent });
      }
    });
    return out;
  }

  /* 按会话记录重建剧情区 (读档 / 恢复会话) */
  function restoreStory(messages) {
    storyScroll.innerHTML = "";
    lastAI = null; A.lastAI = null;
    (messages || []).forEach(function (m) {
      if (m.role === "ai") appendAIMsg(m.content, { drop: true, instant: true });
      else if (m.role === "sys") appendSystemMsg(m.content);
      else appendUserMsg(m.content);
    });
    scrollStory();
  }

  /* ============================================================
     记忆分层 (天道总结)
     最新 X 层全文 → 较早 AI 回复换小总结(<sum>) → 更早换大总结(<events>)
     memoryMeta 按剧情区 AI 消息序数对齐; 总结可手动编辑
     ============================================================ */
  /* 剧情区 → 对话回合数组 (AI 消息附带其 <sum> 作为小总结兜底; 口径与 captureStory 一致) */
  function buildStoryTurns() {
    const out = [];
    $$("#storyScroll .msg").forEach(function (m) {
      const body = m.querySelector(".msg-body");
      if (!body) return;
      if (m.classList.contains("is-sys")) return;
      if (m.classList.contains("is-ai")) {
        const o = m.__out || {};
        const txt = (typeof o.maintext === "string" && o.maintext) ? o.maintext : body.textContent;
        if (!txt) return;
        out.push({ role: "assistant", content: txt, sum: o.sum || "" });
      } else {
        if (!body.textContent) return;
        out.push({ role: "user", content: body.textContent });
      }
    });
    return out;
  }

  /* 分层压缩后的历史 (发给 LLM 用; 硬上限兜底防极端长会话) */
  function buildSegmentedHistory() {
    const turns = buildStoryTurns();
    const hist = (window.ST && ST.segmentHistory)
      ? ST.segmentHistory(turns, settings.memory, memoryMeta)
      : turns.map(function (t) { return { role: t.role, content: t.content }; });
    while (hist.length > 40 || hist.reduce(function (s, x) { return s + x.content.length; }, 0) > 12000) hist.shift();
    return hist;
  }

  /* 当前分层窗口: 小总结区 / 大总结区各自包含哪些 AI 回复 (记忆管理面板用) */
  function memoryWindows() {
    const cfg = settings.memory || {};
    const turns = buildStoryTurns();
    const layers = Math.max(1, Number(cfg.layers) || 6);
    const largeStart = Math.max(1, Number(cfg.largeStart) || 14);
    let layer = 0;
    const layerOf = [];
    turns.forEach(function (t, i) { if (i > 0 && t.role === "user") layer++; layerOf.push(layer); });
    const totalLayers = layer + 1;
    const chatCut = Math.max(0, totalLayers - layers);
    const largeCut = Math.max(0, totalLayers - largeStart);
    const smalls = [], larges = [];
    let ai = -1;
    turns.forEach(function (t, i) {
      if (t.role !== "assistant") return;
      ai++;
      if (layerOf[i] >= chatCut) return;               // 全文窗口内, 无需总结
      (layerOf[i] < largeCut ? larges : smalls).push({ idx: ai, preview: String(t.content || "").slice(0, 64) });
    });
    return { smalls: smalls.reverse(), larges: larges.reverse(), total: ai + 1 };
  }

  function renderMemoryModal() {
    const cfg = settings.memory || {};
    const sw = $("#swMemory");
    if (sw) sw.setAttribute("aria-checked", cfg.enabled === false ? "false" : "true");
    const li = $("#memLayers"); if (li) li.value = Math.max(1, Number(cfg.layers) || 6);
    const ls = $("#memLargeStart"); if (ls) ls.value = Math.max(2, Number(cfg.largeStart) || 14);
    const w = memoryWindows();
    const sub = $("#memorySub");
    if (sub) sub.textContent = "最新 " + (Math.max(1, Number(cfg.layers) || 6)) + " 层全文 → 较早回复用小总结 → 倒数第 " + (Math.max(2, Number(cfg.largeStart) || 14)) + " 层起用大总结 · 共 " + w.total + " 条回复";
    function rows(list, kind) {
      if (!list.length) return '<div class="mem-empty">暂无进入此窗口的回复。</div>';
      return list.map(function (it) {
        const meta = memoryMeta[it.idx] || {};
        const val = kind === "large" ? (meta.large || "") : (meta.small || "");
        return '<div class="mem-item">' +
          '<div class="mem-item-head"><b>#' + (it.idx + 1) + ' 回复</b><span>' + esc(it.preview) + "</span></div>" +
          '<textarea class="input mem-input" rows="2" data-mem-idx="' + it.idx + '" data-mem-kind="' + kind + '">' + esc(val) + "</textarea></div>";
      }).join("");
    }
    const sb = $("#memSmallList"); if (sb) sb.innerHTML = rows(w.smalls, "small");
    const lb = $("#memLargeList"); if (lb) lb.innerHTML = rows(w.larges, "large");
    ICON_HYDRATE($("#modalMemory") || document);
  }

  function fillLatestSummary() {
    const sm = ($("#memManualSmall") || {}).value;
    const lg = ($("#memManualLarge") || {}).value;
    if ((!sm || !sm.trim()) && (!lg || !lg.trim())) { toast("warn", "两个框都空着", "请至少填写一项"); return; }
    const total = $$("#storyScroll .msg.is-ai").length;
    if (!total) { toast("warn", "尚无 AI 回复", "先进行一次对话"); return; }
    const idx = total - 1;
    memoryMeta[idx] = Object.assign({ small: "", large: "" }, memoryMeta[idx] || {});
    if (sm && sm.trim()) memoryMeta[idx].small = sm.trim();
    if (lg && lg.trim()) memoryMeta[idx].large = lg.trim();
    if ($("#memManualSmall")) $("#memManualSmall").value = "";
    if ($("#memManualLarge")) $("#memManualLarge").value = "";
    if (A.settings.autosave && A.currentSaveId) saveGame("自动");
    renderMemoryModal();
    toast("success", "已补充", "总结已挂到最新回复 #" + total);
  }

  /* ============================================================
     世界快照 (退档)
     每条 AI 回复自动打点: 完整世界状态 + 编年史 + 记忆 + 对话长度。
     退档 = 恢复状态并截断其后对话, 丢弃更新的快照。
     ============================================================ */
  const WORLDSNAP_MAX = 30;

  function takeWorldSnap(label) {
    worldSnaps.push({
      id: uid(), time: new Date().toISOString(), label: label || "打点",
      storyLen: captureStory().length,
      state: JSON.parse(JSON.stringify(state)),
      chronicle: JSON.parse(JSON.stringify(chronicle)),
      memory: JSON.parse(JSON.stringify(memoryMeta))
    });
    while (worldSnaps.length > WORLDSNAP_MAX) worldSnaps.shift();
    return worldSnaps[worldSnaps.length - 1];
  }

  function loadWorldSnap(snapId) {
    const idx = worldSnaps.findIndex(function (s) { return s.id === snapId; });
    if (idx < 0 || !worldSnaps[idx] || !worldSnaps[idx].state) return;
    const snap = worldSnaps[idx];
    A.confirmDialog({
      title: "读取快照", okText: "退档到此", danger: true,
      body: "将回到「" + esc(snap.label || "快照") + "」时的世界状态，并丢弃其后的所有对话与快照。此操作不可撤销。"
    }).then(function (ok) {
      if (!ok) return;
      /* 从当前剧情区截断到快照时点 (退档只会往回退, 当前对话是其超集) */
      const story = captureStory();
      restoreStory(story.slice(0, snap.storyLen || story.length));
      state = JSON.parse(JSON.stringify(snap.state)); A.state = state;
      chronicle = JSON.parse(JSON.stringify(snap.chronicle || GD.CHRONICLE_SEED.slice())); A.chronicle = chronicle;
      memoryMeta = JSON.parse(JSON.stringify(snap.memory || []));
      worldSnaps = worldSnaps.slice(0, idx + 1);   // 丢弃其后快照
      clearOptions(); A.lastOptions = [];
      A.renderAll();
      if (A.currentSaveId) saveGame("退档");
      renderWorldSnaps();
      toast("success", "退档完成", (snap.label || "快照") + " · " + (state.地点 || ""));
    });
  }

  function deleteWorldSnap(snapId) {
    const idx = worldSnaps.findIndex(function (s) { return s.id === snapId; });
    if (idx < 0) return;
    A.confirmDialog({ title: "删除快照", okText: "删除", danger: true, body: "该快照将被删除（对话不受影响）。" })
      .then(function (ok) {
        if (!ok) return;
        worldSnaps.splice(idx, 1);
        if (A.currentSaveId) saveGame("自动");
        renderWorldSnaps();
      });
  }

  function clearWorldSnaps() {
    if (!worldSnaps.length) { toast("info", "暂无快照", "生成一段剧情后会自动打点"); return; }
    A.confirmDialog({ title: "清空快照", okText: "清空", danger: true, body: "将删除当前存档的全部世界快照（对话与状态不受影响）。" })
      .then(function (ok) {
        if (!ok) return;
        worldSnaps = [];
        if (A.currentSaveId) saveGame("自动");
        renderWorldSnaps();
      });
  }

  function renderWorldSnaps() {
    const box = $("#worldSnapList");
    if (!box) return;
    const cnt = $("#worldSnapCount");
    if (cnt) cnt.textContent = worldSnaps.length ? "共 " + worldSnaps.length + " 条 · 上限 " + WORLDSNAP_MAX : "尚无快照 · 生成一段剧情后自动打点";
    if (!worldSnaps.length) {
      box.innerHTML = '<div class="empty-state" style="padding:18px"><span class="es-icon">' + window.ICON("history") + '</span><span class="es-title">暂无快照</span><span class="es-sub">每条 AI 回复会自动打点一个世界快照，可在任意时刻退档</span></div>';
      ICON_HYDRATE(box);
      return;
    }
    box.innerHTML = worldSnaps.slice().reverse().map(function (s) {
      const r = (s.state && s.state.角色) || {};
      return '<div class="save-slot" data-wsnap="' + esc(s.id) + '">' +
        '<span class="ss-icon">' + window.ICON("history") + "</span>" +
        '<span class="ss-main"><span class="ss-name">' + esc(s.label || "快照") + "</span>" +
        '<span class="ss-sub">' + new Date(s.time).toLocaleString("zh-CN") + " · " + esc(r.姓名 || "无名旅者") + " Lv." + (r.等级 || 0) + (s.state && s.state.地点 ? " · " + esc(s.state.地点) : "") + "</span></span>" +
        '<span class="ss-del" data-wsnap-del="' + esc(s.id) + '" title="删除此快照" aria-label="删除快照">' + window.ICON("trash", 12) + "</span>" +
        '<span class="ss-action">退档</span></div>';
    }).join("");
    ICON_HYDRATE(box);
  }


  /* 保存到当前槽; 无当前槽时新建 (autosave 场景)
     剧情回退由「世界快照」(worldSnaps) 负责, 存档槽只保留当前进度 */
  function saveGame(slotName) {
    if (!currentSaveId) currentSaveId = newSaveId();
    const key = saveKey(currentSaveId);
    const data = {
      v: 3, id: currentSaveId, time: new Date().toISOString(), slot: slotName || "自动",
      state: state, chronicle: chronicle, messages: captureStory(),
      memory: memoryMeta, worldSnaps: worldSnaps
    };
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { toast("error", "存档失败", "本地存储不可用"); return false; }
    return true;
  }

  /* 读取指定槽; 缺省时读「当前槽 or 最近存档」 */
  function loadGame(saveId) {
    const id = saveId || currentSaveId;
    try {
      const raw = id ? localStorage.getItem(saveKey(id)) : null;
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !data.state) return false;
      currentSaveId = data.id || id;
      state = normalizeState(data.state);
      A.state = state;
      chronicle = data.chronicle || GD.CHRONICLE_SEED.slice();
      A.chronicle = chronicle;
      // 记忆分层元数据 + 世界快照 (旧档补默认)
      memoryMeta = Array.isArray(data.memory) ? data.memory : [];
      worldSnaps = Array.isArray(data.worldSnaps) ? data.worldSnaps : [];
      // 旧版本地名迁移 (v1 → 九州舆图)
      const LAND_MIGRATE = { "南市废墟": "废都长安", "千灯巷": "金陵夜巷", "天工坊": "蜀道关", "铁锈河渡口": "江夏渡口", "黑曜门": "洛阳 · 黑曜门", "黄巾疫区": "巨鹿 · 黄巾疫区" };
      if (state.地点 && LAND_MIGRATE[state.地点]) state.地点 = LAND_MIGRATE[state.地点];
      return data;
    } catch (e) { return false; }
  }

  function deleteSave(saveId) {
    try { localStorage.removeItem(saveKey(saveId)); } catch (e) {}
    if (currentSaveId === saveId) currentSaveId = null;
  }

  /* 旧档数据迁移: 魂晶→金锭, 护身符→特殊装备, 日期补齐 时/分 (24 小时制) */
  function normalizeState(s) {
    if (!s || typeof s !== "object") return s;
    const R = s.角色;
    if (R && R.货币 && typeof R.货币 === "object") {
      if (R.货币.魂晶 != null) {
        R.货币.金锭 = (R.货币.金锭 || 0) + (R.货币.魂晶 || 0);
        delete R.货币.魂晶;
      }
    }
    const gear = s.装备;
    if (gear && typeof gear === "object") {
      if (gear.护身符 != null && gear.特殊装备 == null) gear.特殊装备 = gear.护身符;
      delete gear.护身符;
      // 旧档补齐 12 槽位 (武器×4 / 防具×4 / 其他×4)
      ((window.GAME_DATA || {}).GEAR_SLOTS || []).forEach(function (slot) {
        if (!(slot.key in gear)) gear[slot.key] = null;
      });
    }
    // 旧档补充 装备详情 字典 (耐久度等 LLM 动态字段写入位)
    if (!s.装备详情 || typeof s.装备详情 !== "object") s.装备详情 = {};
    const d = s.日期;
    if (d && typeof d === "object" && d.时 == null && window.VAR_MODEL && window.VAR_MODEL.shichenToHour) {
      const hh = window.VAR_MODEL.shichenToHour(d.时辰);
      if (!isNaN(hh)) { d.时 = hh; d.分 = (d.分 != null ? d.分 : 0); }
    }
    /* 自愈: 背包残留货币→货币栏, 装备非标准键→标准槽位 (与 varmodel.apply 一致) */
    if (window.VAR_MODEL && VAR_MODEL.selfHeal) VAR_MODEL.selfHeal(s);
    return s;
  }

  /* 渲染存档列表 (多槽): 每个槽位独立显示 名称/时间/角色/地点 + 删除 */
  function renderSaveSlots() {
    const box = $("#saveSlots");
    if (!box) return;
    const saves = listSaves();
    if (!saves.length) {
      box.innerHTML = '<div class="save-slot"><span class="ss-icon">' + window.ICON("plus") + "</span>" +
        '<span class="ss-main"><span class="ss-name">空存档位</span><span class="ss-sub">尚未写入任何存档</span></span>' +
        '<span class="ss-action">—</span></div>';
      window.ICON_HYDRATE(box);
      return;
    }
    box.innerHTML = saves.map(function (s) {
      const d = s.data;
      const r = d.state.角色 || {};
      const loc = d.state.地点 || "";
      const isCur = s.id === currentSaveId;
      const msgs = (d.messages || []).filter(function (m) { return m.role !== "sys"; }).length;
      return '<div class="save-slot' + (isCur ? " is-current" : "") + '" data-load="' + esc(s.id) + '">' +
        '<span class="ss-icon">' + window.ICON("save") + "</span>" +
        '<span class="ss-main"><span class="ss-name">' + esc(d.slot || "存档") + (isCur ? '<span class="chip gold" style="margin-left:6px; font-size:8.5px">当前</span>' : "") + "</span>" +
        '<span class="ss-sub">' + new Date(d.time).toLocaleString("zh-CN") + " · " + esc(r.姓名 || "无名旅者") + " Lv." + (r.等级 || 1) + (loc ? " · " + esc(loc) : "") + (msgs ? " · 会话 " + msgs + " 条" : "") + "</span></span>" +
        '<span class="ss-del" data-del="' + esc(s.id) + '" title="删除此存档" aria-label="删除存档">' + window.ICON("trash", 12) + "</span>" +
        '<span class="ss-action">进入</span></div>';
    }).join("");
    window.ICON_HYDRATE(box);
  }

  /* ---------- 命名存档 / 返回主菜单 ---------- */
  function defaultSaveName() {
    const R = state.角色 || {};
    return (R.姓名 || "无名旅者") + " · Lv." + (R.等级 || 0) + " · " + (state.地点 || "未知");
  }
  function openSaveName() {
    const inp = $("#saveNameInput");
    if (inp) inp.value = defaultSaveName();
    A.openModal("modalSaveName");
    setTimeout(function () { if (inp) inp.select(); }, 60);
  }
  /* 确认存档: 每次生成一个新的命名存档位 (经典存档点语义, 进度继续, 可随时进入旧档回溯) */
  function confirmSaveName() {
    const name = (($("#saveNameInput") || {}).value || "").trim() || defaultSaveName();
    A.currentSaveId = newSaveId();
    if (A.saveGame(name)) {
      A.closeModal("modalSaveName");
      A.closeModal("modalLoad");
      A.renderSaveSlots();
      toast("success", "存档成功", name);
    }
  }
  function returnToMenu() {
    A.closeModal("modalLoad");
    if (A.currentSaveId) A.saveGame("自动");
    $("#titleScreen").classList.add("is-visible");
    updateTitleContinue();
    toast("info", "已返回主菜单", "进度已自动保存，可随时继续");
  }

  /* ============================================================
     协议解析 (AI 输出 → 结构化)
     ============================================================ */
  function parseProtocol(raw) {
    const out = { maintext: "", options: [], sum: "", tags: [] };
    if (!raw) return out;
    const grab = function (tag) {
      const m = raw.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "i"));
      return m ? m[1].trim() : "";
    };
    out.maintext = grab("maintext");
    const optRe = /<option(?:\s+tag="([^"]*)")?(?:\s+risk="([^"]*)")?\s*>([\s\S]*?)<\/option>/gi;
    let m;
    while ((m = optRe.exec(raw)) !== null) {
      out.options.push({ text: m[3].trim(), tag: m[1] || "行动", risk: m[2] === "true" });
    }
    out.sum = grab("sum");
    out.tags = [];
    if (out.maintext) out.tags.push("maintext");
    if (out.options.length) out.tags.push("option×" + out.options.length);
    if (out.sum) out.tags.push("sum");
    return out;
  }

  function applyProtocol(out) {
    if (out.sum) pushChronicle("残响纪元 · 拾遗", out.sum, true);
  }

  /* 渲染全部 */
  function renderAll() {
    renderTop();
    const ln = $("#locName");
    if (ln) ln.textContent = state.地点 || "未知";
    renderIdentity();
    renderVitals();
    renderAttrs("#attrGrid", false);
    renderInvSummary();
    renderMap();
    renderNpcList();
    renderGear();
    renderSkills();
    renderAuras();
    renderQuests();
    renderTalents();
    renderFaction();
    if ($("#modalPower").classList.contains("is-open")) renderPowerRank();
    if ($("#modalLoad").classList.contains("is-open")) renderSaveSlots();
    if ($("#modalChronicle").classList.contains("is-open")) renderChronicle();
  }

  /* ============================================================
     导出内部接口 (Part 2 使用)
     ============================================================ */
  window.__APP = {
    $, $$, state, chronicle, settings, uid, esc, rnd, pick,
    openModal, closeModal, closeTopModal, confirmDialog, toast,
    renderAll, renderTop, renderIdentity, renderVitals, renderAttrs,
    renderInvSummary, renderMap, showMapInfo,
    renderGear, renderSkills, renderAuras, renderQuests, renderTalents,
    renderFaction, renderPowerRank, renderChronicle, renderSaveSlots,
    pushChronicle, saveGame, loadGame, parseProtocol, applyProtocol,
    listSaves, deleteSave, newSaveId, migrateLegacySave,
    captureStory, restoreStory,
    renderLorebookList, renderLorebookEditor, renderPresetManager, renderPromptBlocks,
    ensureDefaultLorebook,
    get editingBookId() { return editingBookId; }, set editingBookId(v) { editingBookId = v; },
    get editingPresetId() { return editingPresetId; }, set editingPresetId(v) { editingPresetId = v; },
    get currentSaveId() { return currentSaveId; }, set currentSaveId(v) { currentSaveId = v; },
    get wizard() { return wizard; }, set wizard(v) { wizard = v; },
    fmtDate, fmtClock, ganZhiYear, fmtMoney, powerLabel, qualityColor,
    equipBonus, normalizeState, gearSlotFor, itemInfo, gearTitle, gearGroupOf,
    openItemModal, equipItem, unequipItem, useItem, landPois, landCityById,
    ensureLandMap, updateLandPickUI, randomLand, finalizeCharacter, resetWizard,
    set: function (fn) { fn(state); renderAll(); },
    get lastAI() { return lastAI; }, set lastAI(v) { lastAI = v; },
    get lastRaw() { return lastRaw; }, set lastRaw(v) { lastRaw = v; },
    get lastOptions() { return lastOptions; }, set lastOptions(v) { lastOptions = v; },
    get engineBusy() { return engineBusy; }, set engineBusy(v) { engineBusy = v; },
    get typeJob() { return typeJob; }, set typeJob(v) { typeJob = v; },
    get currentNpc() { return currentNpc; }, set currentNpc(v) { currentNpc = v; },
    get unreadChronicle() { return unreadChronicle; }, set unreadChronicle(v) { unreadChronicle = v; },
    get state() { return state; }, set state(v) { state = v; }
  };

  /* ============================================================
     Part 2 · 剧情引擎 / 打字机 / 创建向导 / 事件绑定 / 初始化
     ============================================================ */
  const A = window.__APP;
  const ICON = window.ICON;

  /* ---------- 剧情消息渲染 ---------- */
  const storyScroll = $("#storyScroll");

  function metaHtml(tag, cls) {
    const d = state.日期;
    return '<div class="msg-meta">' +
      '<span class="mm-time">' + A.fmtDate(d) + " · " + A.fmtClock(d) + "</span>" +
      '<span class="mm-loc">' + ICON("map-pin") + A.esc(state.地点) + "</span>" +
      '<span class="msg-tag ' + cls + '">' + A.esc(tag) + "</span></div>";
  }

  function appendSystemMsg(text) {
    const el = document.createElement("div");
    el.className = "msg is-sys";
    el.innerHTML = metaHtml("系统 · 编年史", "is-sys") + '<div class="msg-body hl-dim">' + A.esc(text) + "</div>";
    storyScroll.appendChild(el);
    scrollStory();
  }

  function appendUserMsg(text) {
    const el = document.createElement("div");
    el.className = "msg";
    el.innerHTML = metaHtml("你的抉择", "") + '<div class="msg-body" style="font-family:var(--font-body);color:var(--paper-dim)">' + A.esc(text) + "</div>" +
      '<div class="msg-actions"><button class="ma-btn" data-ma="edit" data-tip="编辑" aria-label="编辑">' + ICON("edit") + "</button></div>";
    storyScroll.appendChild(el);
    scrollStory();
  }

  /* AI 消息: 支持打字机; 悬停操作 (重新生成 / 编辑) 挂在消息右上角 */
  function appendAIMsg(rawText, opts) {
    opts = opts || {};
    const el = document.createElement("div");
    el.className = "msg";
    el.innerHTML = metaHtml("意识流 · 黑城", "is-ai") + '<div class="msg-body' + (opts.drop ? " has-drop" : "") + '"></div>' +
      '<div class="msg-actions">' +
      '<button class="ma-btn" data-ma="regen" data-tip="重新生成" aria-label="重新生成">' + ICON("refresh") + "</button>" +
      '<button class="ma-btn" data-ma="edit" data-tip="编辑" aria-label="编辑">' + ICON("edit") + "</button></div>";
    storyScroll.appendChild(el);
    A.lastAI = el;
    const body = el.querySelector(".msg-body");
    scrollStory();

    if (A.settings.streaming && !opts.instant) {
      typewriter(body, rawText);
    } else {
      body.textContent = rawText;
      // 非打字机模式: 立即渲染选项
      if (A.lastOptions && A.lastOptions.length && !engineBusy) {
        renderOptions(A.lastOptions);
      }
    }
    return el;
  }

  /* 打字机 */
  function typewriter(el, text) {
    if (A.typeJob && A.typeJob.stop) A.typeJob.stop(true);
    const speedMap = { 1: 70, 2: 48, 3: 30, 4: 18, 5: 9 };
    const stepMs = speedMap[A.settings.speed] || 30;
    let i = 0;
    let stopped = false;
    const caret = document.createElement("span");
    caret.className = "caret";
    el.appendChild(caret);

    const timer = setInterval(function () {
      if (stopped) return;
      el.insertBefore(document.createTextNode(text[i]), caret);
      i++;
      scrollStory();
      if (i >= text.length) {
        clearInterval(timer);
        caret.remove();
        if (A.typeJob && A.typeJob.stop === stop) A.typeJob = null;
        onTypeDone();
      }
    }, stepMs);

    function stop(silent) {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      caret.remove();
      el.textContent = text;
      if (!silent && A.typeJob && A.typeJob.stop === stop) A.typeJob = null;
      onTypeDone();
    }
    A.typeJob = { stop: stop, el: el };
    return { stop: stop };
  }

  function onTypeDone() {
    // 打字完成后渲染选项(若有)
    if (A.lastOptions && A.lastOptions.length && !engineBusy) {
      renderOptions(A.lastOptions);
    }
  }

  function scrollStory() {
    const wrap = $(".story-wrap");
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }

  /* ---------- 选项渲染 ---------- */
  function clearOptions() {
    $$(".option-list").forEach(function (o) { o.remove(); });
    A.lastOptions = [];
  }

  function renderOptions(opts) {
    clearOptions();
    if (!opts || !opts.length) return;
    const list = document.createElement("div");
    list.className = "option-list";
    list.innerHTML = opts.map(function (o, i) {
      const tag = o.risk ? '<span class="ob-tag risk">' + A.esc(o.tag || "风险") + "</span>"
        : o.tag === "主线" ? '<span class="ob-tag gain">' + A.esc(o.tag) + "</span>"
        : '<span class="ob-tag">' + A.esc(o.tag || "行动") + "</span>";
      return '<button class="option-btn" data-opt="' + i + '">' +
        '<span class="ob-idx">' + (i + 1) + "</span>" +
        '<span style="flex:1">' + A.esc(o.text) + "</span>" + tag + "</button>";
    }).join("");
    storyScroll.appendChild(list);
    A.lastOptions = opts;
    scrollStory();
    $$(".option-btn", list).forEach(function (btn) {
      btn.addEventListener("click", function () {
        const idx = Number(btn.getAttribute("data-opt"));
        chooseOption(opts[idx]);
      });
    });
  }

  /* ---------- 选择选项 / 发送指令 ---------- */
  function chooseOption(opt) {
    if (A.engineBusy) return;
    clearOptions();
    appendUserMsg(opt.text);
    simulateAI(opt.text, opt);
  }

  function sendCustom() {
    const inp = $("#dockInput");
    const text = inp.value.trim();
    if (!text || A.engineBusy) return;
    inp.value = "";
    inp.style.height = "auto";
    appendUserMsg(text);
    simulateAI(text, null);
  }

  /* ---------- 演示引擎 (无后端模拟) ---------- */
  function simulateAI(input, opt) {
    // 已配置 AI 引擎 → 走真实 LLM (SillyTavern 协议)
    const aiCfg = A.settings.ai || {};
    if (aiCfg.enabled && aiCfg.baseUrl) { liveAI(input, opt); return; }

    A.engineBusy = true;
    $("#btnSend").classList.add("is-busy");
    $("#btnSend").querySelector("span").innerHTML = ICON("pulse");
    $("#btnStop").style.display = "inline-flex";
    $("#protocolStrip").style.display = "flex";
    $("#protocolText").innerHTML = '<span class="p-tag">&lt;maintext&gt;</span> 推演中…';

    setTimeout(function () {
      let res = null;
      // 关键词路由
      const kw = [
        { re: /铜牌|阿蛮|铁匠|工坊|小字|通行/, key: "aman" },
        { re: /黄巾|太平|瘟疫|祭品|灵视|信笺|南门/, key: "mutant" },
        { re: /老鸦|情报|打听|消息/, key: "laoya" },
        { re: /素手|医|脉象|药|包扎/, key: "sushou" },
        { re: /燕九|路引|渡口|百夫/, key: "yanjiu" }
      ];
      let matched = null;
      for (let i = 0; i < kw.length; i++) {
        if (kw[i].re.test(input)) { matched = kw[i].key; break; }
      }
      if (matched && GD.DEMO_RESPONSES[matched]) {
        res = buildDemo(matched, input);
      } else if (A.currentNpc && GD.DEMO_RESPONSES[A.currentNpc]) {
        res = buildDemo(A.currentNpc, input);
      } else {
        res = buildGeneric(input);
      }

      // 世界书命中 → 离线模式也注入剧情 (真实 AI 模式在 liveAI 中注入系统提示)
      let loreHits = [];
      if (window.ST) {
        loreHits = window.ST.matchLorebook(buildLoreProbe(input), getLorebooks(), 3);
      }
      if (loreHits.length && res.maintext) {
        const hit = loreHits[0];
        const kw = hit.matchedKey || ((hit.keys && hit.keys[0]) || "传闻");
        res.maintext += "\n\n风里传来关于「" + kw + "」的只言片语——「" + String(hit.content || "").slice(0, 90) + "」";
        const keys = loreHits.map(function (h) { return h.matchedKey; }).filter(Boolean);
        $("#protocolText").innerHTML = '<span class="p-tag">&lt;maintext&gt;</span> 推演完成 · <span class="p-tag lore">世界书注入 ' + loreHits.length + ' 条' + (keys.length ? "（" + esc(keys.slice(0, 3).join("、")) + "）" : "") + "</span>";
      }

      emitAI(res);
    }, 620 + A.rnd(500));
  }

  /* ---------- 真实 LLM 引擎 (SillyTavern 世界书 + OpenAI 兼容 API) ---------- */
  let aiAbort = null;       // 流式中断句柄
  let loreCache = null;     // 世界书索引缓存

  function getLorebooks() {
    if (!loreCache && window.ST) loreCache = window.ST.buildLorebook();
    return loreCache || [];
  }

  /* 世界书探测文本: 当前输入 + 最近对话 + 地点/姓名/身份 (上下文匹配) */
  function buildLoreProbe(input) {
    const parts = [input || ""];
    const msgs = $$("#storyScroll .msg");
    for (let i = Math.max(0, msgs.length - 3); i < msgs.length; i++) {
      const mb = msgs[i].querySelector(".msg-body");
      if (mb && mb.textContent) parts.push(mb.textContent);
    }
    parts.push(state.地点 || "", (state.角色 && state.角色.姓名) || "", (state.角色 && state.角色.身份) || "", (state.角色 && state.角色.性别) || "", (state.角色 && state.角色.年龄) || "");
    return parts.join(" ").slice(0, 2000);
  }

  function liveAI(input, opt) {
    const aiCfg = A.settings.ai;
    const cfg = { baseUrl: aiCfg.baseUrl || "", apiKey: aiCfg.apiKey, model: aiCfg.model || "gpt-4o-mini" };
    const presetParams = window.ST.getPresetParams(aiCfg.preset); // 预设参数(温度等)
    const streaming = !!A.settings.streaming;                 // 游戏级「流式传输」总开关
    presetParams.stream = streaming;                          // 总开关优先于预设 stream_openai

    A.engineBusy = true;
    $("#btnSend").classList.add("is-busy");
    $("#btnSend").querySelector("span").innerHTML = ICON("pulse");
    $("#btnStop").style.display = "inline-flex";
    $("#protocolStrip").style.display = "flex";
    $("#protocolText").innerHTML = '<span class="p-tag">&lt;maintext&gt;</span> 接入 ' + esc(cfg.model) + " …";

    // 组装对话历史 (记忆分层: 最新 X 层全文 → 较早回复小总结 → 更早大总结)
    const msgs = buildSegmentedHistory();

    // 世界书命中 (输入 + 最近对话 + 地点/身份 作为探测文本)
    let loreHits = [];
    if (window.ST) {
      loreHits = window.ST.matchLorebook(buildLoreProbe(input), getLorebooks(), 8);
    }
    const loreKeys = loreHits.map(function (h) { return h.matchedKey; }).filter(Boolean);
    if (loreHits.length) {
      $("#protocolText").innerHTML = '<span class="p-tag">&lt;maintext&gt;</span> 接入 ' + esc(cfg.model) + ' · <span class="p-tag lore">世界书注入 ' + loreHits.length + ' 条' + (loreKeys.length ? "（" + esc(loreKeys.slice(0, 3).join("、")) + "）" : "") + "</span>";
    }

    const presetObj = window.ST.getPresetByName(aiCfg.preset) || {};
    const presetSettings = presetObj.settings || {};
    const sys = window.ST.buildSystemPrompt(state, loreHits, chronicle,
      presetSettings.main || "", presetSettings);
    const messages = [{ role: "system", content: sys }].concat(msgs);

    // AI 消息容器 (流式增量写入)
    const el = document.createElement("div");
    el.className = "msg is-ai";
    el.innerHTML = metaHtml("意识流 · 黑城", "is-ai") + '<div class="msg-body has-drop"></div>' +
      '<div class="msg-actions">' +
      '<button class="ma-btn" data-ma="regen" data-tip="重新生成" aria-label="重新生成">' + ICON("refresh") + "</button>" +
      '<button class="ma-btn" data-ma="edit" data-tip="编辑" aria-label="编辑">' + ICON("edit") + "</button></div>";
    storyScroll.appendChild(el);
    A.lastAI = el;
    const body = el.querySelector(".msg-body");
    scrollStory();

    aiAbort = new AbortController();
    window.ST.chatCompletion(cfg, messages, streaming ? function (delta) {
      body.textContent += delta;
      scrollStory();
    } : null, aiAbort.signal, presetParams).then(function (fullText) {
      aiAbort = null;
      const out = window.ST.parseReply(fullText);
      $("#protocolText").innerHTML = '<span class="p-tag">&lt;maintext&gt;</span> ' + esc(cfg.model) + (loreHits.length ? ' · <span class="p-tag lore">世界书注入 ' + loreHits.length + ' 条</span>' : "") + " · 完成";
      emitAI(out, { live: true });
    }).catch(function (e) {
      aiAbort = null;
      A.engineBusy = false;
      $("#btnSend").classList.remove("is-busy");
      $("#btnSend").querySelector("span").innerHTML = ICON("send");
      $("#btnStop").style.display = "none";
      $("#protocolText").innerHTML = '<span class="p-tag err">&lt;api&gt;</span> ' + esc(e.message || String(e));
      body.textContent += (body.textContent ? "\n\n" : "") + "【连接中断】" + esc(e.message || String(e));
      if (window.ST.parseReply(body.textContent).maintext) {
        emitAI(window.ST.parseReply(body.textContent), { live: true });
      } else {
        // 无正文可恢复: 清掉残留协议标签, 避免选项/总结混在正文里
        body.textContent = body.textContent
          .replace(/<option\b[^>]*>[\s\S]*?<\/option\s*>/gi, "")
          .replace(/<sum\s*>([\s\S]*?)<\/sum\s*>/gi, "")
          .replace(/<[a-z\/][^>]*>/gi, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        A.lastOptions = [];
        renderOptions([]);
        scrollStory();
      }
    });
  }

  function buildDemo(key, input) {
    const tpl = GD.DEMO_RESPONSES[key];
    const out = {
      maintext: tpl.main,
      options: tpl.options,
      sum: tpl.sum
    };
    return out;
  }

  function buildGeneric(input) {
    const texts = [
      "风里裹着焦糊与铁锈的气息。你站在" + state.地点 + "的街头，四周是尖叫、鸣笛与坍塌声交织的混乱。\n\n那座黑城就矗立在城市正中——沉默、庞大，像一块从天上砸进地表的墨玉。它没有门，没有窗，却让你感到它在「注视」着你。",
      "「信号中断了……」有人瘫坐在路边，喃喃重复着这句话。你低头看了看自己的手——皮肤完好，心跳真实。末日没有预告，它只是……降临了。\n\n你握紧拳头。至少现在，你还活着。",
      "远处传来密集的枪声，随即是令人牙酸的金属撕裂声——那支「大汉军队」正在清场。你压低身体，把呼吸放轻。混乱之中，活下来的人，才有资格思考明天。"
    ];
    const txt = A.pick(texts);
    return {
      maintext: txt,
      options: [
        { text: "寻找掩体，观察四周局势", tag: "求生", risk: false },
        { text: "向路人打听到底发生了什么", tag: "情报", risk: true },
        { text: "试着靠近黑城的边缘一探究竟", tag: "冒险", risk: true }
      ],
      sum: "主角于" + state.地点 + "直面黑城降临的末日，初步观察局势并决定下一步行动。"
    };
  }

  function emitAI(out, opts) {
    opts = opts || {};
    A.engineBusy = false;
    $("#btnSend").classList.remove("is-busy");
    $("#btnSend").querySelector("span").innerHTML = ICON("send");
    $("#btnStop").style.display = "none";

    if (out.sum) A.pushChronicle("残响纪元 · 拾遗", out.sum, true);

    // 变量命令 → 写入 state：<set> 行式协议（白名单校验, 弹幕+失败弹窗）
    if (out.setCommands && out.setCommands.length && window.VARS) {
      VARS.show(VARS.run(out.setCommands));
    }
    // 旧 <vars> JSON 通道（兼容保留）, 之后 renderAll() 统一刷新
    if (out.vars && Array.isArray(out.vars) && out.vars.length && window.VAR_MODEL) {
      const vr = window.VAR_MODEL.apply(state, out.vars);
      if (vr && vr.ok) {
        const pt = $("#protocolText");
        if (pt) pt.innerHTML += ' · <span class="p-tag">变量 ×' + vr.ok + (vr.err ? ' <span class="p-tag err">忽略' + vr.err + '</span>' : "") + "</span>";
        // 弹幕: 每条成功命令飘过 (位阶变化用紫色高亮, 获得/失去用颜色区分)
        (vr.changes || []).forEach(function (desc, i) {
          let cls = "";
          const d = String(desc || "");
          if (d.indexOf("位阶") >= 0) cls = "is-rank";
          else if (d.indexOf("获得") >= 0 || d.indexOf("追加") >= 0 || d.indexOf("更新") >= 0) cls = "is-gain";
          else if (d.indexOf("失去") >= 0 || d.indexOf("移除") >= 0) cls = "is-loss";
          setTimeout(function () { danmaku(d, cls); }, i * 550);
        });
      }
      if (vr && vr.err) toast("warn", "部分变量命令未执行", vr.err + " 条命令无效（路径/类型/枚举不符）");
    }

    // 打字机输出 (live 模式: 消息容器已由 liveAI 创建; 流式时已逐字填充,
    // 统一用解析后的干净正文覆盖, 清除流式过程中可见的原始标签)
    A.lastOptions = out.options || [];
    let msgEl = null;
    if (opts.live) {
      msgEl = A.lastAI;
      const liveBody = msgEl ? msgEl.querySelector(".msg-body") : null;
      if (liveBody) {
        // 模型只给选项/总结时 maintext 为空 → 清空原始标签文本, 选项由按钮区呈现
        liveBody.textContent = out.maintext || "";
        scrollStory();
      }
    } else {
      appendAIMsg(out.maintext, { drop: true });
      msgEl = A.lastAI;
    }
    // 结构化副本: 编辑主文本时按 正文/选项/总结 分栏编辑
    if (msgEl) msgEl.__out = { maintext: out.maintext || "", options: (out.options || []).slice(), sum: out.sum || "" };
    // 统一渲染选项 (appendAIMsg 内部也会渲染, 重复调用无害; 保证任何路径选项都出现)
    renderOptions(A.lastOptions);
    A.renderAll();

    // 记忆分层挂载: <sum> → 该回复的小总结, <events> → 大总结
    // 序数按「非空正文 AI 楼层」对齐 (与 buildStoryTurns / captureStory 口径一致,
    // 正文读 __out.maintext —— 打字机进行中 body 尚未填完也不受影响)
    if (String(out.maintext || "").trim() && (out.sum || out.events)) {
      let ord = 0;
      $$("#storyScroll .msg.is-ai").forEach(function (m) {
        const b = m.querySelector(".msg-body");
        if (!b) return;
        const o = m.__out || {};
        const txt = (typeof o.maintext === "string" && o.maintext) ? o.maintext : b.textContent;
        if (txt && txt.trim()) ord++;
      });
      const mi = ord - 1;
      if (mi >= 0) {
        memoryMeta[mi] = Object.assign({ small: "", large: "" }, memoryMeta[mi] || {});
        if (out.sum) memoryMeta[mi].small = out.sum;
        if (out.events) memoryMeta[mi].large = out.events;
      }
    }

    // 世界快照: 每条 AI 回复自动打点 (退档用)
    takeWorldSnap(out.sum ? String(out.sum).slice(0, 42) : "第 " + (worldSnaps.length + 1) + " 回合");

    // 自动存档 → 写入当前存档槽 (仅在游戏进行中)
    if (A.settings.autosave && A.currentSaveId) saveGame("自动");
  }
  /* ---------- 停止 / 重新生成 / 编辑 ---------- */
  function stopTyping() {
    if (aiAbort) {
      aiAbort.abort();
      aiAbort = null;
      toast("info", "已中断 AI 流", "已接收的文本保留在剧情区");
      return;
    }
    if (A.typeJob && A.typeJob.stop) {
      A.typeJob.stop(true);
      A.typeJob = null;
    }
    toast("info", "已停止输出", "文本停留在当前进度");
  }

  /* ---------- 消息操作: 重新生成 / 编辑 (悬停在每条消息右上角) ---------- */
  /* 重新生成某条 AI 回复: 删除该回复及其后的全部楼层, 用其前的用户指令重新推演 */
  function regenMsg(msg) {
    if (!msg) return;
    if (A.engineBusy) { toast("warn", "推演中", "请等待当前文本输出完毕"); return; }
    /* 其前最近的一条用户指令 (供关键词路由 / 世界书探测) */
    let el = msg.previousElementSibling, prevUser = "";
    while (el) {
      if (el.classList && el.classList.contains("msg") && !el.classList.contains("is-ai") && !el.classList.contains("is-sys")) {
        const b = el.querySelector(".msg-body");
        if (b && b.textContent) prevUser = b.textContent;
        break;
      }
      el = el.previousElementSibling;
    }
    /* 删除该回复及其后内容 (选项列表随 DOM 一并移除) */
    let cur = msg;
    while (cur) { const nx = cur.nextElementSibling; cur.remove(); cur = nx; }
    const ais = $$("#storyScroll .msg.is-ai");
    A.lastAI = ais.length ? ais[ais.length - 1] : null;
    memoryMeta = memoryMeta.slice(0, ais.length);   // 记忆分层序数与楼层重新对齐
    clearOptions(); A.lastOptions = [];
    appendSystemMsg("重新推演意识流…");
    simulateAI(prevUser || "__regen__", null);
  }

  /* 选项 → 编辑行: 【主线】文本 / 【风险】文本 */
  function optionToLine(o) {
    const tag = o.risk ? "风险" : (o.tag && o.tag !== "行动" ? o.tag : "");
    return (tag ? "【" + tag + "】" : "") + (o.text || "");
  }
  /* 编辑行 → 选项: 解析 【标签】前缀 */
  function lineToOption(line) {
    const t = String(line || "").trim();
    if (!t) return null;
    const m = t.match(/^【([^】]+)】(.*)$/);
    if (m) {
      const tag = m[1].trim();
      const text = m[2].trim();
      return { text: text || tag, tag: tag, risk: tag === "风险" };
    }
    return { text: t, tag: "行动", risk: false };
  }
  /* 更新最近一条协议总结 (fromSum), 无则新增 */
  function upsertChronicleSum(sum) {
    for (let i = chronicle.length - 1; i >= 0; i--) {
      if (chronicle[i].fromSum) {
        chronicle[i].body = sum;
        chronicle[i].time = fmtDate(state.日期) + " · " + (state.日期.时辰 || "");
        renderChronicle();
        return;
      }
    }
    pushChronicle("残响纪元 · 拾遗", sum, true);
  }
  function removeLastChronicleSum() {
    for (let i = chronicle.length - 1; i >= 0; i--) {
      if (chronicle[i].fromSum) { chronicle.splice(i, 1); renderChronicle(); return; }
    }
  }

  /* 编辑某条 AI 回复: 正文/选项/总结 三栏编辑。
     仅最新回复同步选项按钮区与编年史; 更早的回复只改写文本与 __out 副本 */
  function editMsg(msg) {
    if (!msg) { toast("warn", "无可编辑的内容", "请先触发一次对话"); return; }
    if (A.engineBusy) { toast("warn", "推演中", "请等待当前文本输出完毕"); return; }
    const body = msg.querySelector(".msg-body");
    if (body.querySelector(".edit-stack")) return;
    const old = body.textContent;
    const isLast = msg === A.lastAI;
    const out = msg.__out || { maintext: old, options: [], sum: "" };
    body.classList.add("is-editing");
    body.innerHTML = "";
    const box = document.createElement("div");
    box.className = "edit-stack";
    box.innerHTML =
      '<label class="edit-label">正文（叙事文本）</label>' +
      '<textarea class="edit-box" data-f="main" rows="8">' + A.esc(out.maintext) + "</textarea>" +
      '<label class="edit-label">选项（每行一个，可用【主线】【探索】【风险】标注类型）</label>' +
      '<textarea class="edit-box edit-box-sm" data-f="opts" rows="' + Math.max(1, (out.options || []).length) + '">' + A.esc((out.options || []).map(optionToLine).join("\n")) + "</textarea>" +
      '<label class="edit-label">总结（写入编年史）</label>' +
      '<textarea class="edit-box edit-box-sm" data-f="sum" rows="2">' + A.esc(out.sum || "") + "</textarea>" +
      '<div class="edit-actions">' +
      '<button class="btn btn-ghost btn-sm" data-edit-cancel>取消</button>' +
      '<button class="btn btn-primary btn-sm" data-edit-save>保存并重写</button></div>';
    body.appendChild(box);
    box.querySelector('[data-f="main"]').focus();
    box.querySelector("[data-edit-cancel]").onclick = function () { body.classList.remove("is-editing"); body.innerHTML = ""; body.textContent = old; };
    box.querySelector("[data-edit-save]").onclick = function () {
      const main = box.querySelector('[data-f="main"]').value.trim();
      if (!main) { toast("warn", "正文不能为空", "请保留至少一段正文"); return; }
      const opts = box.querySelector('[data-f="opts"]').value.split("\n").map(lineToOption).filter(Boolean);
      const sum = box.querySelector('[data-f="sum"]').value.trim();
      body.classList.remove("is-editing");
      body.innerHTML = "";
      body.textContent = main;
      msg.__out = { maintext: main, options: opts, sum: sum };
      if (isLast) {
        A.lastOptions = opts;
        renderOptions(opts);
        if (sum) upsertChronicleSum(sum); else removeLastChronicleSum();
        toast("success", "已重写", "正文 / 选项 / 总结已更新");
      } else {
        toast("success", "已重写", "历史回复正文已更新");
      }
    };
  }

  /* 编辑用户指令: 就地改写文本 (其后的 AI 回复不会自动重推, 可悬停该回复点「重新生成」) */
  function editUserMsg(msg) {
    const body = msg.querySelector(".msg-body");
    if (!body || body.querySelector(".edit-stack")) return;
    if (A.engineBusy) { toast("warn", "推演中", "请等待当前文本输出完毕"); return; }
    const old = body.textContent;
    body.classList.add("is-editing");
    body.innerHTML = "";
    const box = document.createElement("div");
    box.className = "edit-stack";
    box.innerHTML =
      '<textarea class="edit-box edit-box-sm" data-f="utext" rows="2">' + A.esc(old) + "</textarea>" +
      '<div class="edit-actions">' +
      '<button class="btn btn-ghost btn-sm" data-edit-cancel>取消</button>' +
      '<button class="btn btn-primary btn-sm" data-edit-save>保存</button></div>';
    body.appendChild(box);
    box.querySelector('[data-f="utext"]').focus();
    box.querySelector("[data-edit-cancel]").onclick = function () { body.classList.remove("is-editing"); body.innerHTML = ""; body.textContent = old; };
    box.querySelector("[data-edit-save]").onclick = function () {
      const v = box.querySelector('[data-f="utext"]').value.trim();
      if (!v) { toast("warn", "内容不能为空", ""); return; }
      body.classList.remove("is-editing");
      body.innerHTML = "";
      body.textContent = v;
      if (msg.nextElementSibling) toast("info", "已修改", "其后的 AI 回复基于旧指令，可悬停该回复点「重新生成」");
    };
  }

  /* ============================================================
     创建向导
     ============================================================ */
  const wizard = {
    step: 0,
    difficulty: "normal",
    identity: "survivor",
    alloc: { 力量: 0, 敏捷: 0, 智力: 0, 攻击: 0, 防御: 0, 穿透: 0, 魅力: 0, 幸运: 0 },
    talents: [],          // 多选: 预设天赋 id 数组
    customTalents: [],    // 自定义天赋: {name, tier, attr}
    faction: null,        // 黑城卫阵营效忠: POWER_RANK 的 name; null = 仅效忠黑城卫
    land: "changan",
    name: "无名旅者",
    age: "?",
    gender: "?",
    start: { 年: 1, 月: 1, 日: 1, 时: 0, 分: 0 },
    linked: false
  };

  /* 动态步骤: 黑城卫身份在「身份」之后插入 阵营效忠 隐藏步 */
  function wizardStepPanes() {
    return wizard.identity === "guard" ? ["0", "1", "F", "2", "T", "3", "4"] : ["0", "1", "2", "T", "3", "4"];
  }
  const WIZARD_LABELS = { 0: "选择降临难度", 1: "选择三身份体系", F: "黑城卫 · 阵营效忠", 2: "分配自由属性点", T: "天赋觉醒", 3: "选择降临地", 4: "接入神经链接" };

  /* 创建向导点数池: 难度属性点 = 属性分配 + 阵营效忠 共用; 天赋点独立 */
  function wizTalentSpent() {
    const w = wizard;
    const q = GD.TALENT_QUALITY || {};
    let sum = 0;
    w.talents.forEach(function (id) {
      const t = GD.TALENTS.find(x => x.id === id);
      if (t && q[t.tier]) sum += q[t.tier].cost;
    });
    w.customTalents.forEach(function (t) { if (q[t.tier]) sum += q[t.tier].cost; });
    return sum;
  }
  function wizFactionCost() {
    if (wizard.identity !== "guard" || !wizard.faction) return 0;
    const f = GD.POWER_RANK.find(x => x.name === wizard.faction);
    return f ? Math.max(1, 11 - f.rank) : 0;
  }
  function wizPoolLeft() {
    const d = GD.DIFFICULTIES.find(x => x.id === wizard.difficulty);
    const attrUsed = Object.keys(wizard.alloc).reduce((s, k) => s + wizard.alloc[k], 0);
    return Math.max(0, d.pts - attrUsed - wizFactionCost());
  }
  function wizTalentLeft() {
    const d = GD.DIFFICULTIES.find(x => x.id === wizard.difficulty);
    return Math.max(0, d.talentPts - wizTalentSpent());
  }
  function renderWizardSteps() {
    const w = wizard;
    const panes = wizardStepPanes();
    $("#wizardSteps").innerHTML = panes.map(function (pid, i) {
      return '<div class="wstep' + (i < w.step ? " is-done" : i === w.step ? " is-active" : "") + '" data-step="' + i + '">' +
        '<span class="ws-idx">' + (i + 1) + '</span><span class="ws-label">' + WIZARD_LABELS[pid] + "</span>" +
        (i < panes.length - 1 ? '<span class="ws-line"></span>' : "") + "</div>";
    }).join("");
  }

  function renderWizard() {
    const w = wizard;
    const panes = wizardStepPanes();
    if (w.step >= panes.length) w.step = panes.length - 1;
    const paneId = panes[w.step];

    // 步骤条
    renderWizardSteps();
    $("#createSub").textContent = "第 " + (w.step + 1) + " / " + panes.length + " 步 · " + WIZARD_LABELS[paneId];
    $$("#wizardBody .wstep-pane").forEach(function (p) { p.classList.toggle("is-active", p.id === "wpane-" + paneId); });
    $("#btnWizPrev").disabled = w.step === 0;
    $("#btnWizNext").textContent = paneId === "4" ? (w.linked ? "降临黑城" : "接入神经链接") : "下一步";

    // 只重建当前步骤的面板,避免每次点击都重新拼接整个中国地图 SVG
    if (paneId === "0") renderWizDiff();
    if (paneId === "1") renderWizIdentity();
    if (paneId === "2") renderWizAttr();
    if (paneId === "T") renderWizTalents();
    if (paneId === "F") renderWizFaction();
    if (paneId === "3") { ensureLandMap(); renderWizTime(); }
    if (paneId === "4") updateLinkSummary();
  }

  function renderWizDiff() {
    const w = wizard;
    $("#diffGrid").innerHTML = GD.DIFFICULTIES.map(function (x) {
      return '<div class="diff-card' + (x.id === w.difficulty ? " is-selected" : "") + '" data-diff="' + x.id + '">' +
        '<span class="dc-mark">' + ICON("check") + "</span>" +
        '<div class="dc-name">' + x.name + '</div>' +
        '<div class="dc-pts">自由属性点 ×' + x.pts + '</div>' +
        '<div class="dc-desc">' + x.desc + "</div></div>";
    }).join("");
    $$("#diffGrid .diff-card").forEach(function (c) {
      c.addEventListener("click", function () { w.difficulty = c.getAttribute("data-diff"); renderWizard(); });
    });
  }

  function renderWizIdentity() {
    const w = wizard;
    $("#identityGrid").innerHTML = GD.IDENTITIES.map(function (x) {
      return '<div class="id-card' + (x.id === w.identity ? " is-selected" : "") + '" data-ident="' + x.id + '">' +
        '<span class="ic-icon">' + ICON(x.icon) + "</span>" +
        '<div class="ic-name">' + x.name + '</div>' +
        '<div class="ic-sub">' + x.sub + '</div>' +
        '<div class="ic-desc">' + x.desc + "</div>" +
        '<span class="ic-tag">' + x.tag + "</span></div>";
    }).join("");
    $$("#identityGrid .id-card").forEach(function (c) {
      c.addEventListener("click", function () { w.identity = c.getAttribute("data-ident"); renderWizard(); });
    });
    // 角色之名 / 年龄 / 性别: 输入中不打断, 切换身份/重渲染时只同步值
    const ni = $("#wizName");
    if (ni) {
      if (document.activeElement !== ni) ni.value = w.name || "";
      if (!ni.dataset.bound) {
        ni.dataset.bound = "1";
        ni.addEventListener("input", function () { w.name = ni.value; });
      }
    }
    const ai = $("#wizAge");
    if (ai) {
      if (document.activeElement !== ai) ai.value = w.age && w.age !== "?" ? w.age : "";
      if (!ai.dataset.bound) {
        ai.dataset.bound = "1";
        ai.addEventListener("input", function () { w.age = ai.value.trim(); });
      }
    }
    const gi = $("#wizGender");
    if (gi) {
      gi.value = (w.gender && w.gender !== "?" && ["男", "女"].indexOf(w.gender) >= 0) ? w.gender : "?";
      if (!gi.dataset.bound) {
        gi.dataset.bound = "1";
        gi.addEventListener("change", function () { w.gender = gi.value; });
      }
    }
  }

  /* 属性分配步: 自由属性点 + 属性格 (与阵营共用点池显示) */
  function renderWizAttr() {
    const w = wizard;
    const id = GD.IDENTITIES.find(function (x) { return x.id === w.identity; });
    $("#wizFreePts").textContent = Math.max(0, wizPoolLeft());
    $("#wizAttrGrid").innerHTML = Object.keys(id.baseAttr).map(function (k) {
      const base = id.baseAttr[k];
      const val = base + (w.alloc[k] || 0);
      const pct = Math.max(6, Math.min(100, val / ATTR_MAX[k] * 100));
      return '<div class="attr-cell is-alloc" data-wattr="' + k + '">' +
        '<div class="a-head"><span class="a-name">' + ICON(ATTR_ICONS[k] || "star") + k + '</span>' +
        '<span class="a-val">' + val + "</span></div>" +
        '<span class="a-ctrl">' +
        '<button class="mini-btn" data-wdec="' + k + '" aria-label="减少">' + ICON("minus", 10) + "</button>" +
        '<button class="mini-btn" data-winc="' + k + '" aria-label="增加">' + ICON("plus", 10) + "</button></span>" +
        '<div class="a-bar"><i style="width:' + pct + '%"></i></div></div>';
    }).join("");
    window.ICON_HYDRATE($("#wizAttrGrid"));
    $("#wizAttrGrid .mini-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const key = btn.getAttribute("data-winc") ? btn.getAttribute("data-winc") : btn.getAttribute("data-wdec");
        wizAttrAdjust(key, !!btn.getAttribute("data-winc"));
      });
    });
  }

  /* 天赋觉醒步: 多选 + 自定义 + 随机 */
  function renderWizTalents() {
    const w = wizard;
    const d = GD.DIFFICULTIES.find(function (x) { return x.id === w.difficulty; });
    const Q = GD.TALENT_QUALITY;
    const tLeft = wizTalentLeft();
    const tp = $("#wizTalentPts");
    if (tp) tp.textContent = tLeft + " / " + d.talentPts;
    // 天赋多选: 按品质 rank 降序排列 (神话→史诗→灵阶→凡阶)
    const pool = GD.TALENTS.slice().sort(function (a, b) { return (Q[b.tier] ? Q[b.tier].rank : 0) - (Q[a.tier] ? Q[a.tier].rank : 0); });
    $("#wizTalentGrid").innerHTML = pool.map(function (x) {
      const sel = w.talents.indexOf(x.id) >= 0;
      const q = Q[x.tier] || { cost: 1, color: "common" };
      return '<div class="talent-pick' + (sel ? " is-selected" : "") + ' tq-' + q.color + '" data-talent="' + x.id + '">' +
        '<div class="tp-head"><span class="tp-icon">' + ICON(x.icon) + "</span>" +
        '<span class="tp-name">' + x.name + "</span>" +
        '<span class="tp-cost chip" style="font-size:8.5px">' + x.tier + " · " + q.cost + "点</span>" +
        '<span class="tp-check">' + ICON("check") + "</span></div>" +
        '<div class="tp-desc">' + x.desc + "</div></div>";
    }).join("");
    $$("#wizTalentGrid .talent-pick").forEach(function (c) {
      c.addEventListener("click", function () {
        const tid = c.getAttribute("data-talent");
        const t = GD.TALENTS.find(x => x.id === tid);
        const cost = (Q[t.tier] || { cost: 1 }).cost;
        const at = w.talents.indexOf(tid);
        if (at >= 0) w.talents.splice(at, 1);
        else {
          if (cost > wizTalentLeft()) { toast("warn", "天赋点不足", "剩余 " + wizTalentLeft() + " 点·「" + t.name + "」需 " + cost + " 点"); return; }
          w.talents.push(tid);
        }
        renderWizTalents();
      });
    });
    // 自定义天赋表单
    const addBtn = $("#wctAdd");
    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = "1";
      addBtn.addEventListener("click", function () {
        const name = ($("#wctName") || {}).value ? $("#wctName").value.trim() : "";
        const tier = ($("#wctQuality") || {}).value || "凡阶";
        const attr = ($("#wctAttr") || {}).value || "";
        if (!name) { toast("warn", "天赋名不能为空", "写一个 1~8 字的天赋名"); return; }
        if (GD.TALENTS.some(x => x.name === name) || w.customTalents.some(x => x.name === name)) { toast("warn", "名称重复", "已有同名天赋"); return; }
        const cost = (Q[tier] || { cost: 1 }).cost;
        if (cost > wizTalentLeft()) { toast("warn", "天赋点不足", "剩余 " + wizTalentLeft() + " 点·需 " + cost + " 点"); return; }
        w.customTalents.push({ name: name, tier: tier, attr: attr });
        if ($("#wctName")) $("#wctName").value = "";
        renderWizTalents();
      });
    }
    renderWizCustomList();
    // 随机天赋
    const rndBtn = $("#wizTalentRandom");
    if (rndBtn && !rndBtn.dataset.bound) {
      rndBtn.dataset.bound = "1";
      rndBtn.addEventListener("click", function () {
        w.talents = [];
        w.customTalents = [];
        const shuffled = GD.TALENTS.slice().sort(() => Math.random() - 0.5);
        shuffled.forEach(function (t) {
          const cost = (Q[t.tier] || { cost: 1 }).cost;
          if (cost <= wizTalentLeft()) w.talents.push(t.id);
        });
        renderWizTalents();
        toast("info", "随机天赋", "消耗 " + wizTalentSpent() + " / " + d.talentPts + " 天赋点");
      });
    }
    /* 属性分配已拆分至 renderWizAttr (上一步) */
  }

  /* 创建向导降临地 = 中国省会城市 POI (与主地图一致); 旧幻想 ID 兼容回退到默认城市 */
  function landPois() {
    return ((window.CHINA_MAP && window.CHINA_MAP.points_of_interest) || []);
  }
  function landCityById(id) {
    const pois = landPois();
    return pois.find(function (p) { return p.name === id; }) || pois[0] || { name: "北京", sub_region: "北京市", description: "中华人民共和国首都。" };
  }

  let landMapReady = false; // 中国地图 SVG 只渲染一次,点选只切换状态

  function ensureLandMap() {
    const lm = $("#landMap");
    if (!lm) return;
    if (!landMapReady) {
      const pois = landPois();
      if (!pois.length) return;
      lm.innerHTML = chinaSvg() + pois.map(function (x) {
        const p = mapPos(x.x, x.y);
        return '<button type="button" class="land-map-node' + (x.name === wizard.land ? " is-selected" : "") + '" data-land="' + esc(x.name) + '" title="' + esc(x.sub_region || "") + '" style="left:' + p.left + ";top:" + p.top + '">' +
          '<span class="lmn-dot"></span><span class="lmn-name">' + esc(x.name) + "</span></button>";
      }).join("");
      lm.onclick = function (e) {
        const b = e.target.closest("[data-land]");
        if (!b) return;
        wizard.land = b.getAttribute("data-land");
        updateLandPickUI();
      };
      landMapReady = true;
    }
    updateLandPickUI();
  }

  function updateLandPickUI() {
    const w = wizard;
    $$("#landMap [data-land]").forEach(function (b) {
      b.classList.toggle("is-selected", b.getAttribute("data-land") === w.land);
    });
    const land = landCityById(w.land);
    const info = $("#landPickInfo");
    if (!info) return;
    info.innerHTML = '<span class="lp-name">' + esc(land.name) + "</span>" +
      '<span class="lp-desc">' + esc(land.description || "") + "</span>" +
      '<span class="lp-meta"><span class="chip gold" style="font-size:8.5px">' + esc(land.sub_region || "") + "</span></span>";
  }

  /* 开局时间 (降临地步骤): 玩家自填 年/月/日 + 24 小时制时分 + 十二时辰 (双向联动) */
  function renderWizTime() {
    const w = wizard;
    const S = w.start || (w.start = { 年: 1, 月: 1, 日: 1, 时: 0, 分: 0 });
    const VM = window.VAR_MODEL || {};
    const fields = [
      ["wizTimeYear", "年"], ["wizTimeMonth", "月"], ["wizTimeDay", "日"], ["wizTimeHour", "时"], ["wizTimeMin", "分"]
    ];
    fields.forEach(function (f) {
      const el = $("#" + f[0]);
      if (!el) return;
      if (document.activeElement !== el) el.value = S[f[1]] != null ? S[f[1]] : "";
      if (!el.dataset.bound) {
        el.dataset.bound = "1";
        el.addEventListener("input", function () {
          const n = parseInt(el.value, 10);
          S[f[1]] = isNaN(n) ? null : n;
          if (f[1] === "时" && S.时 != null && VM.hourToShichen) {
            const sel = $("#wizTimeShichen");
            if (sel) sel.value = VM.hourToShichen(S.时);
          }
          syncWizTimePreview();
        });
      }
    });
    const sel = $("#wizTimeShichen");
    if (sel) {
      sel.value = VM.hourToShichen ? VM.hourToShichen(S.时 != null ? S.时 : 18) : "酉时";
      if (!sel.dataset.bound) {
        sel.dataset.bound = "1";
        sel.addEventListener("change", function () {
          if (VM.shichenToHour) {
            const hh = VM.shichenToHour(sel.value);
            if (!isNaN(hh)) {
              S.时 = hh;
              const hi = $("#wizTimeHour");
              if (hi && document.activeElement !== hi) hi.value = hh;
              syncWizTimePreview();
            }
          }
        });
      }
    }
    syncWizTimePreview();
  }

  function syncWizTimePreview() {
    const w = wizard;
    const S = w.start || {};
    const pv = $("#wizTimePreview");
    if (!pv) return;
    const VM = window.VAR_MODEL || {};
    const d = {
      年: S.年 || 1, 月: S.月 || 1, 日: S.日 || 1,
      时辰: VM.hourToShichen ? VM.hourToShichen(S.时 != null ? S.时 : 18) : "酉时",
      时: S.时, 分: S.分
    };
    pv.textContent = "开局时刻：" + fmtDate(d) + "  " + fmtClock(d) + "（" + ganZhiYear(d.年) + "）";
  }

  function wizAttrAdjust(key, isInc) {
    const w = wizard;
    const d = GD.DIFFICULTIES.find(function (x) { return x.id === w.difficulty; });
    const id = GD.IDENTITIES.find(function (x) { return x.id === w.identity; });
    if (isInc) {
      if (wizPoolLeft() <= 0) { toast("warn", "属性点不足", "属性/阵营/天赋 共用点池已耗尽"); return; }
      if ((id.baseAttr[key] + (w.alloc[key] || 0)) >= ATTR_MAX[key]) { toast("warn", "已达上限", key + " 无法继续提升"); return; }
      w.alloc[key] = (w.alloc[key] || 0) + 1;
    } else {
      if ((w.alloc[key] || 0) <= 0) { toast("info", "无法减少", key + " 已无分配点"); return; }
      w.alloc[key]--;
    }
    // 局部刷新数值与进度条
    const val = id.baseAttr[key] + (w.alloc[key] || 0);
    const cell = $("#wizAttrGrid .attr-cell[data-wattr=\"" + key + "\"]");
    if (cell) {
      cell.querySelector(".a-val").textContent = val;
      cell.querySelector(".a-bar i").style.width = Math.max(6, Math.min(100, val / ATTR_MAX[key] * 100)) + "%";
    }
    const fp = wizPoolLeft();
    $("#wizFreePts").textContent = Math.max(0, fp);
  }

  /* 自定义天赋已选列表 (含移除) */
  function renderWizCustomList() {
    const w = wizard;
    const Q = GD.TALENT_QUALITY;
    const box = $("#wctSelected");
    if (!box) return;
    const items = w.customTalents.map(function (t, i) {
      const q = Q[t.tier] || { cost: 1 };
      return '<span class="wct-chip" data-wct="' + i + '">' + esc(t.name) +
        '<i class="chip" style="font-size:8px">' + t.tier + "·" + q.cost + "点</i>" +
        (t.attr ? '<i style="font-style:normal;opacity:.7">' + t.attr + "+" + q.bonus + "</i>" : "") +
        '<b data-wct-del="' + i + '">' + ICON("x", 9) + "</b></span>";
    });
    w.talents.forEach(function (id) {
      const t = GD.TALENTS.find(x => x.id === id);
      if (!t) return;
      const q = Q[t.tier] || { cost: 1 };
      items.push('<span class="wct-chip">' + esc(t.name) + '<i class="chip" style="font-size:8px">' + t.tier + "·" + q.cost + "点</i></span>");
    });
    box.innerHTML = items.length ? items.join("") : "";
    $$("#wctSelected [data-wct-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        w.customTalents.splice(Number(b.getAttribute("data-wct-del")), 1);
        renderWizCustomList();
      });
    });
    window.ICON_HYDRATE(box);
  }

  /* 黑城卫 · 阵营效忠 (隐藏步): 按黑城排行消耗属性点, 显示新兵光环与装备 */
  function renderWizFaction() {
    const w = wizard;
    /* 黄巾军位列第十八 (末位): 强度与花费按排名梯度 */
    const factions = GD.POWER_RANK.slice().sort(function (a, b) { return a.rank - b.rank; });
    const rankLabel = f => f.rank;
    const costOf = f => 19 - f.rank;   // 18 档全唯一: 大秦 18 → 黄巾 1
    $("#wizFactionPts").textContent = wizPoolLeft() + " / " + GD.DIFFICULTIES.find(x => x.id === w.difficulty).pts;
    $("#wizFactionList").innerHTML =

      factions.map(function (f) {
        const sel = w.faction === f.name;
        return '<div class="fr-row' + (sel ? " is-selected" : "") + '" data-faction="' + esc(f.name) + '">' +
          '<span class="fr-rank">' + rankLabel(f) + "</span>" +
          '<span class="fr-main"><b>' + f.name + "</b><i>" + f.leader + " · " + f.threat + "</i></span>" +
          '<span class="fr-cost">' + costOf(f) + "点</span></div>";
      }).join("");
    $$("#wizFactionList .fr-row").forEach(function (row) {
      row.addEventListener("click", function () {
        const name = row.getAttribute("data-faction");
        if (!name) { w.faction = null; renderWizFaction(); return; }
        const f = GD.POWER_RANK.find(x => x.name === name);
        if (name !== w.faction && costOf(f) > wizPoolLeft()) { toast("warn", "属性点不足", "效忠「" + name + "」需 " + costOf(f) + " 点·剩余 " + wizPoolLeft() + " 点"); return; }
        w.faction = name;
        renderWizFaction();
      });
    });
    // 随机效忠: 在可负担的阵营里掷签
    const rnd = $("#wizFactionRandom");
    if (rnd && !rnd.dataset.bound) {
      rnd.dataset.bound = "1";
      rnd.addEventListener("click", function () {
        const affordable = factions.filter(f => costOf(f) <= wizPoolLeft());
        const f = affordable[Math.floor(Math.random() * affordable.length)];
        w.faction = f ? f.name : null;
        renderWizFaction();
      });
    }
    // 新兵包详情
    const f = GD.POWER_RANK.find(x => x.name === w.faction);
    const detail = $("#wizFactionDetail");
    if (!detail) return;
    if (!f) {
      detail.innerHTML = '<p class="text-dim" style="font-size:11px; line-height:1.8">未效忠任何阵营——只领黑城卫的份例：「黑城威仪」光环 + 制式皮甲。选择上方阵营可换取该势力的新兵配给。</p>';
      return;
    }
    const pack = GD.factionRecruit(f);
    detail.innerHTML =
      '<div class="fr-pack">' +
        '<div class="frp-sec"><span class="frp-cap">' + ICON("sparkles") + "新兵光环</span>" +
          '<div class="frp-item"><b>' + esc(pack.aura.name) + "</b><p>" + esc(pack.aura.desc) + "</p></div></div>" +
        '<div class="frp-sec"><span class="frp-cap">' + ICON("sword") + "新兵装备（入列配发）</span>" +
          pack.gear.map(function (g) {
            return '<div class="frp-item"><b>' + esc(g.name) + '</b><i class="chip" style="font-size:8px">' + g.quality + " · " + g.type + "</i><p>" + esc(g.desc) + (g.atk ? " 攻击+" + g.atk + "。" : "") + "</p></div>";
          }).join("") + "</div>" +
        '<div class="frp-sec"><span class="frp-cap">' + ICON("coin") + "初始声望</span>" +
          '<div class="frp-item"><p>' + f.name + " 声望 +" + pack.reputation + "（新兵份例）</p></div></div>" +
      "</div>";
    window.ICON_HYDRATE(detail);
  }

  /* 创建向导降临地 = 中国省会城市 POI (与主地图一致); 旧幻想 ID 兼容回退到默认城市 */

  function updateLinkSummary() {
    const w = wizard;
    const d = GD.DIFFICULTIES.find(function (x) { return x.id === w.difficulty; });
    const id = GD.IDENTITIES.find(function (x) { return x.id === w.identity; });
    $("#linkSummary").textContent = (w.name || "无名旅者") + " · " + id.name + " · " + d.name + " · 天赋" + (function () {
        const names = w.talents.map(function (id2) { const t = GD.TALENTS.find(x => x.id === id2); return t ? t.name : id2; }).concat(w.customTalents.map(t => t.name));
        return names.length ? "「" + names.join("/") + "」" : "未选择";
      })() + (w.identity === "guard" ? " · 效忠「" + (w.faction || "无归属（黑城卫）") + "」" : "") + " · 降临「" + landCityById(w.land).name + "」";
  }

  function wizardNext() {
    const w = wizard;
    const panes = wizardStepPanes();
    if (panes[w.step] === "4") {          // 链接步 (动态位置: 黑城卫在第 7 步)
      if (!w.linked) { startLink(); return; }
      finalizeCharacter();
      return;
    }
    w.step++;
    if (w.step >= panes.length) w.step = panes.length - 1;
    renderWizard();
  }

  function wizardPrev() {
    if (wizard.step === 0) return;
    wizard.step--;
    renderWizard();
  }

  function startLink() {
    const w = wizard;
    const bars = [
      { el: $("#lbA"), v: $("#lbAv") },
      { el: $("#lbB"), v: $("#lbBv") },
      { el: $("#lbC"), v: $("#lbCv") }
    ];
    $("#btnWizNext").disabled = true;
    $("#linkSub").textContent = "正在同步意识频率 · 校准五感基线 · 注入黑城世界书";
    const steps = [100, 96, 88];
    bars.forEach(function (b, i) {
      b.el.style.width = "0%";
      b.v.textContent = "0%";
      let p = 0;
      const iv = setInterval(function () {
        p += Math.max(1, Math.round((steps[i] / 22) * (0.6 + Math.random() * 0.8)));
        if (p >= steps[i]) {
          p = steps[i];
          clearInterval(iv);
          if (i === bars.length - 1) {
            setTimeout(function () {
              w.linked = true;
              $("#btnWizNext").disabled = false;
              $("#linkSub").textContent = "神经链接已建立 · 意识锚定完成";
              toast("success", "神经链接完成", "黑城世界书已注入，即将降临");
            }, 260);
          }
        }
        b.el.style.width = p + "%";
        b.v.textContent = p + "%";
      }, 22 + i * 16);
    });
  }

  /* 完成创建 → 组装 stat_data */
  function finalizeCharacter() {
    const w = wizard;
    const d = GD.DIFFICULTIES.find(function (x) { return x.id === w.difficulty; });
    const id = GD.IDENTITIES.find(function (x) { return x.id === w.identity; });
    const land = landCityById(w.land); // 降临地 = 中国省会城市 (旧幻想 ID 自动回退默认)
    // 多选天赋 (预设 + 自定义); 变量 talent 保留为第一个预设 (兼容后续引用)

    const s = GD.defaultStat();
    s.角色.姓名 = (w.name || "").trim() || "无名旅者";
    s.角色.年龄 = (w.age || "").trim() || "?";
    s.角色.性别 = w.gender || "?";
    s.角色.身份 = id.name;
    s.角色.位阶 = "猎奴";
    s.角色.自由属性点 = 0;
    // 应用身份基础属性 + 分配点
    Object.keys(id.baseAttr).forEach(function (k) {
      s.属性[k] = id.baseAttr[k] + (w.alloc[k] || 0);
    });
    s.生命 = { 当前: id.hp, 上限: id.hp };
    s.气力 = { 当前: id.stamina, 上限: id.stamina };
    s.光环 = id.aura ? [id.aura] : ["hunter"];
    /* 黑城卫是总称而非势力: 不效忠任何阵营时保持「无归属」 */
    // 天赋多选: 预设 id 数组 + 自定义写入 天赋详情
    s.天赋 = w.talents.slice();
    w.talents.forEach(function (id) {
      const t = GD.TALENTS.find(x => x.id === id);
      if (t && t.apply) t.apply(s);
    });
    if (!s.天赋详情 || typeof s.天赋详情 !== "object") s.天赋详情 = {};
    const Q = GD.TALENT_QUALITY || {};
    w.customTalents.forEach(function (t) {
      const q = Q[t.tier] || { bonus: 2 };
      if (t.attr && s.属性[t.attr] != null) s.属性[t.attr] += q.bonus;
      s.天赋详情[t.name] = { 效果: (t.attr ? t.attr + " +" + q.bonus + "；" : "") + t.tier + "自定义天赋" };
    });
    // 黑城卫 · 阵营效忠: 阵营/声望/新兵光环/新兵装备
    if (w.identity === "guard") {
      const f = w.faction ? GD.POWER_RANK.find(x => x.name === w.faction) : null;
      if (f) {
        const pack = GD.factionRecruit(f);
        s.阵营.名称 = f.name;
        s.阵营.立场 = f.stance;
        s.阵营.声望 = pack.reputation;
        s.光环.push(pack.aura.id);
        if (!s.光环详情 || typeof s.光环详情 !== "object") s.光环详情 = {};
        s.光环详情[pack.aura.id] = { 效果: pack.aura.desc };
        if (!s.背包详情 || typeof s.背包详情 !== "object") s.背包详情 = {};
        pack.gear.forEach(function (g, gi) {
          s.背包.push({ id: "fg" + f.rank + "_" + gi, ref: g.name, qty: 1 });
          s.背包详情[g.name] = { 物品类型: g.type, 物品效果: g.desc + (g.atk ? " 攻击+" + g.atk : "") };
          if (g.type === "武器" && !s.装备.武器1) {
            s.装备.武器1 = g.name;
            s.装备详情[g.name] = { 装备类型: "武器", 装备品质: g.quality, 基础属性: { 攻击: g.atk }, 耐久度: { 当前: g.dura, 上限: g.dura } };
          }
        });
      }
    }
    s.地点 = land.name;
    // 开局时间: 玩家自填 (年/月/日 + 24 小时制时分 → 十二时辰), 默认 黑城纪年1年1月1日 酉时(18:30)
    const st = w.start || {};
    const VM = window.VAR_MODEL || {};
    const shichen = VM.hourToShichen ? VM.hourToShichen(st.时 != null ? Number(st.时) : 0) : "子时";
    s.日期 = {
      年: Math.max(1, Math.min(9999, Number(st.年) || 1)),
      月: Math.max(1, Math.min(12, Number(st.月) || 1)),
      日: Math.max(1, Math.min(31, Number(st.日) || 1)),
      时辰: shichen,
      时: (st.时 != null ? Math.min(23, Math.max(0, Number(st.时))) : 0),
      分: (st.分 != null ? Math.min(59, Math.max(0, Number(st.分))) : 0)
    };
    /* 位阶按开局身份: 人类=猎奴 / 黑城势力=黑城卫 / 变异生物=异种 */
    s.角色.位阶 = id.id === "guard" ? "黑城卫" : id.id === "mutant" ? "异种" : "猎奴";
    s.角色.战力评价 = A.powerLabel(s.角色);
    state = s;
    A.state = s;
    // 重置编年史为种子（开局仅一条序章）
    chronicle = GD.CHRONICLE_SEED.slice();
    A.chronicle = chronicle;
    // 新开局: 清空记忆分层元数据与世界快照
    memoryMeta = [];
    worldSnaps = [];

    // 新游戏 → 创建独立存档槽位 (与其它存档数据不互通)
    if (window.ST) ensureDefaultLorebook(true); // 新开档: 强制恢复默认世界书 (即使之前删除过也会重建)
    currentSaveId = newSaveId();
    A.closeModal("modalCreate");   // 此时已有当前存档, 不会弹回标题画面
    // 清空剧情区
    storyScroll.innerHTML = "";
    lastAI = null; A.lastAI = null;
    $("#protocolStrip").style.display = "none";
    // 序章: 世界序幕 + 动态信息统计面板 (不再注入「系统 · 编年史」开场消息)
    A.lastOptions = GD.OPTION_SET_A;
    const panel = [
      "【信息统计面板】",
      "种族：" + id.name,
      "所在地：" + land.name + "（" + (land.prov || "") + "）",
      "选择天赋：" + (w.talents.length || w.customTalents.length ? w.talents.map(function (id) { const t = GD.TALENTS.find(x => x.id === id); return t ? t.name : id; }).concat(w.customTalents.map(t => t.name)).join("/") : "未选择"),
      "初始属性点：[力量 " + s.属性.力量 + "] [敏捷 " + s.属性.敏捷 + "] [智力 " + s.属性.智力 + "] [魅力 " + s.属性.魅力 + "] [幸运 " + s.属性.幸运 + "]"
    ].join("\n");
    appendAIMsg(GD.PROLOGUE[0] + "\n\n" + panel + "\n\n末日降临，游戏开始...", { drop: true, instant: true }); // 序章直接显示,不流式
    A.renderAll();
    saveGame("初始存档");
    toast("success", "降临完成", s.角色.姓名 + " · " + id.name + " · " + land.name + " · " + d.name + "难度");
  }

  /* 重置创建向导 (新游戏时调用, 避免停留在上一步骤) */
  function resetWizard() {
    wizard.step = 0;
    wizard.difficulty = "normal";
    wizard.identity = "survivor";
    wizard.alloc = { 力量: 0, 敏捷: 0, 智力: 0, 攻击: 0, 防御: 0, 穿透: 0, 魅力: 0, 幸运: 0 };
    wizard.talents = [];
    wizard.customTalents = [];
    wizard.faction = null;
    wizard.land = "北京";
    wizard.name = "无名旅者";
    wizard.age = "?";
    wizard.gender = "?";
    wizard.start = { 年: 1, 月: 1, 日: 1, 时: 0, 分: 0 };
    wizard.linked = false;
  }

  /* 随机降临地 */
  function randomLand() {
    const roll = $("#btnRandomLand");
    roll.classList.add("rolling");
    const phases = ["掷骰中…", "天命流转…", "卦象推演…", "落定！"];
    let pi = 0;
    const iv = setInterval(function () {
      $("#randomLandLabel").textContent = phases[Math.min(pi, 3)];
      pi++;
      if (pi > 3) {
        clearInterval(iv);
        roll.classList.remove("rolling");
        wizard.land = A.pick(landPois()).name;
        const land = landCityById(wizard.land);
        $("#randomLandLabel").textContent = "天命已定 · " + land.name + "（" + land.sub_region + "）";
        renderWizard();
        toast("info", "降临地已定", "天命为你选择了「" + land.name + " · " + land.sub_region + "」");
      }
    }, 480);
  }

  /* ============================================================
     设置 / 存档 / 全屏 / 主题
     ============================================================ */
  function applySettings() {
    document.documentElement.setAttribute("data-theme", A.settings.theme);
    $$("#themeTabs .tab-btn").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-theme-value") === A.settings.theme);
    });
    $("#speedVal").textContent = { 1: "极慢", 2: "慢", 3: "中", 4: "快", 5: "极速" }[A.settings.speed] || "中";
    $("#speedSlider").value = A.settings.speed;
    $("#fsVal").textContent = A.settings.fontSize;
    $("#fsSlider").value = A.settings.fontSize;
    document.documentElement.style.setProperty("--story-fs", A.settings.fontSize + "px");
    $("#swTypewriter").setAttribute("aria-checked", A.settings.streaming ? "true" : "false");
    $("#swAutosave").setAttribute("aria-checked", A.settings.autosave ? "true" : "false");
    $("#swAudio").setAttribute("aria-checked", A.settings.audio ? "true" : "false");
    const ai = A.settings.ai || {};
    $("#swAI").setAttribute("aria-checked", ai.enabled ? "true" : "false");
    $("#aiBaseUrl").value = ai.baseUrl || "";
    $("#aiApiKey").value = ai.apiKey || "";
    $("#aiModel").value = ai.model || "";
    renderPresetSelect(ai.preset);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(A.settings)); } catch (e) {}
  }

  /* 渲染预设下拉 (顶部栏预设模态框的 presetSelect, 显示当前应用预设) */
  function renderPresetSelect(selected) {
    const sel = $("#presetSelect");
    if (!sel) return;
    const presets = window.ST.loadPresets();
    const cur = selected || (A.settings.ai || {}).preset || "";
    let html = '<option value="">默认参数（温度 0.8）</option>';
    presets.forEach(function (p) {
      const isCur = p.name === cur;
      html += '<option value="' + A.esc(p.id) + '"' + (isCur ? " selected" : "") + ">" +
        A.esc(p.name) + (isCur ? " · 当前" : "") + "</option>";
    });
    sel.innerHTML = html;
  }

  /* 同步运行时世界书: 核心 + 全部已启用书的条目, 并失效索引缓存 */
  function syncLorebookRuntime() {
    if (!window.ST) return;
    const core = (window.ST_LOREBOOK_CORE || []).slice();
    const extra = [];
    window.ST.loadLorebooks().forEach(function (lb) {
      if (lb.enabled === false) return; // 停用的书不参与注入
      (lb.entries || []).forEach(function (e) {
        if (e.disabled) return;
        extra.push({ keys: e.keys || [], content: e.content || "", comment: e.comment || lb.name });
      });
    });
    window.ST_LOREBOOK = core.concat(extra);
    loreCache = null;
  }

  /* 确保默认世界书存在: 把内置核心条目落成一本「可见可管理」的书
     三种情况:
     ① 已有核心书(builtin 标记或同名) → 补入缺失的规范条目(格式规范/变量规范, 恒定注入), 清空隐形核心源
     ② 用户删除过核心书(coreSeeded 标记) 且非新开档 → 尊重删除意图, 不重建也不注入
     ③ 首次 或 新开档(force) → 创建「黑城核心设定」书并写入核心条目 (含规范条目, 保留 constant/order)
     force=true 由「降临/新开档」调用: 即使之前删除过默认世界书, 新档也会自动恢复。 */
  function ensureDefaultLorebook(force) {
    if (!window.ST) return;
    try {
      const books = window.ST.loadLorebooks();
      const hasCoreBook = books.some(function (b) { return b.builtin === "core" || b.name === "黑城核心设定"; });
      const seeded = localStorage.getItem("hce.lorebook.coreSeeded") === "1";
      if (hasCoreBook) {
        // 已有核心书: 补缺失规范条目 + 同步已存在规范条目的内容 (老存档自动升级到最新版)
        const coreBook = books.find(function (b) { return b.builtin === "core" || b.name === "黑城核心设定"; });
        if (coreBook) {
          const specs = window.SPEC_ENTRIES || [];
          const entries = coreBook.entries || [];
          let dirty = false;
          specs.forEach(function (sp) {
            if (!sp || !sp.comment) return;
            const idx = entries.findIndex(function (e) { return e.comment === sp.comment; });
            if (idx < 0) {
              const en = window.ST.createDefaultEntry();
              en.keys = (sp.keys || []).slice();
              en.content = sp.content || "";
              en.comment = sp.comment || "";
              en.order = sp.order !== undefined ? sp.order : 100;
              en.constant = !!sp.constant;
              entries.push(en);
              dirty = true;
            } else if (entries[idx].content !== sp.content) {
              // 内容版本升级: 用内置最新版覆盖 (恒定规范条目由系统维护)
              entries[idx].content = sp.content;
              entries[idx].constant = !!sp.constant;
              entries[idx].order = sp.order !== undefined ? sp.order : entries[idx].order;
              dirty = true;
            }
          });
          if (dirty) {
            coreBook.entries = entries;
            window.ST.saveLorebook(coreBook);
          }
        }
        if (!seeded) localStorage.setItem("hce.lorebook.coreSeeded", "1");
        window.ST_LOREBOOK_CORE = []; // 核心已并入可见书, 防重复注入
      } else if (seeded && !force) {
        window.ST_LOREBOOK_CORE = []; // 用户曾删除核心书 → 不再注入核心设定 (新开档 force 时会恢复)
      } else if ((window.ST_LOREBOOK_SEED || window.ST_LOREBOOK_CORE || []).length) {
        const lb = window.ST.createDefaultLorebook("黑城核心设定");
        lb.builtin = "core";
        lb.description = "内置默认世界书：黑城核心世界观、势力、人物与地点。可自由编辑或删除；重新开档会自动恢复。";
        lb.entries = (window.ST_LOREBOOK_SEED || window.ST_LOREBOOK_CORE || []).map(function (e) {
          const en = window.ST.createDefaultEntry();
          en.keys = (e.keys || []).slice();
          en.content = e.content || "";
          en.comment = e.comment || "";
          en.order = e.order !== undefined ? e.order : 100;
          en.constant = !!e.constant;
          return en;
        });
        if (lb.entries.length) {
          window.ST.saveLorebook(lb);
          localStorage.setItem("hce.lorebook.coreSeeded", "1");
          window.ST_LOREBOOK_CORE = []; // 核心已并入默认书, 防重复注入
        }
      }
    } catch (e) { /* 忽略 */ }
    syncLorebookRuntime();
  }

  /* ============================================================
     世界书 (skill LorebookModal / LorebookEditorModal / EntryForm)
     ============================================================ */
  let editingBookId = null;      // 当前编辑中的世界书 id
  let editingPresetId = null;    // 当前编辑中的预设 id
  let presetDraft = null;        // 预设编辑草稿 (深拷贝, 存入并应用才落库)

  /* 世界书列表 (LorebookModal): 每本一行, 启用开关 + 条目数 + 编辑/导出/删除 */
  function renderLorebookList() {
    const box = $("#lorebookList");
    if (!box) return;
    const books = window.ST.loadLorebooks();
    const totalEntries = books.reduce(function (s, b) { return s + (b.entries || []).length; }, 0);
    $("#lorebookSub").textContent = "共 " + books.length + " 本 · " + totalEntries + " 条 · 命中关键词 / 恒定注入自动生效" +
      (books.some(function (b) { return b.builtin === "core"; }) ? " · 含内置核心设定" : "");
    if (!books.length) {
      box.innerHTML = '<div class="empty-hint">尚无世界书。点「新建世界书」或「导入 JSON」。</div>';
      return;
    }
    box.innerHTML = books.map(function (b) {
      const enabled = b.enabled !== false;
      const n = (b.entries || []).length;
      return '<div class="lorebook-item' + (enabled ? "" : " is-off") + '" data-book="' + A.esc(b.id) + '">' +
        '<label class="preset-toggle lorebook-toggle" title="启用/停用本书">' +
        '<input type="checkbox" data-lb-enabled="' + A.esc(b.id) + '"' + (enabled ? " checked" : "") + ">" +
        '<span class="lorebook-toggle__label">' + (enabled ? "已启用" : "已停用") + "</span></label>" +
        '<div class="lorebook-item__main">' +
        '<div class="lorebook-item__name">' + A.esc(b.name) +
        (b.builtin === "core" ? ' <em class="lb-tab__core" title="内置默认设定">内置</em>' : "") + "</div>" +
        '<div class="lorebook-item__meta">' + n + " 条" + (b.description ? " · " + A.esc(b.description) : "") + "</div>" +
        "</div>" +
        '<div class="lorebook-item__actions">' +
        '<button class="btn btn-ghost btn-mini" data-lb-edit="' + A.esc(b.id) + '"><span data-icon="edit"></span>编辑</button>' +
        '<button class="btn btn-ghost btn-mini" data-lb-export="' + A.esc(b.id) + '"><span data-icon="arrow-up"></span>导出</button>' +
        '<button class="btn btn-ghost btn-mini" data-lb-delete="' + A.esc(b.id) + '" style="color:var(--crimson-bright,#e0897a)"><span data-icon="trash"></span></button>' +
        "</div>" +
        "</div>";
    }).join("");
    window.ICON_HYDRATE(box);

    // 启用/停用开关
    box.querySelectorAll("[data-lb-enabled]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        const b = window.ST.getLorebook(cb.getAttribute("data-lb-enabled"));
        if (!b) return;
        b.enabled = cb.checked;
        window.ST.saveLorebook(b);
        syncLorebookRuntime();
        renderLorebookList();
        toast("info", "世界书", cb.checked ? "「" + b.name + "」已启用，条目参与注入" : "「" + b.name + "」已停用");
      });
    });
    // 编辑 → 打开编辑器模态框
    box.querySelectorAll("[data-lb-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        editingBookId = btn.getAttribute("data-lb-edit");
        renderLorebookEditor();
        A.openModal("modalLorebookEditor");
      });
    });
    // 导出
    box.querySelectorAll("[data-lb-export]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const b = window.ST.getLorebook(btn.getAttribute("data-lb-export"));
        if (!b) { toast("warn", "无世界书", "请先创建或导入"); return; }
        window.ST.exportToJson(window.ST.exportLorebook(b), b.name + ".json");
        toast("info", "已导出", "「" + b.name + "」");
      });
    });
    // 删除
    box.querySelectorAll("[data-lb-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const b = window.ST.getLorebook(btn.getAttribute("data-lb-delete"));
        if (!b) return;
        A.confirmDialog({
          title: "删除世界书",
          body: "确定删除世界书「" + b.name + "」吗？共 " + (b.entries || []).length + " 条。此操作不可撤销。",
          okText: "删除",
          danger: true,
          icon: "trash"
        }).then(function (ok) {
          if (!ok) return;
          window.ST.deleteLorebook(b.id);
          renderLorebookList();
          syncLorebookRuntime();
          toast("info", "已删除", "「" + b.name + "」");
        });
      });
    });
  }

  /* 世界书编辑器 (LorebookEditorModal): 书名/描述 + EntryForm 条目列表 */
  function renderLorebookEditor() {
    const book = window.ST.getLorebook(editingBookId);
    if (!book) return;
    $("#lbEditorName").value = book.name || "";
    $("#lbEditorDesc").value = book.description || "";
    $("#lorebookEditorSub").textContent = (book.entries || []).length + " 条 · 修改自动保存并同步运行时";
    const list = $("#entryFormList");
    const entries = book.entries || [];
    if (!entries.length) {
      list.innerHTML = '<div class="empty-hint">本书暂无条目。点「＋ 条目」添加第一条。</div>';
      return;
    }
    list.innerHTML = entries.map(function (e) { return entryFormHtml(e); }).join("");
    window.ICON_HYDRATE(list);
    bindEntryForms(book);
  }

  /* EntryForm: 单条目编辑表单 (自动保存) */
  function entryFormHtml(e) {
    const keysText = (e.keys || []).join("\n");
    const secText = (e.secondaryKeys || []).join("\n");
    const nameText = (e.comment && String(e.comment).trim()) ? e.comment : ((e.keys || [])[0] || "未命名条目");
    return '<div class="entry-form" data-eid="' + A.esc(e.id) + '">' +
      '<div class="entry-form__head">' +
      '<span class="entry-form__name">' + A.esc(nameText) + "</span>" +
      '<span class="entry-form__len">' + (e.content || "").length + "字</span>" +
      (e.constant ? '<span class="lb-row-badge" title="恒定注入">恒</span>' : "") +
      '<button class="icon-btn btn-mini" data-del-entry="' + A.esc(e.id) + '" title="删除条目" aria-label="删除条目"><span data-icon="trash"></span></button>' +
      "</div>" +
      '<div class="lb-edit-grid">' +
      '<label>条目名<input class="ai-input lb-edit" data-f="comment" value="' + A.esc(e.comment || "") + '" placeholder="（可选）"></label>' +
      '<label>触发关键词<textarea class="ai-input lb-edit" data-f="keys" rows="2" placeholder="每行一个关键词">' + A.esc(keysText) + "</textarea></label>" +
      '<label>副键（收窄触发）<textarea class="ai-input lb-edit" data-f="secondaryKeys" rows="2" placeholder="可留空">' + A.esc(secText) + "</textarea></label>" +
      '<label style="grid-column:1/-1">注入内容<textarea class="ai-input lb-edit" data-f="content" rows="6" placeholder="关键词命中时注入系统提示的内容">' + A.esc(e.content || "") + "</textarea></label>" +
      "</div>" +
      '<div class="lb-edit-opts">' +
      '<label class="preset-toggle"><input type="checkbox" data-f="constant"' + (e.constant ? " checked" : "") + ">恒定注入</label>" +
      '<label class="preset-toggle"><input type="checkbox" data-f="disabled"' + (e.disabled ? " checked" : "") + ">停用（不注入）</label>" +
      '<label class="preset-toggle"><input type="checkbox" data-f="selective"' + (e.selective ? " checked" : "") + ">选择性触发（副键全命中）</label>" +
      '<label class="preset-toggle">触发概率<select class="ai-input lb-edit" data-f="probability" style="width:auto">' +
      [100, 75, 50, 25, 10].map(function (p) {
        return '<option value="' + p + '"' + (Number(e.probability) === p ? " selected" : "") + ">" + p + "%</option>";
      }).join("") +
      "</select></label>" +
      '<label class="preset-toggle">注入位置<select class="ai-input lb-edit" data-f="position" style="width:auto">' +
      Object.keys(window.ST.POSITION_BY_ID).map(function (k) {
        const v = window.ST.POSITION_BY_ID[k];
        return '<option value="' + v + '"' + (e.position === v ? " selected" : "") + ">" + A.esc(v) + "</option>";
      }).join("") +
      "</select></label>" +
      "</div>" +
      "</div>";
  }

  /* EntryForm 事件: 自动保存 / 勾选 / 删除条目 */
  function bindEntryForms(book) {
    const list = $("#entryFormList");
    if (!list) return;
    // 文本输入自动保存
    list.querySelectorAll(".lb-edit").forEach(function (el) {
      el.addEventListener("input", function () {
        const row = el.closest(".entry-form");
        if (!row) return;
        const entry = (book.entries || []).find(function (x) { return x.id === row.getAttribute("data-eid"); });
        if (!entry) return;
        const f = el.getAttribute("data-f");
        if (f === "keys" || f === "secondaryKeys") {
          entry[f] = el.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
        } else if (f === "probability") {
          entry[f] = Number(el.value);
        } else {
          entry[f] = el.value;
        }
        window.ST.saveLorebook(book);
        syncLorebookRuntime();
      });
    });
    // 勾选 (constant/disabled/selective)
    list.querySelectorAll('input[type="checkbox"][data-f]').forEach(function (cb) {
      cb.addEventListener("change", function () {
        const row = cb.closest(".entry-form");
        if (!row) return;
        const entry = (book.entries || []).find(function (x) { return x.id === row.getAttribute("data-eid"); });
        if (!entry) return;
        entry[cb.getAttribute("data-f")] = cb.checked;
        window.ST.saveLorebook(book);
        syncLorebookRuntime();
      });
    });
    // 删除条目
    list.querySelectorAll("[data-del-entry]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const eid = btn.getAttribute("data-del-entry");
        book.entries = (book.entries || []).filter(function (x) { return x.id !== eid; });
        window.ST.saveLorebook(book);
        renderLorebookEditor();
        syncLorebookRuntime();
        toast("info", "条目已删除", "世界书运行时已同步");
      });
    });
  }

  /* 合并视图写回：主分组（块数最多，组装器使用）更新顺序与 enabled；同步 prompts.enabled 与 settings.main */
  function writeBackMerged(st, merged) {
    const groups = window.ST.getPromptOrderGroups(st) || [];
    if (groups.length) {
      const main = groups.reduce(function (a, b) { return (b.order.length > a.order.length ? b : a); }, groups[0]);
      const orig = (Array.isArray(st.prompt_order) ? st.prompt_order : []).find(function (g) {
        return String(g.character_id) === String(main.character_id);
      });
      const origOrder = (orig && orig.order) || [];
      const origIds = {};
      origOrder.forEach(function (x) { if (x) origIds[x.identifier] = true; });
      const newOrder = merged
        .filter(function (o) { return o && (origIds[o.identifier] || o.enabled !== false); })
        .map(function (item) {
          const oi = origOrder.find(function (x) { return x && x.identifier === item.identifier; });
          return oi ? Object.assign({}, oi, { enabled: item.enabled }) : {
            identifier: item.identifier, name: item.name, role: item.role, enabled: item.enabled
          };
        });
      if (orig) orig.order = newOrder;
    }
    if (Array.isArray(st.prompts)) {
      const mp = st.prompts.find(function (x) { return x && x.identifier === "main"; });
      if (mp) st.main = mp.content;  // 主提示词已并入块列表，保持双写一致
      const enabledIds = {};
      merged.forEach(function (o) { if (o && o.enabled !== false) enabledIds[o.identifier] = true; });
      st.prompts.forEach(function (p) { if (p) p.enabled = !!enabledIds[p.identifier]; });
    }
  }

  /* PromptOrderEditor: 提示词块统一列表（不分组）：主分组顺序 + 其余分组补充 + 未入序 prompts。
     一个列表管顺序+启用+内容。主提示词 Main 也作为一块参与排序。 */
  function renderPromptBlocks() {
    const el = $("#promptOrder");
    if (!el || !presetDraft) return;
    const st = presetDraft.settings || {};
    const prompts = (st && Array.isArray(st.prompts)) ? st.prompts : [];
    const empty = $("#promptOrderEmpty");
    const lenEl = $("#promptOrderLen");
    if (!prompts.length) {
      el.innerHTML = "";
      if (empty) empty.hidden = false;
      if (lenEl) lenEl.textContent = "0 块";
      return;
    }
    if (empty) empty.hidden = true;

    const merged = window.ST.getMergedPromptOrder(st) || [];
    const orderIds = merged.map(function (o) { return o.identifier; });
    const byId = {};
    prompts.forEach(function (p) { if (p && p.identifier) byId[p.identifier] = p; });

    function row(item, idx, checked) {
      const role = item.role === "user" ? "U" : "S";
      const len = (item.content || "").length;
      const inOrder = idx !== null;
      return '<div class="po-item' + (checked ? "" : " is-off") + '" data-pid="' + A.esc(item.identifier) + '">' +
        '<div class="po-head">' +
          '<span class="po-chev" data-icon="chevron"></span>' +
          '<input type="checkbox" class="po-toggle"' + (checked ? " checked" : "") + ">" +
          '<span class="po-idx">' + (inOrder ? (idx + 1) : "") + "</span>" +
          '<span class="po-role' + (role === "U" ? " is-user" : "") + '">' + role + "</span>" +
          '<span class="po-name" title="点击展开/收起内容">' + A.esc(item.name || item.identifier) + "</span>" +
          '<span class="po-len">' + len + "字</span>" +
          '<button class="icon-btn btn-mini" data-act="up"' + (inOrder ? "" : " disabled") + ' title="上移" aria-label="上移"><span data-icon="arrow-up"></span></button>' +
          '<button class="icon-btn btn-mini" data-act="down"' + (inOrder ? "" : " disabled") + ' title="下移" aria-label="下移"><span data-icon="arrow-down"></span></button>' +
        "</div>" +
        '<div class="po-body" hidden>' +
          '<textarea class="ai-input po-editor" rows="6" placeholder="（此块无内容）"></textarea>' +
          '<p class="preset-hint" style="padding:0">编辑实时写回草稿，随「存入并应用」保存。</p>' +
        "</div>" +
      "</div>";
    }

    let html = "";
    let enabledCount = 0;
    merged.forEach(function (o, i) {
      const p = byId[o.identifier];
      if (!p) return;
      if (o.enabled !== false) enabledCount++;
      html += row({
        identifier: p.identifier,
        name: p.name || o.name || p.identifier,
        role: o.role || p.role || "system",
        content: p.content || ""
      }, i, o.enabled !== false);
    });
    prompts.forEach(function (p) {
      if (p && p.identifier && orderIds.indexOf(p.identifier) === -1) {
        html += row({
          identifier: p.identifier,
          name: p.name || p.identifier,
          role: p.role || "system",
          content: p.content || ""
        }, null, p.enabled !== false);
      }
    });
    el.innerHTML = html;
    window.ICON_HYDRATE(el);
    if (lenEl) lenEl.textContent = enabledCount + " 启用 · " + prompts.length + " 共";
    // 恢复展开状态
    if (presetDraft._promptSel) {
      const openRow = findBlockRow(presetDraft._promptSel);
      if (openRow) expandPromptRow(openRow, presetDraft._promptSel);
    }
  }

  function findBlockRow(identifier) {
    const el = $("#promptOrder");
    if (!el || !identifier) return null;
    const rows = el.querySelectorAll("[data-pid]");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].dataset.pid === identifier) return rows[i];
    }
    return null;
  }

  function expandPromptRow(rowEl, identifier) {
    if (!presetDraft || !rowEl) return;
    const prompts = presetDraft.settings.prompts;
    const p = Array.isArray(prompts) ? prompts.find(function (x) { return x && x.identifier === identifier; }) : null;
    presetDraft._promptSel = identifier;
    rowEl.classList.add("is-open");
    const body = rowEl.querySelector(".po-body");
    if (body) body.hidden = false;
    const ta = rowEl.querySelector(".po-editor");
    if (ta && document.activeElement !== ta) ta.value = (p && p.content) || "";
    if (rowEl.scrollIntoView) rowEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function collapsePromptRow(rowEl, identifier) {
    flushPromptContent(identifier);
    if (!rowEl) return;
    rowEl.classList.remove("is-open");
    const body = rowEl.querySelector(".po-body");
    if (body) body.hidden = true;
    if (presetDraft && presetDraft._promptSel === identifier) presetDraft._promptSel = undefined;
  }

  function togglePrompt(identifier) {
    if (!presetDraft || !identifier) return;
    const rowEl = findBlockRow(identifier);
    if (!rowEl) return;
    if (presetDraft._promptSel === identifier) {
      collapsePromptRow(rowEl, identifier);
      return;
    }
    if (presetDraft._promptSel) {
      const prev = findBlockRow(presetDraft._promptSel);
      if (prev) collapsePromptRow(prev, presetDraft._promptSel);
    }
    expandPromptRow(rowEl, identifier);
  }

  /* 保存/收起前把展开行编辑区内容写回草稿（防止直接保存丢失未提交的编辑） */
  function flushPromptContent(identifier) {
    if (!presetDraft) return;
    const pid = identifier || presetDraft._promptSel;
    if (!pid) return;
    const rowEl = findBlockRow(pid);
    const ta = rowEl && rowEl.querySelector(".po-editor");
    if (!ta) return;
    const prompts = presetDraft.settings.prompts;
    if (!Array.isArray(prompts)) return;
    const p = prompts.find(function (x) { return x && x.identifier === pid; });
    if (p) p.content = ta.value;
  }

  /* 渲染预设管理 (PresetModal: 下拉选择 + 采样参数 + 提示词块统一列表, 草稿制) */
  function renderPresetManager() {
    const body = $("#modalPreset .modal-body");
    const sel = $("#presetSelect");
    if (!body || !sel) return;
    const presets = window.ST.loadPresets();
    const cur = (A.settings.ai || {}).preset || "";
    $("#presetSub").textContent = "共 " + presets.length + " 个 · 草稿编辑，存入并应用后参数生效";

    // 空状态: 显示提示, 隐藏编辑区
    const hint = $("#presetEmpty");
    const sections = $$(".preset-section", body);
    const saveRow = $("#btnPresetSave") ? $("#btnPresetSave").parentElement : null;
    if (!presets.length) {
      sel.innerHTML = '<option value="">（无预设）</option>';
      presetDraft = null;
      if (hint) hint.style.display = "block";
      sections.forEach(function (s) { s.style.display = "none"; });
      if (saveRow) saveRow.style.display = "none";
      return;
    }
    if (hint) hint.style.display = "none";
    sections.forEach(function (s) { s.style.display = ""; });
    if (saveRow) saveRow.style.display = "";
    // 下拉: 保留用户当前选择 (change 后重渲染不丢失), 失效则回落到当前应用预设或第一个
    const prev = sel.value;
    let pick = presets.some(function (p) { return p.id === prev; })
      ? prev
      : ((window.ST.getPresetByName(cur) || {}).id || presets[0].id);
    sel.innerHTML = presets.map(function (p) {
      const isCur = p.name === cur;
      return '<option value="' + A.esc(p.id) + '"' + (p.id === pick ? " selected" : "") + ">" +
        A.esc(p.name) + (isCur ? " · 当前" : "") + "</option>";
    }).join("");

    const p = window.ST.getPreset(pick) || presets[0];
    if (!p) return;
    editingPresetId = p.id;
    presetDraft = JSON.parse(JSON.stringify(p));  // 深拷贝草稿，避免未保存即污染 store
    if (!presetDraft.settings) presetDraft.settings = {};
    const S = presetDraft.settings;
    if (!Array.isArray(S.prompts)) S.prompts = [];
    $("#presetName").value = presetDraft.name || "";
    $("#presetTemp").value = S.temp_openai !== undefined ? S.temp_openai : 0.8;
    $("#presetTopP").value = S.top_p_openai !== undefined ? S.top_p_openai : 0.9;
    $("#presetTopK").value = S.top_k_openai !== undefined ? S.top_k_openai : 0;
    $("#presetTopA").value = S.top_a_openai !== undefined ? S.top_a_openai : 0;
    $("#presetMinP").value = S.min_p_openai !== undefined ? S.min_p_openai : 0;
    $("#presetRepPen").value = S.repetition_penalty_openai !== undefined ? S.repetition_penalty_openai : 1;
    $("#presetFreqPen").value = S.freq_pen_openai !== undefined ? S.freq_pen_openai : 0;
    $("#presetPresPen").value = S.pres_pen_openai !== undefined ? S.pres_pen_openai : 0;
    $("#presetCtx").value = S.openai_max_context || 4096;
    $("#presetTokens").value = S.openai_max_tokens || 900;
    $("#presetStream").checked = !!S.stream_openai;
    presetDraft._promptSel = undefined;  // 重置折叠展开状态
    renderPromptBlocks();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    }
  }

  /* ============================================================
     事件绑定
     ============================================================ */
  function bindEvents() {
    // 顶部栏
    $("#btnChronicle").addEventListener("click", function () {
      unreadChronicle = false;
      $("#chronicleDot").classList.add("hidden");
      A.openModal("modalChronicle");
      A.renderChronicle();
    });
    // 右栏入口磁贴 → 各自独立弹窗 (事件委托; 地图/记忆/快照/设置有前置刷新)
    $("#rightCol").addEventListener("click", function (e) {
      const entry = e.target.closest("[data-modal]");
      if (!entry) return;
      const id = entry.getAttribute("data-modal");
      if (!id || !$("#" + id)) return;
      if (id === "modalSettings") A.applySettings();
      if (id === "modalMemory") renderMemoryModal();
      if (id === "modalWorldSnap") renderWorldSnaps();
      if (id === "modalLoad") A.renderSaveSlots();
      A.openModal(id);
      if (id === "modalPanelMap") { renderMap(); showMapInfo(state.地点 || "changan"); }
    });
    // 窄屏: 右栏情报抽屉开关 (右栏在窄屏为固定抽屉)
    $("#btnSideInfo").addEventListener("click", function () {
      document.body.classList.toggle("right-open");
    });
    $("#rightDrawerBackdrop").addEventListener("click", function () { document.body.classList.remove("right-open"); });
    // 世界快照弹窗内部操作 (入口在右栏「世界快照」磁贴)
    $("#btnSnapNow").addEventListener("click", function () {
      takeWorldSnap("手动打点");
      renderWorldSnaps();
      toast("success", "已打点", "世界快照已记录，可随时退档到此");
    });
    $("#btnSnapClear").addEventListener("click", clearWorldSnaps);
    $("#worldSnapList").addEventListener("click", function (e) {
      const del = e.target.closest("[data-wsnap-del]");
      if (del) { e.stopPropagation(); deleteWorldSnap(del.getAttribute("data-wsnap-del")); return; }
      const row = e.target.closest("[data-wsnap]");
      if (row) loadWorldSnap(row.getAttribute("data-wsnap"));
    });
    // 记忆分层弹窗内部操作 (入口在右栏「记忆分层」磁贴; 打开时刷新列表见下方磁贴委托)
    $("#swMemory").addEventListener("click", function () {
      settings.memory.enabled = settings.memory.enabled === false ? true : false;
      const sw = $("#swMemory");
      if (sw) sw.setAttribute("aria-checked", settings.memory.enabled === false ? "false" : "true");
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
      renderMemoryModal();
    });
    $("#btnMemSaveCfg").addEventListener("click", function () {
      settings.memory.layers = Math.max(1, Math.min(40, Number($("#memLayers").value) || 6));
      settings.memory.largeStart = Math.max(2, Math.min(100, Number($("#memLargeStart").value) || 14));
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
      renderMemoryModal();
      toast("success", "记忆分层已更新", "最新 " + settings.memory.layers + " 层全文 · 倒数第 " + settings.memory.largeStart + " 层起大总结");
    });
    $("#btnMemFillLatest").addEventListener("click", fillLatestSummary);
    // 总结编辑 (委托: 修改即生效, 下次自动存档持久化)
    ["#memSmallList", "#memLargeList"].forEach(function (sel) {
      const box = $(sel);
      if (!box) return;
      box.addEventListener("change", function (e) {
        const ta = e.target.closest("[data-mem-idx]");
        if (!ta) return;
        const idx = Number(ta.getAttribute("data-mem-idx"));
        const kind = ta.getAttribute("data-mem-kind");
        memoryMeta[idx] = Object.assign({ small: "", large: "" }, memoryMeta[idx] || {});
        memoryMeta[idx][kind === "large" ? "large" : "small"] = String(ta.value || "").trim();
        if (A.settings.autosave && A.currentSaveId) saveGame("自动");
      });
    });
    $("#btnFullscreen").addEventListener("click", toggleFullscreen);
    document.addEventListener("fullscreenchange", function () {
      $("#btnFullscreen").querySelector("span").innerHTML = ICON(document.fullscreenElement ? "minimize" : "maximize");
    });

    // 模态背景/关闭 (委托: 覆盖动态创建的关闭按钮)
    document.addEventListener("click", function (e) {
      const closer = e.target.closest("[data-close-modal]");
      if (closer) { A.closeModal(closer.getAttribute("data-close-modal")); return; }
      const backdrop = e.target.closest(".modal-backdrop");
      if (backdrop) { A.closeModal(backdrop.getAttribute("data-close-modal")); }
    });

    // 创建向导
    $("#btnCreateClose").addEventListener("click", function () { A.closeModal("modalCreate"); });
    $("#btnWizNext").addEventListener("click", wizardNext);
    $("#btnWizPrev").addEventListener("click", wizardPrev);
    $("#btnRandomLand").addEventListener("click", randomLand);

    // 窄屏「状态」按钮 → 打开左栏覆盖层 (左栏在窄屏隐藏, 需此入口)
    $("#btnSideStatus").addEventListener("click", function () {
      if (window.innerWidth <= 1100) openOverlay("left");
    });

    // 地图节点 (事件委托)
    // 地图缩放: 按钮 + 滚轮 (滚轮以光标为锚点)
    $("#map-zoom-in").addEventListener("click", function () {
      const v = mapView || mapViewFull();
      mapZoomAt(v.x + v.w / 2, v.y + v.h / 2, 0.78);
    });
    $("#map-zoom-out").addEventListener("click", function () {
      const v = mapView || mapViewFull();
      mapZoomAt(v.x + v.w / 2, v.y + v.h / 2, 1.28);
    });
    $("#map-zoom-reset").addEventListener("click", function () {
      mapView = mapViewFull();
      mapApplyView();
    });
    $("#mapCanvas").addEventListener("wheel", function (e) {
      e.preventDefault();
      const v = mapView || (mapView = mapViewFull());
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = v.x + (e.clientX - rect.left) / rect.width * v.w;
      const my = v.y + (e.clientY - rect.top) / rect.height * v.h;
      mapZoomAt(mx, my, e.deltaY > 0 ? 1.28 : 0.78);
    }, { passive: false });
    // 地图拖拽: pointer 平移视图 (拖拽超过阈值后吞掉紧随的 click, 避免误点城市)
    let mapDrag = null;
    let mapDragged = false;
    $("#mapCanvas").addEventListener("pointerdown", function (e) {
      if (!mapView) mapView = mapViewFull();
      mapDrag = { sx: e.clientX, sy: e.clientY, vx: mapView.x, vy: mapView.y, moved: false };
      mapDragged = false;
      this.classList.add("is-dragging");
      if (this.setPointerCapture) { try { this.setPointerCapture(e.pointerId); } catch (err) {} }
    });
    $("#mapCanvas").addEventListener("pointermove", function (e) {
      if (!mapDrag) return;
      const dx = e.clientX - mapDrag.sx, dy = e.clientY - mapDrag.sy;
      if (!mapDrag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      mapDrag.moved = true;
      const rect = this.getBoundingClientRect();
      const full = mapViewFull();
      let x = mapDrag.vx - (dx / rect.width) * mapView.w;
      let y = mapDrag.vy - (dy / rect.height) * mapView.h;
      x = Math.max(full.x, Math.min(full.x + full.w - mapView.w, x));
      y = Math.max(full.y, Math.min(full.y + full.h - mapView.h, y));
      mapView.x = x; mapView.y = y;
      mapApplyView();
    });
    function mapDragEnd() {
      if (mapDrag && mapDrag.moved) mapDragged = true;
      mapDrag = null;
      const c = $("#mapCanvas");
      if (c) c.classList.remove("is-dragging");
    }
    $("#mapCanvas").addEventListener("pointerup", mapDragEnd);
    $("#mapCanvas").addEventListener("pointercancel", mapDragEnd);
    $("#mapCanvas").addEventListener("click", function (e) {
      if (mapDragged) { mapDragged = false; return; }
      const n = e.target.closest("[data-node]");
      if (!n) return;
      if (n.classList.contains("is-locked")) {
        toast("warn", "区域封锁", n.title || "尚未解锁");
        return;
      }
      A.showMapInfo(n.getAttribute("data-node"));
    });

    // NPC 行
    $("#npcList").addEventListener("click", function (e) {
      const row = e.target.closest("[data-npc]");
      if (!row) return;
      openNpcModal(row.getAttribute("data-npc"));
    });

    // 装备/背包物品
    document.addEventListener("click", function (e) {
      const gear = e.target.closest("[data-gear]");
      if (gear) { openItemModal(gear.getAttribute("data-gear")); return; }
      const item = e.target.closest("[data-item]");
      if (item) { openItemModal(item.getAttribute("data-item")); return; }
    });

    // 左栏背包按钮
    $("#btnOpenInventory").addEventListener("click", function () {
      openInventoryModal();
    });
    $("#btnOpenPower").addEventListener("click", function () {
      A.renderPowerRank();
      A.openModal("modalPower");
    });

    // 输入框
    const inp = $("#dockInput");
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendCustom();
      }
      if (e.key === "Escape") { A.closeTopModal(); }
    });
    inp.addEventListener("input", function () {
      inp.style.height = "auto";
      inp.style.height = Math.min(inp.scrollHeight, 140) + "px";
    });
    $("#btnSend").addEventListener("click", sendCustom);
    $("#btnStop").addEventListener("click", stopTyping);
    // 消息悬停操作: 重新生成 / 编辑 (AI 与用户消息右上角, 事件委托)
    storyScroll.addEventListener("click", function (e) {
      const b = e.target.closest("[data-ma]");
      if (!b) return;
      const msg = b.closest(".msg");
      if (!msg) return;
      const act = b.getAttribute("data-ma");
      if (act === "regen") regenMsg(msg);
      else if (msg.classList.contains("is-ai")) editMsg(msg);
      else editUserMsg(msg);
    });

    // 设置
    $$("#themeTabs .tab-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        A.settings.theme = b.getAttribute("data-theme-value");
        A.applySettings();
        toast("info", "主题已切换", { ink: "墨玉", crimson: "赤焰", jade: "青瓷" }[A.settings.theme]);
      });
    });
    $("#speedSlider").addEventListener("input", function () {
      A.settings.speed = Number(this.value);
      A.applySettings();
    });
    $("#fsSlider").addEventListener("input", function () {
      A.settings.fontSize = Number(this.value);
      A.applySettings();
    });
    $("#swTypewriter").addEventListener("click", function () {
      A.settings.streaming = !A.settings.streaming;
      A.settings.typewriter = A.settings.streaming; // 旧字段同步
      A.applySettings();
      toast("info", "流式传输", A.settings.streaming ? "已开启：AI 回复逐字流式浮现" : "已关闭：一次性输出全文");
    });
    $("#swAutosave").addEventListener("click", function () {
      A.settings.autosave = !A.settings.autosave;
      A.applySettings();
      if (A.settings.autosave) { A.saveGame("自动"); toast("success", "自动存档已开启", "每次状态变更后写入本地存档"); }
    });
    $("#swAudio").addEventListener("click", function () {
      A.settings.audio = !A.settings.audio;
      A.applySettings();
      toast("info", "环境音效", "原型版暂未接入音频通道");
    });

    // AI 接入 (SillyTavern 协议)
    $("#swAI").addEventListener("click", function () {
      A.settings.ai = A.settings.ai || {};
      A.settings.ai.enabled = !A.settings.ai.enabled;
      A.applySettings();
      toast("info", A.settings.ai.enabled ? "AI 引擎已启用" : "AI 引擎已关闭",
        A.settings.ai.enabled ? "剧情将由真实 LLM 驱动（世界书始终生效）" : "已回退内置离线推演");
    });
    // 地址由 sillytavern.js 的 apiEndpoint 自动路由: 本地服务器打开自动走 /api/proxy, 否则直连
    const AI_FIELD_MAP = { aiBaseUrl: "baseUrl", aiApiKey: "apiKey", aiModel: "model" };
    Object.keys(AI_FIELD_MAP).forEach(function (id) {
      $("#" + id).addEventListener("input", function () {
        A.settings.ai = A.settings.ai || {};
        A.settings.ai[AI_FIELD_MAP[id]] = this.value.trim();
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(A.settings)); } catch (e) {}
      });
    });
    $("#btnTestAI").addEventListener("click", function () {
      const ai = A.settings.ai || {};
      const url = ai.baseUrl || "";
      const key = $("#aiApiKey").value.trim();
      const model = $("#aiModel").value.trim();
      if (!url) { toast("warn", "测试连接", "请先填写接口地址"); return; }
      const st = $("#aiStatus");
      st.style.display = "block";
      st.className = "ai-status";
      st.textContent = "正在测试 " + model + " …";
      window.ST.testConnection({ baseUrl: url, apiKey: key, model: model || "gpt-4o-mini" }).then(function (r) {
        st.className = "ai-status ok";
        st.textContent = "✓ 连接成功 · 模型回应：" + r.reply;
      }).catch(function (e) {
        st.className = "ai-status err";
        st.textContent = "✗ 连接失败：" + (e.message || String(e));
      });
    });
    // 顶部栏: 世界书 / 预设 (skill LorebookModal / PresetModal 入口)
    $("#btnLorebook").addEventListener("click", function () {
      A.renderLorebookList();
      A.openModal("modalLorebook");
    });
    $("#btnPreset").addEventListener("click", function () {
      A.renderPresetManager();
      A.openModal("modalPreset");
    });

    // 标题画面
    $("#btnTitleNew").addEventListener("click", titleStartNew);
    $("#btnTitleContinue").addEventListener("click", titleContinue);
    $("#btnTitleSettings").addEventListener("click", function () {
      A.applySettings();
      A.openModal("modalSettings");
    });

    // 存档: 点击「存档」→ 命名弹窗 → 确认后生成新的命名存档位
    $("#btnSaveNamed").addEventListener("click", openSaveName);
    $("#btnSaveNameOk").addEventListener("click", confirmSaveName);
    $("#saveNameInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") confirmSaveName();
    });
    // 返回主菜单 (离开前自动落盘)
    $("#btnReturnMenu").addEventListener("click", returnToMenu);
    $("#btnNewGame").addEventListener("click", function () {
      A.confirmDialog({
        title: "开启新游戏",
        body: "将创建一个全新的存档槽并进入角色创建。当前存档槽保留（数据互不互通）。",
        okText: "新游戏",
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        A.currentSaveId = null;   // 新游戏 → 新槽位, 不覆盖旧档
        A.closeModal("modalLoad");
        $("#titleScreen").classList.remove("is-visible");
        A.openModal("modalCreate");
        resetWizard();
        if (window.ST) syncLorebookRuntime();  // 确保默认世界书就绪
        renderWizard();
      });
    });
    $("#saveSlots").addEventListener("click", function (e) {
      const del = e.target.closest("[data-del]");
      if (del) {
        e.stopPropagation();
        const id = del.getAttribute("data-del");
        A.confirmDialog({
          title: "删除存档",
          body: "此存档槽将被永久删除，不可恢复。",
          okText: "删除",
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          A.deleteSave(id);
          A.renderSaveSlots();
          updateTitleContinue();
          toast("info", "已删除存档", "该槽位已清空");
        });
        return;
      }
      const slot = e.target.closest("[data-load]");
      if (!slot) return;
      const id = slot.getAttribute("data-load");
      const loaded = A.loadGame(id);
      if (loaded && loaded.state) {
        A.closeModal("modalLoad");
        $("#titleScreen").classList.remove("is-visible");
        A.restoreStory(loaded.messages || []);
        A.renderAll();
        const n = (loaded.messages || []).filter(function (m) { return m.role !== "sys"; }).length;
        toast("success", "会话已恢复", state.角色.姓名 + " Lv." + state.角色.等级 + " · " + state.地点 + (n ? " · " + n + " 条对话" : ""));
        // 恢复最后选项为空
        A.lastOptions = [];
      } else {
        toast("warn", "会话记录不存在", "请先开始游戏并保存");
      }
    });

    // 导入世界书 / 导入预设 (SillyTavern JSON) — 入口在顶部栏世界书/预设模态框
    $("#fileLorebook").addEventListener("change", function (e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const json = JSON.parse(reader.result);
          const lb = window.ST.importLorebook(json);
          if (!lb.entries.length) { toast("warn", "导入失败", "未识别到世界书条目：需要 keys/key + content 字段的 SillyTavern JSON"); return; }
          // 用源文件名命名
          const fname = (f.name || "").replace(/\.json$/i, "").trim();
          if (fname) lb.name = fname;
          window.ST.saveLorebook(lb);
          syncLorebookRuntime(); // 立即生效 + 缓存失效
          toast("success", "世界书已导入", "「" + lb.name + "」 " + lb.entries.length + " 条");
          // 打开世界书列表, 查看新导入的书
          openModal("modalLorebook");
          renderLorebookList();
        } catch (err) {
          toast("error", "解析失败", "不是有效的 JSON 文件: " + (err && err.message ? err.message : err));
        }
        e.target.value = "";
      };
      reader.readAsText(f);
    });
    // ============ 预设模态框 (PresetModal + PromptOrderEditor, 草稿制) ============
    // 切换下拉 → 载入该预设草稿（未「存入并应用」不落库、不生效）
    $("#presetSelect").addEventListener("change", function () {
      A.renderPresetManager();
    });
    $("#btnPresetNew").addEventListener("click", function () {
      const p = window.ST.createDefaultPreset();
      p.name = "新预设 " + (window.ST.loadPresets().length + 1);
      window.ST.savePreset(p);
      editingPresetId = p.id;
      A.renderPresetManager();
      toast("success", "预设已创建", "「" + p.name + "」");
    });
    $("#btnPresetImport").addEventListener("click", function () {
      window.ST.importJsonFile().then(function (res) {
        if (!res) return;
        try {
          const list = window.ST.importPreset(res.json);
          if (!list.length) { toast("warn", "导入失败", "未识别到预设参数（需要 name + settings 字段）"); return; }
          const p = list[0];
          // 用源文件名命名（dfzrf366 行为），并重置为全新记录
          const fname = (res.fileName || "").replace(/\.json$/i, "").trim();
          if (fname) p.name = fname;
          p.id = window.ST.uid();
          p.createdAt = Date.now();
          p.updatedAt = Date.now();
          window.ST.savePreset(p);
          A.settings.ai = A.settings.ai || {};
          A.settings.ai.preset = p.name;
          try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(A.settings)); } catch (e) {}
          editingPresetId = p.id;
          A.renderPresetManager();
          renderPresetSelect(p.name);
          toast("success", "预设已导入", "「" + p.name + "」已导入并激活");
        } catch (err) {
          toast("error", "解析失败", "不是有效的预设 JSON: " + (err && err.message ? err.message : err));
        }
      });
    });
    $("#btnPresetExport").addEventListener("click", function () {
      const p = presetDraft;
      if (!p) { toast("warn", "无预设", "请先创建或导入"); return; }
      window.ST.exportToJson(window.ST.exportPreset(p), (p.name || "预设") + ".json");
      toast("info", "已导出", "「" + p.name + "」");
    });
    $("#btnPresetDelete").addEventListener("click", function () {
      const p = window.ST.getPreset(editingPresetId);
      if (!p) return;
      A.confirmDialog({
        title: "删除预设",
        body: "确定删除预设「" + p.name + "」吗？",
        okText: "删除",
        danger: true,
        icon: "trash"
      }).then(function (ok) {
        if (!ok) return;
        window.ST.deletePreset(p.id);
        if ((A.settings.ai || {}).preset === p.name) {
          A.settings.ai.preset = "";
          try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(A.settings)); } catch (err) {}
        }
        presetDraft = null;
        editingPresetId = null;
        renderPresetSelect();
        A.renderPresetManager();
        toast("info", "预设已删除", "「" + p.name + "」");
      });
    });
    // 提示词块列表：勾选启用/停用、↑↓ 调序、点击行展开/收起内容（草稿内操作）
    $("#promptOrder").addEventListener("click", function (e) {
      if (e.target.closest(".po-body")) return;  // 展开区点击不折叠
      const row = e.target.closest("[data-pid]");
      if (!row || !presetDraft) return;
      const pid = row.getAttribute("data-pid");
      const st = presetDraft.settings || {};
      const act = e.target.getAttribute && e.target.getAttribute("data-act");
      if (e.target.classList.contains("po-toggle")) {
        // 勾选=启用、取消=停用（保留位置）；不在列表（理论不出现）=追加
        const merged = (window.ST.getMergedPromptOrder(st) || []).slice();
        const idx = merged.findIndex(function (o) { return o.identifier === pid; });
        if (e.target.checked && idx === -1) {
          const p = (Array.isArray(st.prompts) ? st.prompts : []).find(function (x) { return x && x.identifier === pid; });
          merged.push({
            identifier: pid,
            name: (p && (p.name || p.identifier)) || pid,
            role: (p && p.role) || "system",
            enabled: true
          });
        } else if (idx !== -1) {
          merged[idx].enabled = e.target.checked;
        }
        writeBackMerged(st, merged);
        renderPromptBlocks();
        return;
      }
      if (act === "up" || act === "down") {
        const merged2 = (window.ST.getMergedPromptOrder(st) || []).slice();
        const i2 = merged2.findIndex(function (o) { return o.identifier === pid; });
        if (i2 === -1) return;
        const to = act === "up" ? i2 - 1 : i2 + 1;
        if (to < 0 || to >= merged2.length) return;
        merged2.splice(to, 0, merged2.splice(i2, 1)[0]);
        writeBackMerged(st, merged2);
        renderPromptBlocks();
        return;
      }
      // 点击行/名称 → 展开/收起行内内容编辑区
      togglePrompt(pid);
    });
    // 行内内容编辑实时写回草稿
    $("#promptOrder").addEventListener("input", function (e) {
      if (!e.target.classList.contains("po-editor")) return;
      const row = e.target.closest("[data-pid]");
      if (!row || !presetDraft) return;
      const prompts = presetDraft.settings.prompts;
      if (!Array.isArray(prompts)) return;
      const p = prompts.find(function (x) { return x && x.identifier === row.getAttribute("data-pid"); });
      if (p) p.content = e.target.value;
      const lenEl = row.querySelector(".po-len");
      if (lenEl) lenEl.textContent = e.target.value.length + "字";
    });
    // 存入并应用：草稿 → 落库 + 激活
    $("#btnPresetSave").addEventListener("click", function () {
      if (!presetDraft) { toast("warn", "无预设", "请先创建或导入"); return; }
      flushPromptContent();  // 先落盘提示词库编辑区内容
      const nameInput = $("#presetName");
      if (nameInput && nameInput.value.trim()) presetDraft.name = nameInput.value.trim();
      const S = presetDraft.settings || (presetDraft.settings = {});
      S.temp_openai = Number($("#presetTemp").value);
      S.top_p_openai = Number($("#presetTopP").value);
      S.top_k_openai = Number($("#presetTopK").value);
      S.top_a_openai = Number($("#presetTopA").value);
      S.min_p_openai = Number($("#presetMinP").value);
      S.repetition_penalty_openai = Number($("#presetRepPen").value);
      S.freq_pen_openai = Number($("#presetFreqPen").value);
      S.pres_pen_openai = Number($("#presetPresPen").value);
      S.openai_max_context = Number($("#presetCtx").value);
      S.openai_max_tokens = Number($("#presetTokens").value);
      S.stream_openai = $("#presetStream").checked;
      // 合并视图写回主分组 + 同步 prompts.enabled / settings.main
      writeBackMerged(S, window.ST.getMergedPromptOrder(S) || []);
      presetDraft.name = presetDraft.name || "预设";
      window.ST.savePreset(presetDraft);
      A.settings.ai = A.settings.ai || {};
      A.settings.ai.preset = presetDraft.name;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(A.settings)); } catch (err) {}
      renderPresetSelect(presetDraft.name);
      A.renderPresetManager();
      toast("success", "已存入并应用", "「" + presetDraft.name + "」将在下次请求生效");
    });

    // ============ 世界书列表模态框 (LorebookModal) ============
    $("#btnLbNew").addEventListener("click", function () {
      const name = window.prompt("新世界书之名：", "新世界书");
      if (!name) return;
      const lb = window.ST.createDefaultLorebook(name);
      window.ST.saveLorebook(lb);
      A.renderLorebookList();
      // 直接进入编辑器
      editingBookId = lb.id;
      A.renderLorebookEditor();
      A.openModal("modalLorebookEditor");
      A.closeModal("modalLorebook");
      toast("success", "世界书已创建", "「" + name + "」");
    });
    $("#btnLbImport").addEventListener("click", function () { $("#fileLorebook").click(); });

    // ============ 世界书编辑器模态框 (LorebookEditorModal + EntryForm) ============
    // 书名/描述自动保存 (一次性绑定, 避免重复监听)
    $("#lbEditorName").addEventListener("input", function () {
      const book = window.ST.getLorebook(editingBookId);
      if (!book) return;
      book.name = this.value.trim() || book.name;
      window.ST.saveLorebook(book);
    });
    $("#lbEditorDesc").addEventListener("input", function () {
      const book = window.ST.getLorebook(editingBookId);
      if (!book) return;
      book.description = this.value;
      window.ST.saveLorebook(book);
    });
    $("#btnLbAddEntry").addEventListener("click", function () {
      const book = window.ST.getLorebook(editingBookId);
      if (!book) { toast("warn", "无世界书", "请先创建或导入一本"); return; }
      book.entries = book.entries || [];
      const entry = window.ST.createDefaultEntry();
      entry.comment = "新条目 " + (book.entries.length + 1);
      entry.keys = ["关键词"];
      book.entries.push(entry);
      window.ST.saveLorebook(book);
      A.renderLorebookEditor();
      syncLorebookRuntime();
      toast("info", "条目已添加", "「" + book.name + "」 · 在表单中编辑关键词与内容");
    });
    $("#btnLbExport").addEventListener("click", function () {
      const book = window.ST.getLorebook(editingBookId);
      if (!book) { toast("warn", "无世界书", "请先创建或导入"); return; }
      window.ST.exportToJson(window.ST.exportLorebook(book), book.name + ".json");
      toast("info", "已导出", "「" + book.name + "」");
    });
    $("#btnLbDelete").addEventListener("click", function () {
      const book = window.ST.getLorebook(editingBookId);
      if (!book) return;
      A.confirmDialog({
        title: "删除世界书",
        body: "确定删除世界书「" + book.name + "」吗？共 " + (book.entries || []).length + " 条。此操作不可撤销。",
        okText: "删除",
        danger: true,
        icon: "trash"
      }).then(function (ok) {
        if (!ok) return;
        window.ST.deleteLorebook(book.id);
        A.closeModal("modalLorebookEditor");
        A.renderLorebookList();
        A.openModal("modalLorebook");
        syncLorebookRuntime();
        toast("info", "已删除", "「" + book.name + "」");
      });
    });

    // 重置存档
    $("#btnResetSave").addEventListener("click", function () {
      A.confirmDialog({
        title: "重置全部存档",
        body: "将清除所有存档槽与设置，并返回标题画面。",
        okText: "重置并返回标题",
        danger: true,
        icon: "trash"
      }).then(function (ok) {
        if (!ok) return;
        try {
          A.listSaves().forEach(function (s) { A.deleteSave(s.id); });
          localStorage.removeItem(SETTINGS_KEY);
        } catch (e) {}
        location.reload();
      });
    });

    // 覆盖层关闭
    $$("[data-close-overlay]").forEach(function (b) {
      b.addEventListener("click", function () {
        document.body.classList.remove("left-open", "right-open");
      });
    });

    // 键盘
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (openModals.length) A.closeTopModal();
        else document.body.classList.remove("left-open", "right-open");
      }
      if (e.key === "Enter" && openModals.length === 0 && !e.shiftKey) {
        const t = document.activeElement;
        if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
        $("#dockInput").focus();
      }
    });

    // 窗口尺寸: 移动端覆盖层同步
    window.addEventListener("resize", function () {
      if (window.innerWidth > 1100) document.body.classList.remove("left-open", "right-open");
    });
  }

  /* ---------- 覆盖层 (移动端左栏) ---------- */
  function openOverlay(side, panel) {
    const ov = $("#leftOverlay");
    const box = $("#leftOverlayPanel");
    const src = $("#leftCol");
    box.innerHTML = "";
    const clone = src.cloneNode(true);
    clone.id = "";
    box.appendChild(clone);
    window.ICON_HYDRATE(box);
    // 左栏背包按钮
    const bi = box.querySelector("#btnOpenInventory");
    if (bi) bi.addEventListener("click", openInventoryModal);
    document.body.classList.remove("left-open", "right-open");
    document.body.classList.add("left-open");
  }

  /* 物品 → 装备栏槽位解析:
     ① 精确匹配 (武器1~4/头盔/护甲/手套/靴子/项链/戒指1/戒指2/特殊装备)
     ② 类型名匹配 (武器/防具/其他 → 对应组 4 槽), 优先空槽, 全满时替换组内第一个
     ③ 前缀匹配 (戒指→戒指1/戒指2) */
  function gearSlotFor(it) {
    if (!it) return null;
    const slots = GD.GEAR_SLOTS || [];
    const slot = it.slot || it.槽位 || it.装备部位 || it.group;
    if (!slot) return null;
    if (slots.some(function (s) { return s.key === slot; })) return slot;
    let cands = null;
    if (slot === "武器" || slot === "防具" || slot === "其他") cands = slots.filter(function (s) { return s.group === slot; });
    if (!cands) cands = slots.filter(function (s) { return s.key.indexOf(slot) === 0; });
    if (!cands.length) return null;
    const empty = cands.filter(function (s) { return !state.装备[s.key]; })[0];
    return (empty || cands[0]).key;
  }

  /* ---------- 物品详情模态 ---------- */
  function openItemModal(ref) {
    const dyn = dynInfo(ref);
    let it = itemInfo(ref);
    // LLM 新增物品兜底: 未在物品库/详情中定义时仍可查看与穿戴 (支持 槽位/装备部位/基础属性)
    if (!it) it = { name: ref, icon: "gem", quality: "common", type: "装备", 未知: true, slot: (dyn && (dyn.槽位 || dyn.装备部位)) || undefined };
    const qc = qualityColor(it.quality);
    const ql = qualityLabel(it.quality);
    const grp = gearGroupOf(it); // 装备类型: 武器/防具/其他
    // 顶部格式: 装备名 (标题) + 装备类型 · 装备品质 (副标题); 非装备保持原名/原副行
    $("#itemTitle").textContent = it.name;
    $("#itemSub").textContent = grp ? grp + " · " + ql : ql + " · " + (it.type || "");
    const body = $("#itemBody");
    const sockets = it.sockets ? Array.apply(null, { length: it.sockets }).map(function (_, i) {
      return '<span class="socket' + (i === 0 ? " filled" : "") + '">' + (i === 0 ? ICON("gem") : ICON("plus", 10)) + "</span>";
    }).join("") : "";
    const stack = it.stack ? '<span class="chip" style="font-size:9px">堆叠 ×' + it.stack + "</span>" : "";
    const price = it.value ? '<span>价值 <b>' + it.value + '</b> 铜板</span>' : "";
    body.innerHTML =
      '<div class="item-hero"><span class="ih-icon" style="--qc:' + qc + '">' + ICON(it.icon) + "</span>" +
      '<div class="ih-main"><div class="ih-name" style="color:' + qc + '">' + A.esc(it.name) + "</div>" +
      '<div class="ih-tags"><span class="chip" style="border-color:' + qc + '66;color:' + qc + '">' + ql + "</span>" +
      (grp ? '<span class="chip" style="border-color:' + qc + '66;color:' + qc + '">' + grp + "</span>" : "") +
      (it.等级 ? '<span class="chip" style="border-color:' + qc + '66;color:' + qc + '">Lv.' + it.等级 + "</span>" : "") +
      stack + "</div>" +
      (price ? '<div class="ih-price">' + price + "</div>" : "") + "</div></div>" +
      (it.attrs && Object.keys(it.attrs).length ? '<div class="item-stats">' + Object.keys(it.attrs).map(function (k) {
        return '<div class="item-stat"><span class="k">' + k + '</span><span class="v plus">+' + it.attrs[k] + "</span></div>";
      }).join("") + "</div>" : "") +
      (it.durability != null ? (function () {
        const durBroken = it.durability <= 0;
        const durPct = Math.max(0, Math.min(100, Math.round(it.durability / (it.maxDura || 1) * 100)));
        return '<div class="item-stats"><div class="item-stat"><span class="k">耐久</span><span class="v">' + it.durability + " / " + it.maxDura + (durBroken ? ' · <span style="color:var(--danger,#d6455f)">已破损</span>' : "") + '</span></div>' +
          '<div class="item-dura-bar"><i style="width:' + durPct + "%;" + (durBroken || durPct <= 25 ? "background:var(--danger,#d6455f);" : "") + '"></i></div></div>';
      })() : "") +
      (it.需求 || it.穿戴要求 ? '<div class="item-req"><div class="ir-title">穿戴要求</div><div class="ir-list">' + (function () {
        const req = it.需求 || it.穿戴要求;
        if (typeof req === "string") return '<span class="chip">' + A.esc(req) + "</span>";
        return Object.keys(req).map(function (k) {
          return '<span class="chip">' + A.esc(k) + " " + (typeof req[k] === "number" ? "≥ " + req[k] : A.esc(req[k])) + "</span>";
        }).join("");
      })() + "</div></div>" : "") +
      // 精炼: 精炼等级(数字) 或 精炼{当前,上限}; 精炼材料类型 附注
      (it.精炼等级 != null || it.精炼 ? (function () {
        const lv = it.精炼等级 != null ? it.精炼等级 : (it.精炼 && (it.精炼.当前 != null ? it.精炼.当前 : it.精炼.等级));
        const mx = it.精炼 && (it.精炼.上限 != null ? it.精炼.上限 : it.精炼.max);
        const mat = it.精炼材料类型 ? " · " + it.精炼材料类型 : "";
        return '<div class="item-meta-line"><span class="k">精炼</span><span class="v">Lv.' + lv + (mx != null ? " / " + mx : "") + mat + "</span></div>";
      })() : "") +
      // 镶嵌: 镶嵌{当前,上限} 或 宝石镶嵌(数组/字符串/对象)
      (it.镶嵌 || it.宝石镶嵌 ? (function () {
        const sok = it.镶嵌 || it.宝石镶嵌;
        let txt;
        if (typeof sok === "object" && !Array.isArray(sok)) {
          if (sok.当前 != null || sok.上限 != null || sok.max != null) txt = (sok.当前 != null ? sok.当前 : 0) + " / " + (sok.上限 != null ? sok.上限 : sok.max) + " 颗";
          else txt = Object.keys(sok).map(function (x) { return x + " " + sok[x]; }).join("、");
        } else txt = Array.isArray(sok) ? sok.join("、") : String(sok);
        return '<div class="item-meta-line"><span class="k">镶嵌</span><span class="v">' + A.esc(txt) + "</span></div>";
      })() : "") +
      // 绑定状态: 任何值都显示 (已绑定/未绑定/自定义)
      (it.绑定状态 != null || it.bound != null ? (function () {
        const b = it.绑定状态;
        const isBound = it.bound === true || b === "已绑定" || b === "是" || b === true;
        const label = (b != null && b !== "是" && b !== "否") ? b : (isBound ? "已绑定" : "未绑定");
        return '<div class="item-meta-line"><span class="k">绑定</span><span class="v' + (isBound ? ' style="color:var(--danger,#d6455f)"' : "") + '">' + A.esc(label) + "</span></div>";
      })() : "") +
      (sockets ? '<div class="socket-row">' + sockets + "</div>" : "") +
      (it.特性 && it.特性.length ? '<div class="item-traits">' + it.特性.map(function (t, i) {
        return '<div class="trait"><span class="t-name" style="color:' + qc + '">特性' + (i + 1) + " · " + A.esc(t.name) + '</span><span class="t-desc">' + A.esc(t.desc) + "</span></div>";
      }).join("") + "</div>" : "") +
      (it.技能 ? '<div class="item-trait skill"><span class="t-name" style="color:' + qc + '">技能 · ' + A.esc(it.技能.name) + "（" + A.esc(it.技能.type) + '）</span><span class="t-desc">' + A.esc(it.技能.desc) + "</span></div>" : "") +
      (it.desc ? '<div class="item-desc">' + A.esc(it.desc) + "</div>" : "") +
      dynStatRows(dyn);
    A.openModal("modalItem");

    // 操作按钮
    const acts = $("#itemActions");
    let html = "";
    const inBag = (state.背包 || []).some(function (b) { return b.ref === ref; });
    const slotKey = gearSlotFor(it);
    // 已穿戴判定: 物品实际所在的槽位 (多武器/多戒指槽, 不能只按 gearSlotFor 判空槽)
    let eqSlot = null;
    Object.keys(state.装备 || {}).forEach(function (k) { if (state.装备[k] === ref) eqSlot = k; });
    const equipped = !!eqSlot;

    if (slotKey && inBag && !equipped) {
      const slotLabel = (GD.GEAR_SLOTS || []).filter(function (s) { return s.key === slotKey; })[0];
      html += '<button class="btn btn-primary" id="itemEquip">' + ICON("shield") + "装备 · " + (slotLabel ? slotLabel.label : slotKey) + "</button>";
    }
    if (equipped) {
      const eqLabel = (GD.GEAR_SLOTS || []).filter(function (s) { return s.key === eqSlot; })[0];
      html += '<button class="btn btn-ghost" id="itemUnequip">' + ICON("arrow-down") + "卸下 · " + (eqLabel ? eqLabel.label : eqSlot) + "</button>";
    }
    if (it.type === "消耗品") {
      html += '<button class="btn btn-primary" id="itemUse">' + ICON("check") + "使用</button>";
    }
    html += '<button class="btn btn-ghost" data-close-modal="modalItem">关闭</button>';
    acts.innerHTML = html;
    window.ICON_HYDRATE(acts);

    const eq = $("#itemEquip");
    if (eq) eq.addEventListener("click", function () { equipItem(ref, slotKey); });
    const ue = $("#itemUnequip");
    if (ue) ue.addEventListener("click", function () { unequipItem(eqSlot); });
    const use = $("#itemUse");
    if (use) use.addEventListener("click", function () { useItem(ref); });
  }

  function equipItem(ref, slotKey) {
    const bag = state.背包;
    const idx = bag.findIndex(function (b) { return b.ref === ref; });
    if (idx < 0) return;
    const it = itemInfo(ref) || { name: ref };
    // 已有装备放回背包
    const old = state.装备[slotKey];
    if (old) bag.push({ id: A.uid(), ref: old, qty: 1 });
    state.装备[slotKey] = ref;
    bag[idx].qty--;
    if (bag[idx].qty <= 0) bag.splice(idx, 1);
    const slotLabel = (GD.GEAR_SLOTS || []).filter(function (s) { return s.key === slotKey; })[0];
    A.closeModal("modalItem");
    A.renderAll();
    toast("success", "已装备", it.name + " → " + (slotLabel ? slotLabel.label : slotKey));
  }

  function unequipItem(slotKey) {
    const ref = state.装备[slotKey];
    if (!ref) return;
    if (state.背包.length >= 20) { toast("warn", "背包已满", "无法卸下物品"); return; }
    state.装备[slotKey] = null;
    state.背包.push({ id: A.uid(), ref: ref, qty: 1 });
    A.closeModal("modalItem");
    A.renderAll();
    toast("info", "已卸下", ref + " 已放回背包");
  }

  function useItem(ref) {
    const it = itemInfo(ref) || null;
    const bag = state.背包;
    const idx = bag.findIndex(function (b) { return b.ref === ref; });
    if (idx < 0) return;
    if (ref === "粗布绷带") {
      state.生命.当前 = Math.min(state.生命.上限, state.生命.当前 + 20);
      consumeBag(bag, idx);
      toast("success", "使用绷带", "生命 +20");
    } else if (ref === "干粮") {
      state.气力.当前 = Math.min(state.气力.上限, state.气力.当前 + 15);
      consumeBag(bag, idx);
      toast("success", "食用干粮", "气力 +15");
    } else if (ref === "火折子") {
      toast("info", "火折子", "火光即希望，也是暴露。（原型版暂无实际效果）");
      consumeBag(bag, idx);
    } else {
      toast("info", (it && it.name) || ref, "当前无法使用");
      return;
    }
    A.closeModal("modalItem");
    A.renderAll();
  }
  function consumeBag(bag, idx) {
    bag[idx].qty--;
    if (bag[idx].qty <= 0) bag.splice(idx, 1);
  }

  /* ---------- NPC 详情模态 (静态 + 动态; 变量规范 §七) ---------- */
  const NPC_ATTR_KEYS = ["当前生命值", "生命值上限", "当前气力值", "气力值上限", "职业", "副职业", "力量", "敏捷", "智力", "攻击", "防御", "穿透", "幸运", "魅力"];
  function openNpcModal(id) {
    const isDyn = String(id).indexOf("dyn:") === 0;
    const dynName = isDyn ? String(id).slice(4) : null;
    const npc = isDyn ? null : (GD.NPCS.find(function (n) { return n.id === id; }) || null);
    if (!isDyn && !npc) return;
    const p = isDyn ? ((state.周围人物 || {})[dynName] || {}) : {};
    const name = isDyn ? dynName : npc.name;
    const role = isDyn ? (p.职业 || p.role || "未知身份") : npc.role;
    const lv = isDyn ? p.等级 : null;
    const rel = Math.max(-100, Math.min(100, p.好感度 != null ? p.好感度 : (npc ? npc.relation : 0)));
    const relCls = rel >= 20 ? "jade" : rel >= 0 ? "gold" : "crimson";
    A.currentNpc = id;
    $("#npcTitle").textContent = name;
    $("#npcSub").textContent = role + (isDyn ? " · 动态人物" : " · " + npc.location);

    let html = '<div class="npc-detail" style="display:flex; gap:14px; align-items:flex-start">' +
      '<span class="np-avatar" style="width:56px;height:56px">' + ICON(isDyn ? "user" : npc.icon) + "</span>" +
      '<div style="flex:1"><div style="font-size:15px;font-weight:800;letter-spacing:.1em;color:var(--paper)">' + A.esc(name) + "</div>" +
      '<div style="font-size:11px;color:var(--paper-faint);margin-top:2px;letter-spacing:.14em">' + A.esc(role) + (lv != null ? " · Lv." + lv : "") + "</div></div>" +
      '<span class="chip ' + relCls + '">好感 ' + rel + "</span></div>";

    if (isDyn) {
      // 属性 (规范 §七): 当前生命值/上限 · 当前气力值/上限 · 职业/副职业 · 力量/敏捷/智力/攻击/防御/穿透/幸运/魅力
      const src = Object.assign({}, p.属性 || {});
      NPC_ATTR_KEYS.forEach(function (k) { if (p[k] !== undefined && p[k] !== null) src[k] = p[k]; });
      const rows = [];
      NPC_ATTR_KEYS.forEach(function (k) {
        const v = src[k];
        if (v === undefined || v === null || v === "") return;
        rows.push('<div class="attr-line"><span class="k">' + A.esc(k) + '</span><span class="v">' + A.esc(String(v)) + "</span></div>");
      });
      if (p.外貌) html += '<div style="margin-top:14px" class="section-title"><span class="orn">' + ICON("user") + '</span>外貌</div><div style="margin-top:6px;font-size:12px;line-height:1.9;color:var(--paper-dim)">' + A.esc(p.外貌) + "</div>";
      if (p.装备) html += '<div style="margin-top:14px" class="section-title"><span class="orn">' + ICON("shield") + '</span>装备</div><div style="margin-top:6px;font-size:12px;line-height:1.9;color:var(--paper-dim)">' + A.esc(p.装备) + "</div>";
      html += '<div style="margin-top:14px" class="section-title"><span class="orn">' + ICON("radio") + '</span>属性</div>' +
        '<div class="npc-attr-grid">' + (rows.length ? rows.join("") : '<div style="font-size:11.5px;color:var(--paper-faint);padding:4px 0">（属性信息未知）</div>') + "</div>";
      // 内心想法: 默认隐藏, 点击小眼睛查看 (规范 §七)
      const thought = p.内心想法;
      html += '<div class="npc-thought"><div class="nt-head"><span>内心想法</span>' +
        '<button type="button" class="eye-btn" data-eye="1" title="点击查看/隐藏内心想法">' + ICON("eye") + "</button>" +
        (thought ? '<span class="nt-hint">点击小眼睛查看</span>' : "") + "</div>" +
        '<div class="nt-body' + (thought ? " is-hidden" : "") + '">' + A.esc(thought || "（此人暂无内心想法，或你不愿窥探）") + "</div></div>";
    } else {
      html += '<div style="margin-top:14px;font-size:12px;line-height:1.9;color:var(--paper-dim)">' + A.esc(npc.desc) + "</div>" +
        '<div style="margin-top:14px" class="section-title"><span class="orn">' + ICON("radio") + '</span>对话</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px">' + npc.lines.map(function (l, i) {
          return '<button class="option-btn npc-line" data-line="' + i + '"><span class="ob-idx">' + (i + 1) + '</span><span style="flex:1">' + A.esc(l) + "</span><span class='ob-tag'>交谈</span></button>";
        }).join("") + "</div>";
    }
    html += '<div class="item-actions"><button class="btn btn-ghost" data-close-modal="modalNpc">关闭</button></div>';
    $("#npcBody").innerHTML = html;
    window.ICON_HYDRATE($("#npcBody"));
    A.openModal("modalNpc");

    // 内心想法小眼睛切换
    $$(".eye-btn", $("#npcBody")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        const b = btn.parentNode.querySelector(".nt-body");
        if (b) b.classList.toggle("is-hidden");
      });
    });

    // 对话行 → 触发剧情
    if (!isDyn) {
      $$(".npc-line", $("#npcBody")).forEach(function (btn) {
        btn.addEventListener("click", function () {
          const idx = Number(btn.getAttribute("data-line"));
          const line = npc.lines[idx];
          A.closeModal("modalNpc");
          chooseOption({ text: "对" + npc.name + "说：" + line, tag: "交谈", risk: false });
        });
      });
    }
  }

  /* ---------- 背包全览模态 ---------- */
  function openInventoryModal() {
    const bag = state.背包 || [];
    $("#itemTitle").textContent = "背包";
    $("#itemSub").textContent = bag.length + " / 20 格 · " + A.fmtMoney(state.角色.货币);
    $("#itemBody").innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(52px,1fr));gap:8px">' +
      bag.map(function (b) {
        const it = itemInfo(b.ref) || { name: b.ref, icon: "gem", quality: "common" };
        return '<button class="inv-slot q-border" data-item="' + A.esc(b.ref) + '" data-bag="1" style="--qc:' + A.qualityColor(it.quality) + ';height:52px" title="' + A.esc(A.gearTitle(it)) + '">' +
          ICON(it.icon) + (b.qty > 1 ? '<span class="count">' + b.qty + "</span>" : "") + "</button>";
      }).join("") + "</div>" +
      (bag.length ? "" : '<div class="empty-state">' + ICON("backpack") + "<div>背囊空空</div></div>");
    window.ICON_HYDRATE($("#itemBody"));
    $("#itemActions").innerHTML = '<button class="btn btn-ghost" data-close-modal="modalItem">关闭</button>';
    A.openModal("modalItem");
    // 委托点击
    $("#itemBody").onclick = function (e) {
      const b = e.target.closest("[data-item]");
      if (b) { A.closeModal("modalItem"); openItemModal(b.getAttribute("data-item")); }
    };
  }

  /* ============================================================
     初始化
     ============================================================ */
  // 挂载 Part 2 内部函数到共享接口
  A.applySettings = applySettings;
  function init() {
    // 水合静态图标
    window.ICON_HYDRATE(document);

    // 变量内核 (<set> 行式协议): 绑定状态访问器 / 弹幕 / 挂载失败弹窗
    if (window.VARS) {
      VARS.attach(function () { return state; });
      VARS.setDanmaku(danmaku);
      VARS.mount();
    }

    // 应用设置
    A.applySettings();

    // 旧版单槽存档迁移
    A.migrateLegacySave();

    // 旧版世界书 (单数组) → 多书结构迁移
    if (window.ST && window.ST.migrateLegacyLorebook) {
      try { window.ST.migrateLegacyLorebook(); } catch (e) {}
    }

    // 默认世界书就绪: 核心条目 + 用户书 → 运行时索引
    if (window.ST) {
      ensureDefaultLorebook();
      syncLorebookRuntime();
    }

    // 绑定事件
    bindEvents();

    // 渲染基础 (空状态)
    A.renderAll();
    A.renderSaveSlots();
    A.renderPowerRank();
    A.renderChronicle();

    // 标题画面: 由用户选择「开始游戏」或「继续游戏」
    // 继续游戏按钮: 有存档则可用
    updateTitleContinue();

    setTimeout(function () {
      scrollStory();
    }, 100);
  }

  /* 更新标题画面「继续游戏」按钮状态 */
  function updateTitleContinue() {
    const btn = $("#btnTitleContinue");
    const count = A.listSaves().length;
    const badge = $("#tsContinueCount");
    if (!btn) return;
    if (count > 0) {
      btn.classList.remove("is-disabled");
      btn.setAttribute("aria-disabled", "false");
      if (badge) badge.textContent = " · " + count + " 个存档";
    } else {
      btn.classList.add("is-disabled");
      btn.setAttribute("aria-disabled", "true");
      if (badge) badge.textContent = "";
    }
  }

  /* 从标题画面进入新游戏 → 角色创建向导 */
  function titleStartNew() {
    resetWizard();
    if (window.ST) syncLorebookRuntime();  // 确保默认世界书就绪
    $("#titleScreen").classList.remove("is-visible");
    A.openModal("modalCreate");
    renderWizard();
    toast("info", "欢迎来到黑城", "残响纪元 · 完成神经链接以开始");
  }

  /* 从标题画面进入「继续游戏」→ 会话记录列表 */
  function titleContinue() {
    if (A.listSaves().length === 0) {
      toast("warn", "暂无会话记录", "请先开始游戏并保存");
      return;
    }
    A.renderSaveSlots();
    A.openModal("modalLoad");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
