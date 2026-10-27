/* ============================================================
   黑城残响 · SillyTavern 风格引擎 (Vanilla 版)
   世界书多书管理 / 关键词匹配 / 预设完整参数 / 系统提示组装
   / OpenAI 兼容 API(SSE 流式)
   参照 SillyTavern 生态规范: types / importer / lorebook-engine
   ============================================================ */
(function () {
  "use strict";

  var ST = {};

  /* ---------- 基础工具 ---------- */
  ST.uid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  };

  /* 世界书条目 position 编号 → 名称 (SillyTavern 兼容) */
  ST.POSITION_BY_ID = {
    0: "before_char", 1: "after_char", 2: "before_example", 3: "after_example",
    4: "at_depth", 5: "example_msg_top", 6: "example_msg_bottom", 7: "outlet"
  };
  ST.POSITION_ID_BY_NAME = {
    before_char: 0, after_char: 1, before_example: 2, after_example: 3,
    at_depth: 4, example_msg_top: 5, example_msg_bottom: 6, outlet: 7
  };
  /* selectiveLogic 编号 → 名称 */
  ST.LOGIC_BY_ID = { 0: "and_any", 1: "not_all", 2: "not_any", 3: "and_all" };
  ST.LOGIC_ID_BY_NAME = { and_any: 0, not_all: 1, not_any: 2, and_all: 3 };

  /* 常见 SillyTavern prompt_order 标识 (PromptOrderEditor 顺序基线) */
  ST.DEFAULT_PROMPT_ORDER = [
    { identifier: "main", name: "Main Prompt", role: "system" },
    { identifier: "worldInfoBefore", name: "World Info (Before)", role: "system" },
    { identifier: "charDescription", name: "Character Description", role: "system" },
    { identifier: "charPersonality", name: "Character Personality", role: "system" },
    { identifier: "scenario", name: "Scenario", role: "system" },
    { identifier: "personaDescription", name: "Persona Description", role: "system" },
    { identifier: "dialogueExamples", name: "Dialogue Examples", role: "system" },
    { identifier: "chatHistory", name: "Chat History", role: "system" },
    { identifier: "worldInfoAfter", name: "World Info (After)", role: "system" },
    { identifier: "groupNudge", name: "Group Nudge", role: "system" }
  ];

  /* 默认预设 (完整采样参数 + main + prompts + prompt_order) */
  ST.createDefaultPreset = function () {
    var main = "你是《黑城残响》的叙事引擎「黑城意识流」。你负责推动黑暗奇幻剧情、扮演所有 NPC、描写环境、结算后果。文风：克制、苍凉、带古意，像说书人。正文用第二人称「你」。";
    var now = Date.now();
    return {
      id: ST.uid(),
      name: "默认预设",
      description: "SillyTavern 兼容默认预设",
      createdAt: now,
      updatedAt: now,
      settings: {
        temp_openai: 0.8,
        top_p_openai: 0.9,
        top_k_openai: 0,
        top_a_openai: 0,
        min_p_openai: 0,
        repetition_penalty_openai: 1,
        freq_pen_openai: 0,
        pres_pen_openai: 0,
        openai_max_context: 4096,
        openai_max_tokens: 900,
        stream_openai: false,
        main: main,
        prompts: [
          { identifier: "main", name: "主提示词", role: "system", enabled: true, content: main }
        ],
        prompt_order: ST.DEFAULT_PROMPT_ORDER.map(function (p) {
          return Object.assign({}, p, { enabled: true });
        })
      }
    };
  };

  /* 归一化单个分组/列表的 order 条目 */
  function normalizeOrderItems(items, prompts) {
    return (items || [])
      .filter(function (i) { return i && (i.identifier || i.name); })
      .map(function (i) {
        var p = prompts.find(function (x) { return x && x.identifier === i.identifier; });
        return {
          identifier: i.identifier || "",
          name: (p && (p.name || p.identifier)) || i.name || i.identifier || "未命名",
          role: i.role || (p && p.role) || "system",
          enabled: i.enabled !== false
        };
      })
      .filter(function (i) { return i.identifier; });
  }

  /* 全部 prompt_order 分组（归一化）：[{character_id, order:[...]}]。
     兼容：新版分组 [{character_id, order:[{identifier,enabled}]}] /
           旧版扁平 / 更旧对象 {system_prompt,user_prompt}（合成单分组 character_id='default'） */
  ST.getPromptOrderGroups = function (settings) {
    var po = settings && settings.prompt_order;
    var prompts = (settings && Array.isArray(settings.prompts)) ? settings.prompts : [];
    if (!po) return null;
    if (Array.isArray(po) && po.length && po[0] && Array.isArray(po[0].order)) {
      var groups = po.map(function (g) {
        return {
          character_id: g.character_id,
          order: normalizeOrderItems(g.order, prompts)
        };
      }).filter(function (g) { return g.order && g.order.length; });
      return groups.length ? groups : null;
    }
    var items = null;
    if (Array.isArray(po)) {
      items = po;
    } else if (typeof po === "object") {
      items = [];
      ["system_prompt", "user_prompt"].forEach(function (block) {
        (po[block] || []).forEach(function (i) { items.push(i); });
      });
    }
    var order = normalizeOrderItems(items, prompts);
    return order.length ? [{ character_id: "default", order: order }] : null;
  };

  /* 归一化 prompt_order → 扁平数组 [{identifier,name,role,enabled}]
     characterId 可选：精确选指定分组；缺省选「主分组」（块数最多，通常为用户当前使用的分组） */
  ST.getPromptOrder = function (settings, characterId) {
    var groups = ST.getPromptOrderGroups(settings);
    if (!groups) return null;
    var group = null;
    if (characterId !== undefined && characterId !== null && characterId !== "") {
      group = groups.find(function (g) { return String(g.character_id) === String(characterId); });
    }
    if (!group) {
      group = groups.reduce(function (a, b) { return (b.order.length > a.order.length ? b : a); }, groups[0]);
    }
    return group.order;
  };

  /* 合并视图：主分组（块数最多）顺序在前，其余分组补充未出现过的块，最后补 prompts 中未入序的块。
     用于预设面板「不分组」单列表显示与编辑。 */
  ST.getMergedPromptOrder = function (settings) {
    var groups = ST.getPromptOrderGroups(settings);
    if (!groups) return null;
    var ordered = groups.slice().sort(function (a, b) { return b.order.length - a.order.length; });
    var seen = {};
    var merged = [];
    ordered.forEach(function (g) {
      g.order.forEach(function (o) {
        if (o && o.identifier && !seen[o.identifier]) {
          seen[o.identifier] = true;
          merged.push(o);
        }
      });
    });
    var prompts = (settings && Array.isArray(settings.prompts)) ? settings.prompts : [];
    prompts.forEach(function (p) {
      if (p && p.identifier && !seen[p.identifier]) {
        seen[p.identifier] = true;
        merged.push({
          identifier: p.identifier,
          name: p.name || p.identifier,
          role: p.role || "system",
          enabled: p.enabled !== false
        });
      }
    });
    return merged.length ? merged : null;
  };

  /* 主提示词：显式 settings.main 优先，否则取 prompts 中 identifier='main' 的内容 */
  ST.getMainPrompt = function (settings) {
    if (!settings) return "";
    if (typeof settings.main === "string" && settings.main.trim()) return settings.main;
    var prompts = (settings.prompts && Array.isArray(settings.prompts)) ? settings.prompts : [];
    var main = prompts.find(function (p) { return p && p.identifier === "main" && p.content; });
    return (main && main.content) || "";
  };

  /* 按合并视图 prompt_order 有序取启用的提示词模块（排除 main），供系统提示组装。
     无 prompt_order 时回退到 prompts 数组原始顺序。 */
  ST.getPromptModules = function (settings) {
    var prompts = (settings && Array.isArray(settings.prompts)) ? settings.prompts : [];
    if (!prompts.length) return [];
    var byId = {};
    prompts.forEach(function (p) { if (p && p.identifier) byId[p.identifier] = p; });
    var merged = ST.getMergedPromptOrder(settings);
    var out = [];
    var seen = {};
    function push(pm) {
      if (!pm || pm.identifier === "main" || !pm.content) return;
      if (seen[pm.identifier]) return;
      seen[pm.identifier] = true;
      var label = pm.name || ST.PROMPT_LABEL[pm.identifier] || pm.identifier;
      out.push({ label: label, content: String(pm.content).trim() });
    }
    if (merged) {
      merged.forEach(function (o) {
        if (o && o.enabled !== false) push(byId[o.identifier]);
      });
    } else {
      prompts.forEach(function (p) {
        if (p && p.enabled !== false) push(p);
      });
    }
    return out;
  };

  /* 默认世界书 */
  ST.createDefaultLorebook = function (name) {
    var now = Date.now();
    return {
      id: ST.uid(),
      name: name || "新世界书",
      description: "",
      entries: [],
      createdAt: now,
      updatedAt: now
    };
  };

  /* 默认世界书条目 */
  ST.createDefaultEntry = function () {
    return {
      id: ST.uid(),
      keys: [],
      secondaryKeys: [],
      content: "",
      comment: "",
      order: 100,
      position: "after_char",
      selective: false,
      selectiveLogic: "and_any",
      constant: false,
      probability: 100,
      useProbability: false,
      disabled: false
    };
  };

  /* ---------- 世界书: 从 GD 自动生成核心条目 ---------- */
  ST.buildCoreLorebook = function () {
    var books = (window.ST_LOREBOOK_CORE || []).slice();
    var GD = window.GD || {};

    (GD.POWER_RANK || []).forEach(function (p) {
      books.push({
        keys: [p.name, p.title, p.leader, p.seat].filter(Boolean),
        comment: "势力 · " + p.name,
        content: "【势力】" + p.name + "(" + p.threat + "威胁 · 对主角" + p.stance + ")：" + p.desc
      });
    });

    (GD.MAP_NODES || []).forEach(function (n) {
      books.push({
        keys: [n.name, n.id].filter(Boolean),
        comment: "地点 · " + n.name,
        content: "【地点】" + n.name + "(危险度" + n.danger + (n.locked ? " · 封锁中:" + (n.need || "") : "") + ")：" + n.desc
      });
    });

    (GD.NPCS || []).forEach(function (n) {
      if (n.hidden) return;
      books.push({
        keys: [n.name, n.id, n.role].filter(Boolean),
        comment: "人物 · " + n.name,
        content: "【人物】" + n.name + "(" + n.role + " · 关系" + n.relLabel + ")：" + n.desc + (n.lines && n.lines.length ? " 口头禅：「" + n.lines[0] + "」" : "")
      });
    });

    return books;
  };

  /* 运行时世界书 = 核心条目 + 全部用户世界书条目 (保留 SillyTavern 语义字段) */
  ST.buildLorebook = function () {
    var books = ST.buildCoreLorebook();
    ST.loadLorebooks().forEach(function (lb) {
      (lb.entries || []).forEach(function (e) {
        if (e.disabled) return;
        books.push({
          id: e.id,
          keys: e.keys || [],
          secondaryKeys: e.secondaryKeys || [],
          content: e.content || "",
          comment: e.comment || lb.name,
          order: e.order !== undefined ? Number(e.order) : 100,
          position: e.position || "after_char",
          selective: !!e.selective,
          constant: !!e.constant,
          useProbability: !!e.useProbability,
          probability: e.probability !== undefined ? Number(e.probability) : 100
        });
      });
    });
    return books;
  };

  /* ---------- 世界书匹配引擎 (SillyTavern 语义) ----------
     ① constant 恒定条目 → 无条件注入 (按 order 升序)
     ② 关键词命中 (keys 任一命中; selective 条目还需副键全部命中)
     ③ 去重 + 按 order 排序, 返回带 matchedKey 的条目          */
  ST.matchLorebook = function (text, books, max) {
    max = max || 8;
    var hits = [];
    var seen = {};
    var keyedCount = 0;
    function add(b, matchedKey, isConst) {
      var k = (b.id || "") + "|" + (b.comment || "") + "|" + (b.content || "");
      if (seen[k]) return;
      if (!isConst && keyedCount >= max) return;   // max 只约束关键词命中, 恒定条目全量注入
      seen[k] = true;
      if (!isConst) keyedCount++;
      hits.push(Object.assign({}, b, { matchedKey: matchedKey || "" }));
    }
    if (!text) {                                    // 空文本也注入恒定条目
      books.filter(function (b) { return b.constant; })
        .sort(function (a, b2) { return (a.order || 100) - (b2.order || 100); })
        .forEach(function (b) { add(b, "", true); });
      return hits;
    }
    // ① 恒定注入条目 (不受 max 上限约束: 规范/世界观恒定条目必须全量注入)
    books.filter(function (b) { return b.constant; })
      .sort(function (a, b2) { return (a.order || 100) - (b2.order || 100); })
      .forEach(function (b) { add(b, "", true); });
    // ② 关键词命中 (独立限额 max 条)
    for (var i = 0; i < books.length; i++) {
      var b = books[i];
      if (b.constant) continue;
      if (keyedCount >= max) break;
      var keys = b.keys || [];
      var sec = b.secondaryKeys || [];
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (!key || text.indexOf(key) === -1) continue;
        // selective: 副键全部命中才注入
        if (b.selective && sec.length && !sec.every(function (s) { return !s || text.indexOf(s) !== -1; })) continue;
        add(b, key, false);
        break;
      }
    }
    // ③ 优先级排序 (order 小 → 先注入)
    hits.sort(function (a, b2) { return (a.order || 100) - (b2.order || 100); });
    return hits;
  };

  /* ---------- 记忆分层: 对话历史分层压缩 ----------
     turns:  [{role:"user"|"assistant", content, sum?}]  (sum 为该回复的 <sum>)
     cfg:    { enabled, layers, largeStart }  layers=最新完整层数, largeStart=大总结起点层数
     memory: 按 assistant 序数对齐的 [{small, large}]
     规则: 最新 layers 层全文；较早 assistant 消息换「小总结」；
           largeStart 层之前换「大总结」；user 消息恒全文。
           无总结时退回截取正文。返回 [{role, content}]。 */
  ST.segmentHistory = function (turns, cfg, memory) {
    turns = (turns || []).map(function (t) {
      return { role: t.role, content: String(t.content || ""), sum: t.sum || "" };
    });
    cfg = cfg || {};
    if (cfg.enabled === false) {
      return turns.map(function (t) { return { role: t.role, content: t.content }; });
    }
    var layers = Math.max(1, Number(cfg.layers) || 6);
    var largeStart = Math.max(1, Number(cfg.largeStart) || 14);
    memory = Array.isArray(memory) ? memory : [];
    function cut(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n) + "…" : s; }
    /* 每条消息的层号: 一问一答为一层 (首个 user 为第 0 层, 此后每个新 user 层+1) */
    var layerOf = [], layer = 0;
    turns.forEach(function (t, i) {
      if (i > 0 && t.role === "user") layer++;
      layerOf.push(layer);
    });
    var totalLayers = layer + 1;
    var chatCut = Math.max(0, totalLayers - layers);   // 层号 >= chatCut → 全文
    var largeCut = Math.max(0, totalLayers - largeStart); // 层号 < largeCut → 大总结
    var ai = -1;
    return turns.map(function (t, i) {
      if (t.role !== "assistant") return { role: t.role, content: t.content };
      ai++;
      var lv = layerOf[i];
      if (lv >= chatCut) return { role: "assistant", content: t.content };
      var meta = memory[ai] || {};
      var isLarge = lv < largeCut;
      var s = isLarge ? (meta.large || meta.small || t.sum) : (meta.small || meta.large || t.sum);
      if (!s) s = cut(t.content, isLarge ? 90 : 60);
      return { role: "assistant", content: "〔" + (isLarge ? "大总结" : "小总结") + "〕" + s };
    });
  };

  /* ---------- 状态序列化 (中文键 → 紧凑文本) ---------- */
  ST.buildSystemPrompt = function (state, loreHits, chronicle, mainText, presetSettings) {
    var parts = [];
    parts.push(mainText && mainText.trim()
      ? mainText.trim()
      : "你是《黑城残响》的叙事引擎「黑城意识流」。你负责推动黑暗奇幻剧情、扮演所有 NPC、描写环境、结算后果。" +
        "文风：克制、苍凉、带古意，像说书人。正文用第二人称「你」。"
    );
    // 预设附加模块 (非 main 且启用的 prompts, 按 prompt_order 有序, 如越狱/作者注记/场景等)
    ST.getPromptModules(presetSettings).forEach(function (pm) {
      parts.push("【" + pm.label + "】" + pm.content);
    });
    parts.push("【世界观】黑城：各朝代残响构成的黑夜大陆，残响纪元。火器被禁，机关与奇术是力量。人心比怪物更危险。");

    // 变量操作协议 (<set> 行式): 白名单见世界书【变量规范】, 命令由前端逐行校验执行
    if (window.VAR_MODEL) {
      parts.push(
        "【变量操作 <set>】本回合若角色状态变化（数值/属性/货币/背包/装备/任务/技能/光环/天赋/位阶/时间/地点/天气/好感度），必须在回复末尾输出一个 <set> 块结算，无变化则省略；命令只写变化量。块内只写命令行——禁止写说明文字/思路/选项/任何标签；不同根的命令各自独立成行，不要把 时间/位置/天气 嵌进 装备详情/周围人物 等容器块。每行一条「路径 运算符 值」，运算符只认 = += -=；同一对象的多个字段用块式写法（容器路径只写一次，子字段缩进）。示例：" +
        "<set>生命值 -= 15；经验 += 50；货币.铜板 += 30；属性.力量 += 2；自由属性点 -= 2；背包[干粮].数量 += 1；装备.武器1 = 锈铁短刀；装备详情.锈铁短刀.耐久度.当前 -= 5；技能[荒野直觉].等级 = 1；任务[废墟里的呼救].进度 += 1；周围人物.铁匠阿蛮.好感度 -= 5；当前时间 = 黑城纪年1年1月2日 19:00；玩家位置 = 废都长安；天气 = 小雨</set>" +
        "（实际输出时一行一条，不要用分号连写）。白名单根：货币/当前时间/天气/玩家位置(或 所在位置)/属性/角色/生命/气力/经验/背包/装备/装备详情/技能/光环/天赋/任务/周围人物。" +
        "关键规则：升级由引擎自动结算——只写 经验 += 数值，禁止手动改 等级；货币只认 货币.铜板/银两/金锭，禁止写进背包；装备槽位 = 武器1~武器4/头盔/护甲/手套/靴子/项链/戒指1/戒指2/特殊装备（或 武器/防具/其他 自动落空槽），卸下写 = 无；位阶只能晋升一阶；好感度自动钳制 ±100。完整字段与类型见世界书【变量规范】。" +
        "【当前变量快照】" + window.VAR_MODEL.snapshot(state)
      );
    }

    if (loreHits && loreHits.length) {
      parts.push("【世界书（命中注入，仅当剧情需要时自然融入，不要复述）】");
      loreHits.forEach(function (b, i) {
        var tag = b.constant ? "恒定设定" : (b.matchedKey ? "触发「" + b.matchedKey + "」" : "");
        parts.push("〔" + (i + 1) + "〕" + (tag ? "[" + tag + "] " : "") + b.content);
      });
    }

    if (chronicle && chronicle.length) {
      parts.push("【编年史(最近)】");
      chronicle.slice(-3).forEach(function (c) { parts.push("· " + c.time + " " + c.title + "：" + c.body); });
    }

    parts.push(
      "【输出协议】严格只输出以下标签，标签之外不要有任何文字；选项与总结必须用标签包裹，禁止以纯文本形式罗列选项或总结：" +
      "<maintext>正文(1~3段，推动剧情，结尾留钩子)</maintext>" +
      "<option tag=\"主线|探索|风险\" risk=\"true\">选项文本</option>(0~3个，风险选项加 risk=\"true\")" +
      "<sum>一句话概括本回合进展，写入编年史与小记忆</sum>" +
      "<events>长期记忆：仅当本回合发生影响后续剧情的大事（升级、缔约、死亡、秘密曝光、重要交易、关系转变）时输出一两句概括；无大事则省略</events>"
    );
    return parts.join("\n\n");
  };

  /* ---------- 输出解析: <maintext>/<option>/<sum> ---------- */
  function attrOf(tag, name) {
    var m = tag.match(new RegExp(name + '="([^"]*)"'));
    return m ? m[1] : null;
  }

  ST.parseReply = function (text) {
    var out = { maintext: "", options: [], sum: "", events: "", vars: null, setCommands: [] };
    if (!text) return out;

    // <set> 行式命令（每行一条「路径 运算符 值」）→ 由 js/vars.js 白名单执行
    var setRe = /<set\s*>([\s\S]*?)<\/set\s*>/gi;
    var sm2;
    while ((sm2 = setRe.exec(text)) !== null) {
      String(sm2[1] || "").split("\n").forEach(function (line) {
        if (line.trim()) out.setCommands.push(line.replace(/\s+$/, ""));
      });
    }

    // <vars>[命令数组]</vars> → 旧版 JSON 通道（兼容保留）
    var vs = text.match(/<vars\s*>([\s\S]*?)<\/vars\s*>/i);
    if (vs) {
      try {
        var varr = JSON.parse(vs[1].trim());
        out.vars = Array.isArray(varr) ? varr : [varr];
      } catch (e) { out.vars = null; }
    }

    // <events>长期记忆</events> → 大总结 (弱模型会在规划里提到标签名 → 取最后一个开标签到闭标签)
    function lastTagBlock(tag) {
      var close = text.lastIndexOf("</" + tag + ">");
      if (close < 0) return "";
      var open = text.lastIndexOf("<" + tag + ">", close);
      if (open < 0) return "";
      return text.slice(open + tag.length + 2, close).trim();
    }
    out.events = lastTagBlock("events");

    // 正文提取 (抗弱模型):
    // ① 多个 <maintext> 开标签 + 一个闭标签 → 取「最后一个开标签」之后的内容
    //    (弱模型会先在正文里写规划/复述标签名, 再开真正的正文块)
    // ② 常规: 首个开标签到首个闭标签
    // ③ 无开标签: 按 </maintext> 位置截取; 全无 → 整段
    var openIdx = [];
    var openRe = /<maintext\s*>/gi;
    var mm;
    while ((mm = openRe.exec(text)) !== null) openIdx.push(mm.index + mm[0].length);
    var closeIdx = text.lastIndexOf("</maintext");
    var bodyText = "";
    if (openIdx.length && closeIdx > openIdx[openIdx.length - 1]) {
      bodyText = text.slice(openIdx[openIdx.length - 1], closeIdx);   // 最后一个正文块
    } else if (openIdx.length === 1 && openIdx[0] < text.length) {
      bodyText = text.slice(openIdx[0]);                              // 未闭合: 开标签之后全取
    } else if (mt) {
      bodyText = mt[1];
    } else if (closeIdx >= 0) {
      bodyText = text.slice(0, closeIdx);
    } else {
      bodyText = text;
    }
    /* 思考标记/思考块剥离 (DeepSeek <|begin_of_thinking|> / <think> 等) */
    bodyText = bodyText
      .replace(/<\|begin_of_thinking\|>[\s\S]*?<\|end_of_thinking\|>/gi, "")
      .replace(/<\|[a-z_]+\|>/gi, "")
      .replace(/<(think|thinking)>[\s\S]*?<\/(think|thinking)>/gi, "")
      .replace(/<\|begin_of_thinking\|>/gi, "");

    var optRe = /<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi;
    var m;
    while ((m = optRe.exec(text)) !== null) {
      var attrs = m[1];
      var opt = { text: m[2].trim() };
      var tag = attrOf("<option " + attrs + ">", "tag");
      var risk = attrOf("<option " + attrs + ">", "risk");
      opt.tag = tag || (risk ? "风险" : "行动");
      opt.risk = risk === "true";
      if (opt.text) out.options.push(opt);
    }

    out.sum = lastTagBlock("sum");

    // 清理残余标签(防模型不守协议) — 基于正文区, 移除一切协议标签, 折叠多余空行
    out.maintext = bodyText
      .replace(/<option\b[^>]*>[\s\S]*?<\/option\s*>/gi, "")
      .replace(/<sum\s*>([\s\S]*?)<\/sum\s*>/gi, "")
      .replace(/<events\s*>([\s\S]*?)<\/events\s*>/gi, "")
      .replace(/<set\b[^>]*>[\s\S]*?<\/set\s*>/gi, "")
      .replace(/<vars\b[^>]*>[\s\S]*?<\/vars\s*>/gi, "")
      .replace(/<\/?maintext\s*>/gi, "")
      .replace(/<[a-z\/][^>]*>/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return out;
  };

  /* ---------- OpenAI 兼容 API (支持 SSE 流式) ---------- */
  /* 规范化接口地址: 去首尾空白/斜杠, 自动纠正误粘贴的完整端点 */
  function normalizeBaseUrl(url) {
    var u = (url || "").trim().replace(/\/+$/, "");
    u = u.replace(/\/chat\/completions$/i, "");
    return u;
  }

  /* 透明自动路由 (dfzrf366 同款方案):
     页面通过本地服务器(http://localhost)打开 → 请求改发同源 /api/proxy,
     由 Node 转发到任意 API, 绕过浏览器 CORS;
     file:// 或远程 https 打开 → 直连填写的 baseUrl。零配置, 无需开关。 */
  function apiEndpoint(cfg) {
    var base = normalizeBaseUrl(cfg && cfg.baseUrl);
    if (!base) return "";
    var proto = location.protocol;
    var host = location.hostname;
    var isLocalServer = (proto === "http:" || proto === "https:") &&
      (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
    if (isLocalServer) {
      return location.origin + "/api/proxy?target=" + encodeURIComponent(base) + "&path=/chat/completions";
    }
    return base + "/chat/completions";
  }

  function buildHeaders(cfg) {
    var h = { "Content-Type": "application/json" };
    if (cfg.apiKey) h["Authorization"] = "Bearer " + cfg.apiKey;
    return h;
  }

  function consumeSSE(res, onDelta) {
    return new Promise(function (resolve, reject) {
      var reader = res.body.getReader();
      var decoder = new TextDecoder("utf-8");
      var buf = "";
      var full = "";

      function pump() {
        reader.read().then(function (r) {
          if (r.done) { resolve(full); return; }
          buf += decoder.decode(r.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.indexOf("data:") !== 0) continue;
            var payload = line.slice(5).trim();
            if (payload === "[DONE]") { resolve(full); return; }
            try {
              var json = JSON.parse(payload);
              var delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
              if (delta) { full += delta; onDelta(delta); }
            } catch (e) { /* 忽略不完整 JSON */ }
          }
          pump();
        }).catch(function (e) { reject(e); });
      }
      pump();
    });
  }

  /* ---------- 测试连接 ---------- */
  ST.testConnection = function (cfg) {
    return ST.chatCompletion(cfg, [
      { role: "system", content: "只回复两个字符:OK" },
      { role: "user", content: "ping" }
    ], null, null).then(function (reply) {
      return { ok: true, reply: (reply || "").slice(0, 50) };
    });
  };

  /* ============================================================
     世界书 / 预设 · 持久化 (localStorage, 多本/完整结构)
     ============================================================ */
  var LB_KEY = "hce.lorebooks";   // [{ id, name, description, entries, createdAt, updatedAt }]
  var PRESET_KEY = "hce.presets"; // [{ id, name, description, settings, createdAt, updatedAt }]

  /* ---- 世界书 ---- */
  ST.loadLorebooks = function () {
    try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; } catch (e) { return []; }
  };
  ST.saveLorebook = function (lb) {
    if (!lb) return null;
    lb.updatedAt = Date.now();
    var all = ST.loadLorebooks();
    var idx = all.findIndex(function (x) { return x.id === lb.id; });
    if (idx >= 0) all[idx] = lb; else all.push(lb);
    try { localStorage.setItem(LB_KEY, JSON.stringify(all)); } catch (e) {}
    return lb;
  };
  ST.deleteLorebook = function (id) {
    var all = ST.loadLorebooks().filter(function (x) { return x.id !== id; });
    try { localStorage.setItem(LB_KEY, JSON.stringify(all)); } catch (e) {}
    return all.length;
  };
  ST.getLorebook = function (id) {
    return ST.loadLorebooks().find(function (x) { return x.id === id; }) || null;
  };
  /* 兼容旧版: 单数组导入条目 → 迁移为一本书 */
  ST.migrateLegacyLorebook = function () {
    var legacyKey = "hce.lorebook.extra";
    var legacy;
    try { legacy = JSON.parse(localStorage.getItem(legacyKey)); } catch (e) { legacy = null; }
    if (Array.isArray(legacy) && legacy.length) {
      var lb = ST.createDefaultLorebook("导入的世界书");
      lb.entries = legacy.map(function (e) {
        return Object.assign(ST.createDefaultEntry(), {
          keys: e.keys || [],
          content: e.content || "",
          comment: e.comment || ""
        });
      });
      ST.saveLorebook(lb);
      try { localStorage.removeItem(legacyKey); } catch (e2) {}
      return lb.entries.length;
    }
    return 0;
  };

  /* ---- 预设 ---- */
  ST.loadPresets = function () {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY)) || []; } catch (e) { return []; }
  };
  ST.savePreset = function (p) {
    if (!p) return null;
    p.updatedAt = Date.now();
    var all = ST.loadPresets();
    var idx = all.findIndex(function (x) { return x.id === p.id; });
    if (idx >= 0) all[idx] = p; else all.push(p);
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(all)); } catch (e) {}
    return p;
  };
  ST.deletePreset = function (id) {
    var all = ST.loadPresets().filter(function (x) { return x.id !== id; });
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(all)); } catch (e) {}
    return all.length;
  };
  ST.getPreset = function (id) {
    return ST.loadPresets().find(function (x) { return x.id === id; }) || null;
  };
  /* 按名称取预设 (兼容旧版按 name 选择) */
  ST.getPresetByName = function (name) {
    if (!name) return null;
    return ST.loadPresets().find(function (x) { return x.name === name; }) || null;
  };
  /* 取预设参数 (标准请求名), 未命中返回空对象 */
  ST.getPresetParams = function (name) {
    var p = ST.getPresetByName(name);
    if (!p || !p.settings) return {};
    var s = p.settings;
    var params = {};
    if (s.temp_openai !== undefined) params.temperature = Number(s.temp_openai);
    if (s.top_p_openai !== undefined) params.top_p = Number(s.top_p_openai);
    // top_k: SillyTavern 用 0/-1 表示禁用; OpenAI 兼容 API 只接受 -1 或 [1,100]
    if (s.top_k_openai !== undefined) {
      var tk = Number(s.top_k_openai);
      if (tk >= 1 && tk <= 100) params.top_k = tk;
    }
    if (s.openai_max_tokens !== undefined) params.max_tokens = Number(s.openai_max_tokens);
    if (s.freq_pen_openai !== undefined) params.frequency_penalty = Number(s.freq_pen_openai);
    if (s.pres_pen_openai !== undefined) params.presence_penalty = Number(s.pres_pen_openai);
    if (s.repetition_penalty_openai !== undefined) params.rep_pen = Number(s.repetition_penalty_openai);
    if (s.stream_openai !== undefined) params.stream = !!s.stream_openai;
    return params;
  };

  /* ============================================================
     导入 / 导出 (SillyTavern JSON)
     ============================================================ */

  /* 世界书: 兼容 SillyTavern 导出格式 → 本地世界书对象
     ① { entries: { "0": {...}, "1": {...} } }  (对象映射)
     ② { entries: [ {...}, {...} ] }             (数组)
     ③ [ {...}, {...} ]                          (裸数组)      */
  ST.importLorebook = function (json) {
    if (!json || typeof json !== "object") throw new Error("无效的世界书 JSON");
    var src = json;
    if (json.entries && typeof json.entries === "object" && !Array.isArray(json)) src = json.entries;
    else if (Array.isArray(json)) src = json;

    var list = Array.isArray(src) ? src : Object.keys(src).map(function (k) { return src[k]; });
    var entries = (list || []).map(function (e) {
      if (!e || typeof e !== "object") return null;
      var keys = e.keys || e.key || [];
      if (typeof keys === "string") keys = keys.split(/[,;，、\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (!Array.isArray(keys)) keys = [];
      var sec = e.keysecondary || e.secondaryKeys || [];
      if (typeof sec === "string") sec = sec.split(/[,;，、\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
      var content = e.content || e.text || e.entry || "";
      if (!content) return null;
      return {
        id: ST.uid(),
        keys: keys.slice(0, 12),
        secondaryKeys: Array.isArray(sec) ? sec.slice(0, 12) : [],
        content: String(content).trim(),
        comment: e.comment || e.name || ("导入 · " + (keys[0] || "条目")),
        order: e.order !== undefined ? Number(e.order) : 100,
        position: ST.POSITION_BY_ID[e.position] || "after_char",
        selective: !!e.selective,
        selectiveLogic: ST.LOGIC_BY_ID[e.selectiveLogic] || "and_any",
        constant: !!e.constant,
        probability: e.useProbability && e.probability !== undefined ? Number(e.probability) : 100,
        useProbability: !!e.useProbability,
        disabled: !!(e.disable || e.excluded)
      };
    }).filter(Boolean);

    return {
      id: ST.uid(),
      name: (json && json.name) || "导入的世界书",
      description: (json && json.description) || "",
      entries: entries,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  };

  /* 本地世界书 → ST JSON */
  ST.exportLorebook = function (lb) {
    if (!lb) return null;
    var entries = {};
    (lb.entries || []).forEach(function (e, i) {
      entries[String(i)] = {
        uid: i,
        key: e.keys || [],
        keysecondary: e.secondaryKeys || [],
        comment: e.comment || "",
        content: e.content || "",
        constant: !!e.constant,
        selective: !!e.selective,
        selectiveLogic: ST.LOGIC_ID_BY_NAME[e.selectiveLogic] !== undefined ? ST.LOGIC_ID_BY_NAME[e.selectiveLogic] : 0,
        order: e.order !== undefined ? e.order : 100,
        position: ST.POSITION_ID_BY_NAME[e.position] !== undefined ? ST.POSITION_ID_BY_NAME[e.position] : 1,
        disable: !!e.disabled,
        useProbability: !!e.useProbability || (e.probability !== undefined && e.probability < 100),
        probability: e.probability !== undefined ? e.probability : 100,
        excluded: false
      };
    });
    return {
      name: lb.name,
      description: lb.description || "",
      entries: entries,
      settings: { recursive_scanning: true, case_sensitive: false, match_whole_words: false }
    };
  };

  /* 预设: 兼容 SillyTavern 导出 → 本地预设对象
     ① { name, settings:{...} }  (单个)
     ② [ { name, settings:{...} } ] (数组包)
     ③ 扁平 { temperature, top_p, ... }  */
  ST.importPreset = function (json) {
    var out = [];
    if (!json || typeof json !== "object") return out;
    var list = Array.isArray(json) ? json : [json];
    list.forEach(function (it) {
      if (!it || typeof it !== "object") return;
      var hasNested = it.settings && typeof it.settings === "object";
      var src = hasNested ? it.settings : it;

      function num(v, d) { if (v === undefined || v === null || v === "") return d; var n = Number(v); return isNaN(n) ? d : n; }
      function pick(keys, d) {
        for (var i = 0; i < keys.length; i++) {
          var v = src[keys[i]];
          if (v !== undefined && v !== null && v !== "") return v;
        }
        return d;
      }

      var settings = Object.assign({}, src);
      // 采样参数双写映射 → 标准名 (保留原始键, 导出可还原)
      settings.temp_openai = num(pick(["temp_openai", "temperature", "temp"]), 0.8);
      settings.top_p_openai = num(pick(["top_p_openai", "top_p"]), 0.9);
      settings.top_k_openai = num(pick(["top_k_openai", "top_k"]), 0);
      settings.top_a_openai = num(pick(["top_a_openai", "top_a"]), 0);
      settings.min_p_openai = num(pick(["min_p_openai", "min_p"]), 0);
      settings.repetition_penalty_openai = num(pick(["repetition_penalty_openai", "repetition_penalty", "rep_pen"]), 1);
      settings.freq_pen_openai = num(pick(["freq_pen_openai", "frequency_penalty", "freq_pen"]), 0);
      settings.pres_pen_openai = num(pick(["pres_pen_openai", "presence_penalty", "pres_pen"]), 0);
      settings.openai_max_context = num(pick(["openai_max_context", "max_context"]), 4096);
      settings.openai_max_tokens = num(pick(["openai_max_tokens", "max_tokens"]), 900);
      settings.stream_openai = !!pick(["stream_openai", "stream"], false);
      settings.prompts = Array.isArray(src.prompts) ? src.prompts : [];
      if (src.prompt_order !== undefined) settings.prompt_order = src.prompt_order;
      var mainPrompt = settings.prompts.find(function (p) { return p && p.identifier === "main" && p.content; });
      settings.main = pick(["main"], mainPrompt ? mainPrompt.content : "");

      var name = it.name || it.preset_name || it.title || ("预设 " + (out.length + 1));
      out.push({
        id: ST.uid(),
        name: String(name).trim() || ("预设 " + (out.length + 1)),
        description: it.description || "",
        settings: settings,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    });
    return out;
  };

  /* 本地预设 → ST JSON */
  ST.exportPreset = function (p) {
    if (!p) return null;
    return Object.assign({}, p.settings, { name: p.name, description: p.description || "" });
  };

  /* 弹文件选择框读 JSON (返回 { fileName, json }) */
  ST.importJsonFile = function () {
    return new Promise(function (resolve) {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.onchange = function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) { resolve(null); return; }
        file.text().then(function (text) {
          try { resolve({ fileName: file.name, json: JSON.parse(text) }); }
          catch (err) { resolve(null); }
        }).catch(function () { resolve(null); });
      };
      input.click();
    });
  };

  /* 触发下载 JSON */
  ST.exportToJson = function (data, filename) {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ---------- chatCompletion 支持预设参数覆盖 ---------- */
  ST.chatCompletion = function (cfg, messages, onDelta, signal, params) {
    params = params || {};
    var url = apiEndpoint(cfg);
    var useStream = !!(onDelta && params.stream !== false);
    var body = {
      model: cfg.model || "gpt-4o-mini",
      messages: messages,
      temperature: params.temperature !== undefined ? params.temperature : 0.9,
      max_tokens: params.max_tokens || 900,
      stream: useStream
    };
    if (params.top_p !== undefined) body.top_p = params.top_p;
    if (params.top_k !== undefined) body.top_k = params.top_k;
    if (params.rep_pen !== undefined) body.frequency_penalty = Math.min(2, Math.max(0, (params.rep_pen - 1) * 1.5));
    if (params.presence_penalty !== undefined) body.presence_penalty = params.presence_penalty;
    if (params.frequency_penalty !== undefined && params.rep_pen === undefined) body.frequency_penalty = params.frequency_penalty;
    return fetch(url, {
      method: "POST",
      headers: buildHeaders(cfg),
      body: JSON.stringify(body),
      signal: signal || undefined
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error("API " + res.status + ": " + t.slice(0, 200));
        });
      }
      if (!useStream) {
        return res.json().then(function (data) {
          var content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
          return content || "";
        });
      }
      return consumeSSE(res, onDelta);
    }).catch(function (e) {
      // fetch 网络层失败 (Failed to fetch / TypeError) → 给出可操作的排查提示
      if (e && e.name === "TypeError" && /fetch/i.test(e.message || "")) {
        throw new Error("无法连接到 " + url + "（Failed to fetch）。常见原因：① 接口地址填错或服务未启动；② 浏览器 CORS 跨域拦截——中转站/本地模型(LM Studio、Ollama 等)默认不带跨域头，官方 API(OpenAI/DeepSeek 直连)不受影响；③ 页面用 file:// 打开或 https 页面请求 http 接口。可先在浏览器新标签页直接打开 " + url + " 验证地址可达性。");
      }
      throw e;
    });
  };

  window.ST = ST;
})();
