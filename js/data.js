/* ============================================================
   黑城残响 · 游戏数据层
   (世界书 / 战力榜 / 物品库 / 技能天赋 / 任务地图 / 默认状态)
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 17+1 黑城势力战力榜 ---------- */
  const POWER_RANK = [
    { rank: 1, name: "大秦", title: "咸阳黑庭", leader: "始皇帝·嬴政", seat: "黑曜咸阳宫", power: 99, threat: "灭世级", stance: "敌视", isTop3: true, desc: "十七纪元以来唯一铸成「统一黑令」的势力。黑金军团与兵马俑军团横行黑城全域，铁律森严，凡违秦法者皆入刑徒营。其「焚书坑儒」令黑城知识垄断，史官只许秦笔。", icon: "crown" },
    { rank: 2, name: "大唐", title: "长安天策府", leader: "太宗·李世民", seat: "不夜长安", power: 94, threat: "霸业级", stance: "警惕", isTop3: true, desc: "万邦来朝之盛景在废墟中重建。天策府豢养「凌烟阁」二十四异人，丝绸之路重开，是黑城最大的贸易枢纽。与大明、大宋缔结「三朝互市」盟约，共抗大秦。", icon: "flag" },
    { rank: 3, name: "大明", title: "应天锦衣卫", leader: "洪武·朱元璋", seat: "金陵应天府", power: 91, threat: "霸业级", stance: "中立", isTop3: true, desc: "锦衣卫与东厂的暗线织成黑城最密的情报网。火器被禁，然大明以机关神机营称雄。对一切外来者施以严苛的「路引」制度，无引者入城即囚。", icon: "flag" },
    { rank: 4, name: "大汉", title: "未央宫汉室", leader: "光武·刘秀", seat: "未央宫", power: 88, threat: "王权级", stance: "友善", desc: "汉室以「天命」为旗帜收拢流民，崇尚儒术与察举。未央宫前常设问策台，凡能言治世之道者皆可入仕。对大秦的「废史」最为不满。", icon: "flag" },
    { rank: 5, name: "大宋", title: "东京汴梁", leader: "仁宗·赵祯", seat: "东京汴梁", power: 84, threat: "王权级", stance: "友善", desc: "文治之极。墨家机关术与活字印刷在此兴盛，夜市灯火彻夜不熄。军力孱弱却富甲黑城，靠「岁币外交」在大秦与太平天国之间左右逢源。", icon: "flag" },
    { rank: 6, name: "大清", title: "盛京八旗", leader: "太宗·皇太极", seat: "盛京", power: 80, threat: "王权级", stance: "中立", desc: "八旗铁骑自关外入主，以「剃发易服」立威。火器虽禁，然红夷大炮改铸为「镇魂炮」，镇守盛京四门。对异种生物最为残酷，见之即猎。", icon: "flag" },
    { rank: 7, name: "大元", title: "大都怯薛", leader: "世祖·忽必烈", seat: "大都", power: 77, threat: "王权级", stance: "敌视", desc: "铁骑踏碎旧秩序，以「四等人制」治黑城。怯薛军人人配金锭马刀，弯刀出鞘必见血。与大秦订有「互不犯界」之约，却在暗中豢养巨兽。", icon: "flag" },
    { rank: 8, name: "太平天国", title: "天京圣土", leader: "天王·洪秀全", seat: "天京", power: 74, threat: "燎原级", stance: "警惕", desc: "以「拜上帝会」起于乱世，人人裹黄巾、信天父。圣兵悍不畏死，更以「圣库」制度聚集粮秣。与黄巾军同源而异流——太平崇天父，黄巾拜苍天。", icon: "flag" },
    { rank: 9, name: "大隋", title: "大兴骁果", leader: "炀帝·杨广", seat: "大兴城", power: 71, threat: "王权级", stance: "中立", desc: "运河贯通黑城南北，骁果卫以「万人敌」著称。炀帝好大喜功，数次远征「雾沼地」深处的巨兽巢穴，损兵折将而归。", icon: "flag" },
    { rank: 10, name: "三国·魏", title: "许都虎豹骑", leader: "魏武·曹操", seat: "许都", power: 68, threat: "割据级", stance: "中立", desc: "「宁教我负天下人」——魏武以奇谋与虎豹骑割据北境。摸金校尉暗中发掘古墓，得无数金锭秘宝，为北境最富庶的军阀。", icon: "flag" },
    { rank: 11, name: "三国·吴", title: "建业水师", leader: "吴大帝·孙权", seat: "建业", power: 65, threat: "割据级", stance: "中立", desc: "长江上的霸主。楼船十丈，帆如垂云，垄断河运与渔盐之利。与蜀汉联姻结盟，共守长江天险。", icon: "flag" },
    { rank: 12, name: "三国·蜀", title: "成都白毦兵", leader: "昭烈·刘备", seat: "成都", power: 62, threat: "割据级", stance: "友善", desc: "以仁德立世，白毦兵与五虎上将名震天下。虽偏安一隅，却是黑城唯一公开收留异种与流民的势力，故多受各方掣肘。", icon: "flag" },
    { rank: 13, name: "大晋", title: "洛阳中军", leader: "武帝·司马炎", seat: "洛阳", power: 58, threat: "割据级", stance: "中立", desc: "承魏而立，门阀林立。八王之乱后元气大伤，如今以「九品中正」治世，苟安于洛阳一隅，对黄巾瘟疫畏之如虎。", icon: "flag" },
    { rank: 14, name: "大楚", title: "彭城项家军", leader: "西楚·项羽", seat: "彭城", power: 55, threat: "割据级", stance: "中立", desc: "「力拔山兮气盖世」——霸王之勇冠绝黑城，万人敌之姿令大秦亦忌惮三分。然刚愎自用，军中无谋士，空有八千子弟兵。", icon: "flag" },
    { rank: 15, name: "大辽", title: "上京皮室军", leader: "太祖·耶律阿保机", seat: "上京临潢府", power: 52, threat: "割据级", stance: "敌视", desc: "草原狼骑，来去如风。皮室军骑射无双，常劫掠商路。与西夏结盟，与大金世仇，逐水草而居，无固定疆界。", icon: "flag" },
    { rank: 16, name: "大金", title: "会宁铁浮屠", leader: "太祖·完颜阿骨打", seat: "会宁府", power: 49, threat: "割据级", stance: "敌视", desc: "铁浮屠重骑人马俱甲，冲锋时如钢铁洪流。曾两度攻破大辽上京，如今厉兵秣马，觊觎中原。", icon: "flag" },
    { rank: 17, name: "西夏", title: "兴庆铁鹞子", leader: "景宗·李元昊", seat: "兴庆府", power: 46, threat: "割据级", stance: "中立", desc: "以党项铁鹞子与「连环弩阵」称雄西北。立国虽晚，却精于守城与机关术，是黑城西陲最难啃的硬骨头。", icon: "flag" },
    { rank: 18, name: "黄巾军", title: "太平道·瘟疫之源", leader: "大贤良师·张角", seat: "苍天巨野", power: 41, threat: "禁忌级", stance: "毁灭", isOutside: true, desc: "「苍天已死，黄天当立。」黄巾军位列第十八席——因为瘟疫本身就是他们的军势。太平道以符水咒术散播「黄天疫」，凡染疫者皆化为行尸走肉般的黄巾力士。黑城诸势力忌惮瘟疫甚于大秦，曾联手「清野」，却始终未能剿灭其源头。你体内的每一缕异变，或许都与此有关。", icon: "skull" }
  ];

  /* ---------- 身份体系 (初始属性以 0 级猎奴为基点) ---------- */
  const 初始基点 = { 力量: 10, 敏捷: 10, 智力: 5, 攻击: 0, 防御: 0, 穿透: 0, 魅力: 5, 幸运: 1 };
  const IDENTITIES = [
    { id: "survivor", name: "幸存者", sub: "猎奴出身", icon: "user", tag: "自由之身", desc: "废墟中的猎奴，挣脱枷锁后以狩猎为生。无阵营、无光环，却拥有最自由的命运轨迹。", class: "流浪猎手", rankSeal: "猎", baseAttr: 初始基点, hp: 10, stamina: 5, aura: null },
    { id: "guard", name: "黑城势力", sub: "黑城卫", icon: "shield", tag: "自带阵营光环", desc: "黑城卫的持牌卫士，宣誓以血守护黑城律法。自带「黑城威仪」阵营光环，城内行事如鱼得水。", class: "黑城卫士", rankSeal: "卫", baseAttr: 初始基点, hp: 10, stamina: 5, aura: "guard", faction: "黑城卫" },
    { id: "mutant", name: "变异生物", sub: "异种", icon: "droplet", tag: "非人之躯", desc: "被黄天疫或黑城辐射异化的存在。非人、非兽，为诸势力所不容，却拥有超越凡躯的潜能。", class: "异种猎手", rankSeal: "异", baseAttr: 初始基点, hp: 10, stamina: 5, aura: "mutant", faction: "无归属" }
  ];

  /* ---------- 难度 ---------- */
  const DIFFICULTIES = [
    { id: "easy", name: "简单", pts: 80, talentPts: 10, desc: "天命眷顾 · 险境逢生", color: "jade" },
    { id: "normal", name: "普通", pts: 50, talentPts: 8, desc: "众生皆苦 · 唯力是凭", color: "gold" },
    { id: "hard", name: "困难", pts: 30, talentPts: 6, desc: "黑城无情 · 步步杀机", color: "crimson" },
    { id: "nightmare", name: "噩梦", pts: 10, talentPts: 4, desc: "苍天已死 · 黄天当立", color: "crimson" }
  ];

  /* ---------- 天赋品质 (品质决定花费点数与属性加成幅度) ---------- */
  const TALENT_QUALITY = {
    凡阶: { cost: 1, color: "common", bonus: 2, rank: 0 },
    灵阶: { cost: 2, color: "fine", bonus: 3, rank: 1 },
    史诗: { cost: 4, color: "rare", bonus: 4, rank: 2 },
    神话: { cost: 6, color: "epic", bonus: 6, rank: 3 }
  };

  /* ---------- 天赋池 (按品质排列; 多选, 消耗天赋点) ---------- */
  const TALENTS = [
    { id: "ironbone", name: "铁骨", icon: "shield", tier: "凡阶", desc: "生命上限 +20，受到的物理伤害 -8%", apply: s => { s.生命.上限 += 20; s.生命.当前 = s.生命.上限; } },
    { id: "sturdy", name: "强健", icon: "sword", tier: "凡阶", desc: "力量 +2，搬动重物不易力竭", apply: s => { s.属性.力量 += 2; } },
    { id: "lissome", name: "轻身", icon: "wind", tier: "凡阶", desc: "敏捷 +2，翻越瓦砾如履平地", apply: s => { s.属性.敏捷 += 2; } },
    { id: "lucky", name: "天幸", icon: "star", tier: "凡阶", desc: "幸运 +2，总能捡到有用的东西", apply: s => { s.属性.幸运 += 2; } },
    { id: "thickskin", name: "厚皮", icon: "shield", tier: "凡阶", desc: "防御 +2，皮糙肉厚耐打", apply: s => { s.属性.防御 += 2; } },
    { id: "swift", name: "迅捷", icon: "wind", tier: "灵阶", desc: "敏捷 +3，气力回复速度 +15%", apply: s => { s.属性.敏捷 += 3; } },
    { id: "keenmind", name: "慧心", icon: "brain", tier: "灵阶", desc: "智力 +3，经验获取 +12%", apply: s => { s.属性.智力 += 3; } },
    { id: "favored", name: "天眷", icon: "star", tier: "灵阶", desc: "幸运 +3，稀有掉落率 +8%", apply: s => { s.属性.幸运 += 3; } },
    { id: "keeneye", name: "鹰眼", icon: "eye", tier: "灵阶", desc: "穿透 +2，洞察破绽与危险", apply: s => { s.属性.穿透 += 2; } },
    { id: "predator", name: "猎杀本能", icon: "eye", tier: "史诗", desc: "对受伤目标攻击 +15%，穿透 +4", apply: s => { s.属性.穿透 += 4; } },
    { id: "undying", name: "不灭之躯", icon: "heart", tier: "史诗", desc: "生命低于 30% 时，每秒回复 2% 生命", apply: s => { s.生命.上限 += 10; s.生命.当前 = s.生命.上限; } },
    { id: "titan", name: "蛮神之力", icon: "hammer", tier: "神话", desc: "力量 +5，攻击 +5，蛮力骇人", apply: s => { s.属性.力量 += 5; s.属性.攻击 += 5; } },
    { id: "destiny", name: "天命之子", icon: "crown", tier: "神话", desc: "全属性 +2，命运仍在书写", apply: s => { Object.keys(s.属性).forEach(k => { s.属性[k] += 2; }); } },
    { id: "ironwall", name: "铁壁", icon: "shield", tier: "灵阶", desc: "防御 +3，气力回复速度 +10%", apply: s => { s.属性.防御 += 3; } },
    { id: "stoneheart", name: "石心", icon: "heart", tier: "灵阶", desc: "气力值上限 +10，连续作战能力提升", apply: s => { s.气力.上限 += 10; s.气力.当前 = s.气力.上限; } },
    { id: "deft", name: "巧手", icon: "gift", tier: "灵阶", desc: "幸运 +2，敏捷 +1，搜刮与制作皆利", apply: s => { s.属性.幸运 += 2; s.属性.敏捷 += 1; } },
    { id: "swordsman", name: "剑术大师", icon: "sword", tier: "史诗", desc: "攻击 +4，穿透 +2，招式精纯", apply: s => { s.属性.攻击 += 4; s.属性.穿透 += 2; } },
    { id: "ninelives", name: "九命", icon: "heart", tier: "史诗", desc: "生命上限 +40，濒死时韧性惊人", apply: s => { s.生命.上限 += 40; s.生命.当前 = s.生命.上限; } },
    { id: "blackcity", name: "黑城亲和", icon: "skull", tier: "神话", desc: "灵视 +3，魅力 +3，黑城压制对你失效大半", apply: s => { s.角色.灵视 = (s.角色.灵视 || 0) + 3; s.属性.魅力 += 3; } }
  ];

  /* ---------- 阵营新兵包 (黑城卫阵营效忠步骤): 按排行生成 光环/装备/声望 ---------- */
  const FACTION_GEAR = {
    大秦: "青铜秦剑", 大唐: "唐制横刀", 大汉: "环首汉刀", 大宋: "精铸朴刀",
    大清: "八旗战刀", 大元: "蒙古弯刀", 太平天国: "太平斩马刀", 大隋: "隋制马槊",
    "三国·魏": "青州长戟", "三国·吴": "解烦环刀", "三国·蜀": "白耳长刀",
    大晋: "晋制环首刀", 大楚: "楚式短剑", 大辽: "辽东弯刀", 大金: "狼牙铁棒",
    西夏: "西夏腰刀", 黄巾军: "黄巾柴刀"
  };
  function factionRecruit(f) {
    /* 新兵包强度按黑城排名梯度: 排名越前, 光环/装备/声望越优厚 (黄巾 rank 18 最末最弱) */
    const rank = f.isOutside ? 18 : f.rank;
    const TIERS = [
      { min: 1,  max: 3,  auraBonus: 10, rep: 15, quality: "绿色", atk: 4, dura: 45 },   // 前三: 灭世/霸业级
      { min: 4,  max: 8,  auraBonus: 8,  rep: 12, quality: "绿色", atk: 3, dura: 40 },   // 王权级
      { min: 9,  max: 13, auraBonus: 6,  rep: 8,  quality: "白色", atk: 3, dura: 35 },   // 割据级
      { min: 14, max: 17, auraBonus: 4,  rep: 5,  quality: "白色", atk: 2, dura: 30 },   // 末席诸候
      { min: 18, max: 18, auraBonus: 2,  rep: 2,  quality: "白色", atk: 1, dura: 25 }    // 黄巾 (末位)
    ];
    const t = TIERS.find(x => rank >= x.min && rank <= x.max) || TIERS[3];
    function WEAPON_NAME(faction, quality) { return (FACTION_GEAR[faction.name] || (faction.name + "佩刀")) + (quality === "绿色" ? "·良" : ""); }
    return {
      aura: {
        id: "fac_" + rank,
        name: f.name + "·新兵光环",
        desc: "军势加身：对同阵营 NPC 初始好感 +" + t.auraBonus + "，威慑判定占优；叛离阵营后光环失效。(" + f.name + "位列第" + rank + ")"
      },
      auraBonus: t.auraBonus,
      reputation: t.rep,
      gear: [
        { name: f.name + "腰牌", type: "信物", quality: t.quality, desc: "刻有" + f.name + "徽记的身份腰牌，同阵营关卡查验放行。" },
        { name: WEAPON_NAME(f, t.quality), type: "武器", quality: t.quality, atk: t.atk, dura: t.dura, desc: "入列时配发的新兵武器，" + (t.quality === "绿色" ? "成色优良。" : "量产凡品，但比凡铁锋利。") },
        { name: f.name + "行军粮", type: "消耗品", quality: "白色", desc: "行军口粮，食用回复 10 点气力。" }
      ]
    };
  }

  /* ---------- 降临地 (九州舆图 · 中国地图) ---------- */
  const LANDS = [
    { id: "changan", name: "废都长安", prov: "陕西", icon: "map-pin", desc: "大唐天策府治下的旧都，瓦砾与新市并存，拾荒者与猎奴的猎场。夜里有「拾荒鬼」出没。", risks: ["低危", "拾荒者聚集"], reward: "开局 60 铜钱", x: 1961, y: 1638 },
    { id: "jinling", name: "金陵夜巷", prov: "江苏", icon: "map-pin", desc: "应天府最热闹的暗巷，赌坊、药庐、黑市一应俱全。锦衣卫的暗线织在每一盏灯笼后。", risks: ["中危", "黑市纠纷"], reward: "情报 +1", x: 2496, y: 1730 },
    { id: "jiangxia", name: "江夏渡口", prov: "湖北", icon: "droplet", desc: "长江水泛着铁锈色，渡口由吴国水师把守。深夜有「河怨」浮上水面。", risks: ["中危", "水匪"], reward: "金锭 ×1", x: 2256, y: 1842 },
    { id: "linan", name: "临安夜巷", prov: "浙江", icon: "map-pin", desc: "西湖已成沼泽，夜市却彻夜不熄。卖花灯的老妪说，这里的灯是点给「下面的人」看的。", risks: ["低危", "阴气重"], reward: "随机白装", x: 2582, y: 1832 },
    { id: "shudao", name: "蜀道关", prov: "四川", icon: "hammer", desc: "剑阁天险，瘴雾锁关。墨家遗脉的天工坊藏在山腹，铁砧声昼夜不息。", risks: ["低危", "蜀道难行"], reward: "随机白装", x: 1701, y: 1868 },
    { id: "yanmen", name: "燕门重镇", prov: "山西", icon: "shield", desc: "北疆重镇，黑城卫总舵所在。城门夜闭，宵禁森严，无「路引」者入城即囚。", risks: ["高危", "宵禁盘查"], reward: "黑城卫声望 +10", x: 2320, y: 1255 }
  ];

  /* ---------- 物品库 ---------- */
  const ITEMS = {
    "锈铁短刀": { name: "锈铁短刀", type: "武器", slot: "武器", quality: "common", icon: "sword", value: 12, durability: 45, maxDura: 45, sockets: 0, bound: false, attrs: { 攻击: 4, 穿透: 1 }, desc: "猎奴营配发的制式短刀，刃口满是豁口，却足以割开皮肉与锁链。" },
    "猎弓": { name: "猎弓", type: "武器", slot: "武器", quality: "fine", icon: "crosshair", value: 38, durability: 60, maxDura: 60, sockets: 1, bound: false, attrs: { 攻击: 6, 敏捷: 2 }, desc: "以长江畔的寒木弯制，弦为魂蛛丝。三息可发两箭，是猎奴的保命家伙。" },
    "破旧皮甲": { name: "破旧皮甲", type: "护甲", slot: "护甲", quality: "common", icon: "shield", value: 20, durability: 52, maxDura: 52, sockets: 0, bound: false, attrs: { 防御: 5 }, desc: "缝了三层的鞣制兽皮，弹丸未必挡得住，但能挡住大多数刀尖。" },
    "猎户皮帽": { name: "猎户皮帽", type: "头盔", slot: "头盔", quality: "common", icon: "helmet", value: 8, durability: 30, maxDura: 30, sockets: 0, bound: false, attrs: { 防御: 2 }, desc: "帽檐压得很低，遮住半张脸——猎奴不该被人记住长相。" },
    "粗布绷带": { name: "粗布绷带", type: "消耗品", slot: "消耗", quality: "common", icon: "scroll", value: 3, stack: 5, desc: "浸过草药的粗布，使用后回复 20 点生命。猎奴的命，就靠这一卷布续着。" },
    "干粮": { name: "干粮", type: "消耗品", slot: "消耗", quality: "common", icon: "gift", value: 2, stack: 8, desc: "硬得能砸死人的面饼，泡水后勉强可食。回复 15 点气力。" },
    "火折子": { name: "火折子", type: "工具", slot: "消耗", quality: "common", icon: "flame", value: 5, stack: 3, desc: "黑城多雾，火光即是希望，也是暴露。" },
    "金锭碎片": { name: "金锭碎片", type: "材料", slot: "材料", quality: "epic", icon: "gem", value: 120, stack: 2, desc: "泛着金色光泽的晶体碎片，据说是「气运」凝结之物。黑城通用硬通货，也是精炼装备的燃料。" },
    "黑城通行铜牌": { name: "黑城通行铜牌", type: "信物", slot: "信物", quality: "fine", icon: "key", value: 0, bound: true, desc: "铸有黑城徽记的铜牌，持之可自由出入各城区。猎奴翻身的第一步。" },
    "瘟疫残骸样本": { name: "瘟疫残骸样本", type: "材料", slot: "材料", quality: "rare", icon: "droplet", value: 0, stack: 1, bound: true, desc: "从染疫者遗骸上刮下的黑色结晶，散发着令人不安的甜腥味。或许有人愿意出高价收购。" },
    "铁匠锤": { name: "铁匠锤", type: "工具", slot: "材料", quality: "common", icon: "hammer", value: 15, desc: "阿蛮的旧锤，柄上刻着「蛮」字。据说曾砸碎过一头巨兽的颅骨。" },
    "染血的信笺": { name: "染血的信笺", type: "信物", slot: "信物", quality: "rare", icon: "scroll", value: 0, bound: true, desc: "半页被血浸透的信，字迹潦草：「……南门塌了，他们在挖什么，像棺材，又像——」" },
    /* ---- 模板范例装备: 玄铁撼天弓 (金·史诗, 展示完整装备模板) ---- */
    "玄铁撼天弓": {
      name: "玄铁撼天弓", type: "武器", slot: "武器", quality: "epic", icon: "crosshair",
      value: 0, durability: 10000, maxDura: 10000, sockets: 2, bound: true,
      等级: 40, 需求: { 力量: 250, 敏捷: 150, 弓术: "专精级别" },
      精炼: { 上限: 6, 当前: 4 }, 镶嵌: { 上限: 2, 当前: 2 },
      特性: [
        { name: "破甲", desc: "破甲效果为50%，除非遇到特殊目标，否则必将无视目标对手一半的防御。" },
        { name: "狂风之魂", desc: "可令射出的羽箭速度提升50%，最大射程提升50%，为4000米。" }
      ],
      技能: { name: "暴雨流星箭", type: "群攻", desc: "需要消耗500点气力值，500点生命值，100点弓魂方可释放，对前方五百米内最多可达五百名目标敌人造成恐怖的箭气伤害，平均每秒伤害1000点，持续五秒钟，此技能冷却时间三日。" },
      attrs: { 生命: 2000, 气力: 500, 力量: 500, 敏捷: 200, 防御: 500, 攻击: 1200 },
      desc: "弓身为准传奇战将慕容垂收集极北玄铁，以一滴恶蛟精血淬炼其上，再以名匠耗时三年打造而成，弓弦则为十八条天蚕丝融合精钢软铁所致，有撼天裂地之威，非神力者，不可掌握！"
    }
  };

  /* 装备栏: 武器×4 / 防具×4 / 其他×4 (共 12 槽位) */
  const GEAR_GROUPS = [
    { id: "武器", icon: "sword" },
    { id: "防具", icon: "shield" },
    { id: "其他", icon: "gem" }
  ];
  const GEAR_SLOTS = [
    /* 武器 ×4 */
    { key: "武器1", label: "武器", icon: "sword", group: "武器" },
    { key: "武器2", label: "武器", icon: "sword-cross", group: "武器" },
    { key: "武器3", label: "武器", icon: "hammer", group: "武器" },
    { key: "武器4", label: "武器", icon: "crosshair", group: "武器" },
    /* 防具 ×4 */
    { key: "头盔", label: "头盔", icon: "helmet", group: "防具" },
    { key: "护甲", label: "护甲", icon: "shield", group: "防具" },
    { key: "手套", label: "手套", icon: "gauntlet", group: "防具" },
    { key: "靴子", label: "靴子", icon: "boots", group: "防具" },
    /* 其他 ×4 */
    { key: "项链", label: "项链", icon: "necklace", group: "其他" },
    { key: "戒指1", label: "戒指", icon: "ring", group: "其他" },
    { key: "戒指2", label: "戒指", icon: "ring", group: "其他" },
    { key: "特殊装备", label: "特殊装备", icon: "amulet", group: "其他" }
  ];

  /* 装备品质: 白普通 < 绿优良 < 蓝精良 < 紫传说 < 金史诗 < 红神话 < 黑诅咒 */
  const QUALITY_ORDER = ["broken", "common", "fine", "rare", "legend", "epic", "myth", "cursed"];
  const QUALITY_LABEL = { broken: "破损", common: "普通", fine: "优良", rare: "精良", legend: "传说", epic: "史诗", myth: "神话", cursed: "诅咒" };
  const QUALITY_COLOR = {
    broken: "#7a7a80", common: "#c9c4b6", fine: "#4fae6a", rare: "#4f8fd0",
    legend: "#9a6fd0", epic: "#d9a441", myth: "#d6455f", cursed: "#1b1b22"
  };

  /* ---------- 技能 ---------- */
  const SKILLS = [
    { id: "s1", name: "疾影突袭", icon: "zap", type: "主动 · 身法", level: 1, maxLevel: 5, cost: 8, desc: "化作残影冲向目标，造成 120% 攻击伤害，并短暂提升自身闪避。猎奴求生之本。" },
    { id: "s2", name: "猎杀标记", icon: "target", type: "主动 · 辅助", level: 1, maxLevel: 5, cost: 5, desc: "标记一名敌人，使其受到的伤害 +15%，持续 3 回合。标记只对一人有效，且会暴露自身。" },
    { id: "s3", name: "残影步", icon: "wind", type: "被动 · 身法", level: 1, maxLevel: 3, cost: 0, desc: "移动时留下残影迷惑追击者，闪避 +6%。" },
    { id: "s4", name: "荒野直觉", icon: "eye", type: "被动 · 感知", level: 0, maxLevel: 3, cost: 0, locked: true, desc: "对危险的本能警觉——解锁需要「灵视」达到 2。" },
    { id: "s5", name: "蓄力斩", icon: "sword", type: "主动 · 武技", level: 0, maxLevel: 5, cost: 12, locked: true, desc: "蓄力一回合，造成 220% 攻击伤害。解锁需要主职业进阶至「猎刃」。" },
    { id: "s6", name: "屠龙术", icon: "sword-cross", type: "绝学 · 隐藏", level: 0, maxLevel: 1, cost: 0, locked: true, hidden: true, desc: "对巨型生物伤害 +300%。隐藏职业「屠龙者」专属——没有人知道如何习得，除了一个人。" }
  ];

  /* ---------- 光环 ---------- */
  const AURAS = {
    guard: { name: "黑城威仪", icon: "shield", desc: "黑城卫的阵营光环：城内 NPC 好感 +10%，威慑判定 +1；被猎奴与异种势力记恨。", dur: "常驻" },
    mutant: { name: "异化躯体", icon: "droplet", desc: "异种的阵营光环：生命回复 +2/回合，受到的治疗 -30%；诸势力初见好感 -20%。", dur: "常驻" },
    hunter: { name: "猎者本能", icon: "target", desc: "幸存者的独狼光环：对野兽与异种伤害 +10%，孤立无援时攻击 +5%。", dur: "常驻" },
    fever: { name: "黄天疫 · 潜伏期", icon: "skull", desc: "体内潜伏的黄天疫因子正在苏醒：每夜有 10% 概率灵视 +1，也可能引来「太平道」的注视。", dur: "潜伏中" }
  };

  /* ---------- 任务 ---------- */
  const QUESTS = [
    { id: "q1", type: "main", name: "黑城残响 · 序章", desc: "从猎奴营逃出后，你握着一块破碎的铜牌与一段模糊的记忆。铁匠阿蛮或许知道你的过去。", progress: { cur: 0, max: 3 }, steps: ["抵达废都长安", "找到铁匠阿蛮", "查明铜牌来历"], reward: "经验×80 · 铁匠锤", done: false },
    { id: "q2", type: "side", name: "废墟里的呼救", desc: "废都长安深处传来断断续续的呼救声——是陷阱，还是真的有人被困？", progress: { cur: 0, max: 1 }, steps: ["循声探查"], reward: "铜钱×40 · 随机消耗品", done: false },
    { id: "q3", type: "side", name: "金锭碎片", desc: "黑市悬赏：收集 3 块金锭碎片。据说与「瘟疫源头」有关。", progress: { cur: 1, max: 3 }, steps: ["收集碎片 1/3"], reward: "金锭×1 · 声望+10", done: false },
    { id: "q4", type: "hidden", name: "苍天已死", desc: "「大贤良师」在梦中低语。黄巾军的瘟疫为何与你有关？你不敢细想。", progress: { cur: 0, max: 5 }, steps: ["灵视 ≥ 3"], reward: "隐藏职业线索", done: false, hidden: true }
  ];

  /* ---------- 地图节点 (九州舆图 · 中国地图) ---------- */
  const MAP_NODES = [
    { id: "changan", name: "废都长安", x: 1961, y: 1638, icon: "map-pin", type: "area", desc: "你醒来的地方。瓦砾下的旧都仍会传来铁器的碰撞声——有人在废墟下挖着什么。", danger: "低", npcs: ["阿蛮", "老鸦"] },
    { id: "jinling", name: "金陵夜巷", x: 2496, y: 1730, icon: "map-pin", type: "area", desc: "应天府暗面。秦淮烟水染成墨色，赌坊的药庐里飘出金锭的幽香，黑市摊主会收任何东西——除了麻烦。", danger: "中", npcs: ["素手", "老鸦"] },
    { id: "jiangxia", name: "江夏渡口", x: 2256, y: 1842, icon: "droplet", type: "area", desc: "长江水泛着铁锈色。吴国水师的楼船横在江心，渡口对岸是大秦的势力范围。", danger: "中", npcs: ["燕九"] },
    { id: "linan", name: "临安夜巷", x: 2582, y: 1832, icon: "map-pin", type: "area", desc: "西湖沦为沼泽，夜市灯火彻夜不熄。大宋的机关花灯在雾里明明灭灭，人鬼不分。", danger: "低", npcs: ["素手"] },
    { id: "shudao", name: "蜀道关", x: 1701, y: 1868, icon: "hammer", type: "area", desc: "剑阁天险，瘴雾锁关。墨家天工坊藏在山腹，这里能修补装备、精炼武器、镶嵌宝石。", danger: "低", npcs: ["阿蛮"] },
    { id: "yanmen", name: "燕门重镇", x: 2320, y: 1255, icon: "shield", type: "area", desc: "北疆重镇，黑城卫总舵所在。城门夜闭，宵禁森严——黑城律法在此最为锋利。", danger: "极高", npcs: ["燕九"] },
    { id: "blackgate", name: "洛阳 · 黑曜门", x: 2145, y: 1605, icon: "lock", type: "locked", desc: "洛阳古都中央矗立着一座纯黑的门楼——黑城的内城之门，由黑城卫把守。无「路引」者不得入内，门后藏着黑城的真正秘密。", danger: "极高", locked: true, need: "黑城卫身份 或 路引" },
    { id: "julu", name: "巨鹿 · 黄巾疫区", x: 2290, y: 1430, icon: "skull", type: "plague", desc: "被黄天疫吞噬的旧地，黑雾终年不散。太平道在此布下符阵，凡人踏入即染疫。", danger: "禁忌", locked: true, need: "灵视 ≥ 3 且 疫抗 ≥ 2" }
  ];

  /* ---------- NPC ---------- */
  const NPCS = [
    { id: "aman", name: "铁匠阿蛮", role: "天工坊铁匠", icon: "hammer", relation: 30, relLabel: "旧识", desc: "虎背熊腰的中年铁匠，左臂是机关义肢。据说他曾是黑城卫的匠作监，因为「打了一件不该打的兵器」被逐出。他见到你腰间的铜牌时，眼神闪烁。", location: "废都长安 / 蜀道关 · 天工坊", lines: ["「小子，你那块铜牌……是哪儿来的？」", "「南门塌了那晚，我在废墟里捡到过半块，和你的是一对。」"] },
    { id: "laoya", name: "老鸦", role: "情报贩子", icon: "eye", relation: 10, relLabel: "泛泛之交", desc: "披着破斗篷的独眼男人，站在金陵夜巷口的阴影里。他的情报按「可靠程度」明码标价——但从不保证真假。", location: "金陵夜巷", lines: ["「三枚铜钱，一个问题。童叟无欺。」", "「听说太平道的符水，能让人看见『不该看见的东西』。」"] },
    { id: "sushou", name: "素手", role: "流浪医者", icon: "heart", relation: 15, relLabel: "点头之交", desc: "背着药箱的年轻女子，纱布覆住半张脸。她治瘟疫不收钱，只收「故事」。有人说她治好的病人，醒来后都不再害怕黑暗。", location: "临安夜巷", lines: ["「你的脉象……有点怪。像是有东西在跳。」", "「如果夜里有黄巾的人找你，别开门。」"] },
    { id: "yanjiu", name: "燕九", role: "黑城卫·百夫长", icon: "shield", relation: 5, relLabel: "生面孔", desc: "黑城卫的百夫长，佩刀从不离身。他守在江夏渡口，检查每一个渡江的人。目光在你身上停留了太久。", location: "江夏渡口", lines: ["「站住。路引。」", "「猎奴？啧，最近逃出来的猎奴，怎么都往废都跑。」"] },
    { id: "priest", name: "黄巾祭者", role: "太平道·密使", icon: "skull", relation: -40, relLabel: "暗中注视", desc: "一个永远站在雾里的人，黄巾遮面。他从不主动出现，只在你灵视足够高时，才会在梦的边缘与你交谈。", location: "未知", hidden: true, lines: ["「苍天已死……而你有资格听见这句话。」", "「你体内的『种』，是我亲手埋下的。」"] }
  ];

  /* ---------- 编年史初始 (开局仅一条序章) ---------- */
  const CHRONICLE_SEED = [
    { time: "序章", title: "黑城降临之日", body: "乌云在市中心凝固成黑色巨城，电视信号崩溃，古代军团与觉醒异兽席卷大地，世界秩序在一小时内崩塌。末日降临，游戏开始。" }
  ];

  /* ---------- 默认角色状态 (中文键名结构) ---------- */
  function defaultStat() {
    return {
      角色: {
        姓名: "无名旅者", 性别: "?", 年龄: "?", 身份: "猎奴", 主职业: "无", 副职业: "未习得", 隐藏职业: "未觉醒",
        位阶: "猎奴", 战力评价: "极低", 兵种评级: "无", 等级: 0, 经验: 0, 经验上限: 100,
        自由属性点: 0, 灵视: 0, 声望: 0, 建城令: 0, 疫抗: 0,
        货币: { 铜钱: 10, 银两: 0, 金锭: 0 }
      },
      属性: { 力量: 10, 敏捷: 10, 智力: 5, 攻击: 0, 防御: 0, 穿透: 0, 魅力: 5, 幸运: 1 },
      生命: { 当前: 10, 上限: 10 },
      气力: { 当前: 5, 上限: 5 },
      背包: [
        { id: "b4", ref: "粗布绷带", qty: 2 },
        { id: "b5", ref: "干粮", qty: 3 },
        { id: "b6", ref: "火折子", qty: 1 },
        { id: "b8", ref: "黑城通行铜牌", qty: 1 },
        { id: "b9", ref: "染血的信笺", qty: 1 }
      ],
      装备: { 武器1: null, 武器2: null, 武器3: null, 武器4: null, 头盔: null, 护甲: null, 手套: null, 靴子: null, 项链: null, 戒指1: null, 戒指2: null, 特殊装备: null },
      装备详情: {},
      技能: ["s1", "s2", "s3"],
      光环: ["hunter"],
      任务: ["q1", "q2", "q3"],
      任务进度: {
        q1: { cur: 0, max: 3, done: false },
        q2: { cur: 0, max: 1, done: false },
        q3: { cur: 1, max: 3, done: false },
        q4: { cur: 0, max: 5, done: false }
      },
      天赋: [],
      阵营: { 名称: "无归属", 声望: 0, 立场: "中立" },
      地点: "废都长安",
      日期: { 年: 1, 月: 1, 日: 1, 时辰: "子时", 时: 0, 分: 0 },
      天气: "阴云",
      编年史: []
    };
  }

  /* ---------- 协议模拟 (无后端时的演示引擎) ---------- */
  const PROLOGUE = [
    "某天，漆黑如墨的乌云席卷了整个世界。它们在市中心上空翻涌、沉降，随即如蜡般融化、浇筑，短短几秒便凝固成一座座古老的黑色城池。\n\n起初，人们只是好奇。但仅仅一个小时后，好奇便化作了彻骨的恐慌。\n\n电视信号在崩溃前播出了最后一批画面：“……长安市中心出现不明黑色建筑，专家初步判断为罕见气象现象……”“……黄海市中心古城轮廓清晰，气象局否认与台风有关……”“……成都市区陷入黑暗，所有电力中断，目击者称看到城墙从地底升起……”“……滇池市中心涌出大量古代装束的武装人员，火力无法阻挡，重复，火力无法阻挡……”“……洛阳方向，大汉军队正在清场，这不是演习……”“……咸阳已失守，秦军见人就杀，子弹无法穿透其铠甲!……”“……郑州全城陷入混乱，黄巾军……信号中断……”\n\n大洋彼岸同样未能幸免。一座美国城市在市民伤亡激增后，向市中心的黑城发射了三枚导弹。导弹拖着尾焰没入那片浓稠的黑暗，却如同石子沉入深潭——没有爆炸，没有火光，甚至没有回声。黑城沉默地吞噬了一切，连一丝涟漪都未曾泛起。\n\n而黑城之内，无数身着古代军服的士兵从粘滞的初生状态中缓缓“醒来”。他们的思维如同冻结的泥浆，每一个动作都机械而缓慢，喉间只能发出破碎的音节。他们继承了肌肉记忆中的战斗本能，却尚未理解自己为何存在于这座由冰冷巨石堆砌的陌生城池中。他们是庞大战争机器上的一颗颗螺丝钉——此刻懵懂，却将在日复一日的世界脉动中，逐渐恢复智识、情感与自我。\n\n山林、田野、河泽之中，无数地球上的原住生物正经历着更为剧烈的蜕变。猛虎的骨骼在痛苦的咆哮中扭曲伸长，野狼的眼瞳深处燃起幽绿色的火焰，飞禽的羽翼边缘泛起金属般的冷光，甚至连池塘中的游鱼都在翻涌的水面下长出坚硬的鳞刺。它们被黑城降临所释放的能量粗暴地重塑，血脉中沉睡的洪荒记忆开始苏醒——那些只存在于上古神话中的巨兽血脉，在它们的血管中奔涌。它们不再是普通的野兽，而是觉醒者，是这个世界新的猎手。饥饿、领地、生存——古老的本能驱使着它们在这片被颠覆的大地上重新划定秩序。\n\n天穹之上轰然雷响\n\n“卑微且渺小的爬虫们！努力挣扎吧！要么成为待宰的羔羊，要么不惜一切活下去，你们，别无选择！”"
  ];

  const OPTION_SET_A = [
    { text: "环顾四周，确认自己身处何方", tag: "求生", risk: false },
    { text: "抬头仰望那座凝固于天际的黑城", tag: "凝视", risk: false },
    { text: "摸出手机，尝试联络失散的亲人", tag: "牵挂", risk: true }
  ];

  const DEMO_RESPONSES = {
    "aman": {
      main: "铁匠把锤子往地上一杵，眯着眼凑近你腰间的铜牌。\n\n「……嘶，这玩意儿。」他伸出机关义肢，指节在铜牌边缘轻轻叩了两下，发出沉闷的「笃笃」声。「黑城卫的通行牌，三年前就停发了。你一个猎奴，身上怎么会有这东西？」\n\n他盯着你看了很久，最后叹了口气，从怀里摸出一块一模一样的铜牌——只是边缘缺了一角。\n\n「南门塌了那一夜，我在废墟里捡到过半块，和你这块的断口……严丝合缝。」他把两块铜牌拼在一起，咔哒一声，严丝合缝。\n\n「小子，你失忆了？」他忽然压低声音，「你后颈那个烙印——猎奴营的烙铁从来只印「奴」字，可你这个，下面还压着一行小字。」\n\n他没说那行字是什么，只是把铜牌还给你，转身往蜀道方向走：「天黑了，别在废墟里瞎晃。想活命，明天到蜀道天工坊来找我——带着你那条命来。」",
      options: [
        { text: "追问那行小字的内容", tag: "主线", risk: false },
        { text: "跟上他，现在就问个明白", tag: "冲动", risk: true },
        { text: "先搜刮废墟里的物资，明天再赴约", tag: "稳妥", risk: false }
      ],
      sum: "主角于废都长安结识铁匠阿蛮。阿蛮的铜牌与主角的严丝合缝——主角失忆前疑为黑城卫相关人物，后颈烙印下藏有一行小字。阿蛮邀主角明日赴蜀道天工坊。"
    },
    "mutant": {
      main: "你后退半步，指节扣住了腰间的刀柄。\n\n铁匠却像没看见你的敌意，自顾自把锤子扛回肩上，嗤笑一声：「戒备心倒是不错，像在这鬼地方活过几年的人。行，我阿蛮不绕弯子——我叫阿蛮，天工坊打铁的。你身后那堆瓦砾底下，埋着半间铁匠铺，是我的。」\n\n他抬了抬机关义肢，指节间咔咔作响：「铺子被埋了三年，懒得挖。倒是你——」他话锋一转，「你从猎奴营那边来？那边最近不太平。三天前，一队太平道的黄巾贼进了营，说要『挑选祭品』。当天夜里，南门方向的地底下，就传来那种……嗡鸣声。」\n\n他压低声音：「你逃出来的时候，有没有看见什么不该看见的东西？」",
      options: [
        { text: "「黄巾贼？他们挑祭品做什么？」", tag: "情报", risk: false },
        { text: "摇头，装作什么都不知道", tag: "隐瞒", risk: true },
        { text: "把那块染血的信笺递给他看", tag: "信物", risk: false }
      ],
      sum: "阿蛮透露：三日前太平道黄巾贼进入猎奴营「挑选祭品」，当夜南门地底传出异响。主角逃出时疑似携带重要信物。"
    }
  };

  /* ---------- 经验与升级 (指数曲线) ---------- */
  const EXP = {
    基础怪物经验: 50, /* 1 级恶鬼的经验值 */
    升级所需经验: function (当前等级) {
      /* 0→1: 100 = 2头1级恶鬼 · 1→2: 1000 = 20头1级恶鬼 · 此后每级 ×10 */
      return 100 * Math.pow(10, 当前等级);
    },
    怪物经验: function (等级) { return EXP.基础怪物经验 * 等级; },
    升级奖励: { 生命: 2, 自由属性点: 2 }
  };

  function 经验百分比(经验, 上限) {
    if (!上限) return 0;
    return Math.max(0, Math.min(100, Math.round(经验 / 上限 * 100)));
  }

  /* 一次性经验入账: 自动连续升级, 每次升级生命+2 / 自由属性点+2 */
  function grantExp(state, 增量) {
    const R = state.角色;
    R.经验 += 增量;
    let 升级次数 = 0;
    while (R.经验 >= R.经验上限) {
      R.经验 -= R.经验上限;
      R.等级 += 1;
      state.生命.上限 += 2;
      state.生命.当前 = state.生命.上限;
      R.自由属性点 = (R.自由属性点 || 0) + 2;
      R.经验上限 = EXP.升级所需经验(R.等级);
      升级次数++;
    }
    return 升级次数;
  }

  /* ---------- 掉落概率 (均低) ---------- */
  const DROPS = {
    掉袋概率: { 普通: 0.08, 精英: 0.18, 首领: 0.45 },
    袋内权重: { 食物: 30, 饮品: 22, 货币: 25, 装备: 18, 材料: 5 },
    装备品质权重: { common: 55, fine: 25, rare: 12, legend: 5, epic: 2.4, myth: 0.5, cursed: 0.1 },
    /* 掉落品质不能高于掉落者所穿装备的品质, 且以等于该品质为主 (破损不参与掉落) */
    rollQuality: function (cap) {
      if (!cap) return "common";
      const ORDER = QUALITY_ORDER.filter(function (q) { return q !== "broken"; });
      const idx = ORDER.indexOf(cap);
      if (idx < 0) return "common";
      const pool = ORDER.slice(0, idx + 1);
      const w = [10, 12, 15, 18, 22, 26, 30].slice(0, idx + 1); /* cap 越高级权重越高 */
      const total = w.reduce(function (s, x) { return s + x; }, 0);
      let r = Math.random() * total;
      for (let i = 0; i < pool.length; i++) {
        r -= w[i];
        if (r <= 0) return pool[i];
      }
      return cap;
    }
  };

  /* ---------- 恶鬼/怪物图鉴 (模板含势力/评级/光环/装备/技能/数值来源) ---------- */
  const DEMONS = [
    { 等级: 1, 名称: "游荡恶鬼", 类型: "普通", 势力: "无", 兵种评级: 0, 生命: 15, 气力: 3, 力量: 12, 敏捷: 8, 防御: 2, 攻击: 3, 经验: 50, 装备品质: "common", 装备: [], 技能: ["撕咬v1级"], 光环: null, desc: "瘟疫中最早堕化的游魂，衣衫褴褛，只凭本能扑咬活物。" },
    { 等级: 2, 名称: "饥饿恶鬼", 类型: "普通", 势力: "无", 兵种评级: 0, 生命: 25, 气力: 4, 力量: 15, 敏捷: 10, 防御: 4, 攻击: 5, 经验: 100, 装备品质: "common", 装备: [], 技能: ["撕咬v2级", "扑击v1级"], 光环: null, desc: "永远处于饥饿的恶鬼，肠穿肚烂仍不断吞噬，行动比游荡恶鬼更快更狠。" },
    { 等级: 3, 名称: "撕咬恶鬼", 类型: "普通", 势力: "无", 兵种评级: 0, 生命: 40, 气力: 5, 力量: 20, 敏捷: 13, 防御: 6, 攻击: 8, 经验: 150, 装备品质: "fine", 装备: [], 技能: ["撕咬v3级", "扑击v2级", "嘶吼v1级"], 光环: null, desc: "下颌异化成巨颚的恶鬼，能一口咬碎铁皮。附近常盘踞成群的同类。" },
    { 等级: 4, 名称: "暴戾恶鬼", 类型: "精英", 势力: "无", 兵种评级: 1, 生命: 60, 气力: 6, 力量: 26, 敏捷: 16, 防御: 9, 攻击: 12, 经验: 200, 装备品质: "rare", 装备: [{ name: "锈蚀爪套", attrs: { 攻击: 4 } }], 技能: ["撕裂v2级", "狂暴v1级"], 光环: null, desc: "在血泊中泡大的精英恶鬼，体格远超同类，爪上缠着锈蚀的铁爪。" },
    { 等级: 5, 名称: "恶鬼统领", 类型: "首领", 势力: "无", 兵种评级: 2, 生命: 90, 气力: 8, 力量: 34, 敏捷: 20, 防御: 12, 攻击: 16, 经验: 250, 装备品质: "epic", 装备: [{ name: "黑铁残刀", attrs: { 攻击: 8, 力量: 4 } }], 技能: ["撕裂v3级", "狂暴v2级", "统御号令v1级"], 光环: null, desc: "统领成片恶鬼的王者，懂得指挥与伏击，是猎奴们闻之色变的存在。" },
    /* 模板示例: 带势力 / 光环 / 装备的完整怪物 */
    { 等级: 3, 名称: "黄巾刀盾步兵", 类型: "普通", 势力: "黄巾军", 兵种评级: 1, 生命: 16, 气力: 5, 力量: 22, 敏捷: 12, 防御: 6, 攻击: 3, 经验: 150, 装备品质: "common", 装备: [
        { name: "制式长刀", attrs: { 力量: 4, 敏捷: 1, 防御: 1, 攻击: 3 } },
        { name: "制式木盾", attrs: { 力量: 2, 敏捷: 1, 防御: 5 } }
      ],
      技能: ["劈砍v1级", "格挡v1级"],
      光环: { name: "张天师1级佑护光环", desc: "战力稍有提升", 加成: { 生命: 10, 气力: 1, 力量: 2, 敏捷: 1, 防御: 4, 攻击: 1 } },
      desc: "黄巾军制式步兵，头裹黄巾、手持刀盾。被张天师佑护光环笼罩，战力稍有提升。" }
  ];

  /* ---------- 装备生成模板 (供 LLM / 掉落生成参照) ---------- */
  const EQUIP_TEMPLATE = {
    格式: "装备名，等级X，X品质，背景来历描述。装备要求：基础裸装XX不少于X点，且XX等级必须为X级别，可精炼等级X星，目前精炼等级X星，可镶嵌宝石数量X颗，目前已镶嵌X颗。",
    特性: "装备附加特性一：特性名，效果描述。装备附加特性二：特性名，效果描述。（品质越高特性越多）",
    技能: "装备附加技能：技能名，群攻/单体，需要消耗X点气力值，X点生命值方可释放，效果描述，冷却时间X日。",
    属性: "生命值+X，气力值+X，力量+X，敏捷+X，防御+X，攻击+X，耐久X/X。",
    范例: {
      name: "玄铁撼天弓", 等级: 40, 品质: "epic", icon: "crosshair", slot: "武器",
      背景: "弓身为准传奇战将慕容垂收集极北玄铁，以一滴恶蛟精血淬炼其上，再以名匠耗时三年打造而成，弓弦则为十八条天蚕丝融合精钢软铁所致，有撼天裂地之威，非神力者，不可掌握！",
      需求: { 力量: 250, 敏捷: 150, 弓术: "专精级别" },
      精炼: { 上限: 6, 当前: 4 },
      镶嵌: { 上限: 2, 当前: 2 },
      特性: [
        { name: "破甲", desc: "破甲效果为50%，除非遇到特殊目标，否则必将无视目标对手一半的防御。" },
        { name: "狂风之魂", desc: "可令射出的羽箭速度提升50%，最大射程提升50%，为4000米。" }
      ],
      技能: { name: "暴雨流星箭", type: "群攻", desc: "需要消耗500点气力值，500点生命值，100点弓魂方可释放，对前方五百米内最多可达五百名目标敌人造成恐怖的箭气伤害，平均每秒伤害1000点，持续五秒钟，此技能冷却时间三日。" },
      attrs: { 生命: 2000, 气力: 500, 力量: 500, 敏捷: 200, 防御: 500, 攻击: 1200 },
      durability: 10000, maxDura: 10000, value: 0, bound: true
    }
  };

  window.GAME_DATA = {
    POWER_RANK, IDENTITIES, DIFFICULTIES, TALENTS, TALENT_QUALITY, factionRecruit, LANDS, ITEMS, GEAR_SLOTS, GEAR_GROUPS,
    QUALITY_ORDER, QUALITY_LABEL, QUALITY_COLOR, SKILLS, AURAS, QUESTS, MAP_NODES, NPCS, CHRONICLE_SEED,
    defaultStat, PROLOGUE, OPTION_SET_A, DEMO_RESPONSES,
    EXP, 经验百分比, grantExp, DROPS, DEMONS, EQUIP_TEMPLATE
  };
})();
