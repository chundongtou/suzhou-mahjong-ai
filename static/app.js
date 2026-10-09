// ============ 苏州麻将AI军师 - 前端逻辑 ============
const TILE_DEFS = [
  ...["1","2","3","4","5","6","7","8","9"].map(n => ({n, s:"万", cls:"wan"})),
  ...["1","2","3","4","5","6","7","8","9"].map(n => ({n, s:"条", cls:"tiao"})),
  ...["1","2","3","4","5","6","7","8","9"].map(n => ({n, s:"筒", cls:"tong"})),
  ...[["东","zi"],["南","zi"],["西","zi"],["北","zi"],["中","zi"],["发","zi"],["白","zi"]].map(([n,cls]) => ({n, s:"", cls})),
  {n:"花", s:"", cls:"hua"}, {n:"百搭", s:"", cls:"hua"},
];
const tileName = t => t.n + (t.s || "");
const isHuaBaiDa = t => t.n === "花" || t.n === "百搭";

// ============ 状态 ============
const state = {
  hand: [],                    // 我方手牌 [{n,s,cls}]
  discards: {self:[], up:[], opp:[], down:[]},
  melds:   {self:[], up:[], opp:[], down:[]},   // 碰杠(牌名数组, 3张=碰,4张=杠)
  flowers: {self:[], up:[], opp:[], down:[]},   // 花/百搭
};
let currentTarget = "hand";    // hand | self | up | opp | down
let currentMeldTarget = "meld-self";
let shotImageB64 = null;

// ============ 双模 API ============
const isLocal = !!(location.port && ["127.0.0.1","localhost"].includes(location.hostname)) ||
                (location.hostname.startsWith("192.168.")) || (location.hostname.startsWith("10.")) || (location.hostname.startsWith("172."));
const OLLAMA_URL = "http://127.0.0.1:11434";

async function callOllama(payload) {
  if (isLocal) {
    const r = await fetch("/api/generate", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "请求失败");
    return d.text;
  } else {
    // Pages 模式直连本地 Ollama (需 Ollama 默认 CORS 允许)
    const r = await fetch(OLLAMA_URL + "/api/generate", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({...payload, stream:false}),
    });
    if (!r.ok) throw new Error("Ollama 直连失败(HTTP " + r.status + ")");
    const d = await r.json();
    return d.response || "";
  }
}

async function fetchModels() {
  try {
    let data;
    if (isLocal) {
      const r = await fetch("/api/health");
      data = await r.json();
      if (!data.ok) throw new Error(data.error);
    } else {
      const r = await fetch(OLLAMA_URL + "/api/tags");
      if (!r.ok) throw new Error("HTTP " + r.status);
      data = {ok:true, models:(await r.json()).models.map(m=>m.name)};
    }
    renderModels(data.models);
    setOllamaStatus(true);
  } catch(e) {
    setOllamaStatus(false, e.message);
  }
}

function renderModels(models) {
  const mText = document.getElementById("modelText");
  const mVision = document.getElementById("modelVision");
  const savedText = localStorage.getItem("mj_model_text");
  const savedVision = localStorage.getItem("mj_model_vision");
  const vlModels = models.filter(m => /vl|vision|llava|minicpm/i.test(m));
  const textModels = models.length ? models : ["qwen2.5vl:7b"];
  mText.innerHTML = textModels.map(m => `<option ${m===savedText?"selected":""}>${m}</option>`).join("");
  mVision.innerHTML = (vlModels.length ? vlModels : models).map(m => `<option ${m===savedVision?"selected":""}>${m}</option>`).join("");
}

function setOllamaStatus(on, msg) {
  const dot = document.getElementById("ollamaDot");
  const txt = document.getElementById("ollamaText");
  dot.className = "dot " + (on ? "on" : "off");
  txt.textContent = on ? "Ollama 已连接 ✓" : ("Ollama 未连接: " + (msg||""));
}

// ============ 选择器渲染 ============
function renderPicker() {
  const box = document.getElementById("tilePicker");
  box.innerHTML = "";
  TILE_DEFS.forEach(t => {
    const el = document.createElement("div");
    el.className = "tile " + t.cls + (isHuaBaiDa(t) ? " small" : "");
    el.innerHTML = isHuaBaiDa(t) ? t.n : `<span class="tnum">${t.n}${t.s}</span>${t.n}`;
    el.title = tileName(t);
    el.onclick = () => addTile(t);
    box.appendChild(el);
  });
}

function addTile(t) {
  if (currentTarget === "hand") {
    if (state.hand.length >= 14) { toast("手牌最多14张"); return; }
    state.hand.push(t);
  } else if (currentTarget.startsWith("meld-")) {
    if (isHuaBaiDa(t)) { toast("花/百搭请用「我的花」目标"); return; }
    const key = currentTarget.replace("meld-", "");
    const name = tileName(t);
    const arr = state.melds[key];
    const cnt = arr.filter(x => x === name).length;
    if (cnt === 3) { arr.push(name); }          // 碰→杠
    else if (cnt === 0) { arr.push(name,name,name); } // 新碰
    else { toast("该碰杠已存在"); return; }
  } else if (currentTarget === "flower-self") {
    state.flowers.self.push(t);
  } else {
    state.discards[currentTarget].push(t);
  }
  saveState();
  renderAll();
}

function removeFrom(zone, idx) {
  const arr = zone === "hand" ? state.hand
    : zone.startsWith("meld-") ? state.melds[zone.replace("meld-","")]
    : zone === "flower-self" ? state.flowers.self
    : state.discards[zone];
  if (arr) arr.splice(idx, 1);
  saveState();
  renderAll();
}

// ============ 渲染 ============
function tileHTML(t, zone, idx, size) {
  return `<div class="tile ${t.cls} ${size||''}" title="点击移除" onclick="removeFrom('${zone}',${idx})">
    ${isHuaBaiDa(t) ? t.n : `<span class="tnum">${t.n}${t.s}</span>${t.n}`}</div>`;
}

function meldHTML(arr, zone) {
  if (!arr || !arr.length) return "";
  const groups = {};
  arr.forEach(n => groups[n] = (groups[n]||0) + 1);
  return Object.entries(groups).map(([n,c]) => {
    const kind = c >= 4 ? "杠" : "碰";
    return `<span class="meld-tile" title="点击移除" onclick="removeMeldGroup('${zone}','${n}')">${kind} ${n}</span>`;
  }).join("");
}

function removeMeldGroup(zone, name) {
  state.melds[zone] = state.melds[zone].filter(x => x !== name);
  saveState(); renderAll();
}

function renderDiscardZone(zone) {
  const el = document.querySelector(`[data-discard="${zone}"]`);
  el.innerHTML = state.discards[zone].map((t,i) => tileHTML(t, zone, i, "small")).join("");
  const meldEl = document.querySelector(`[data-meld="${zone}"]`);
  meldEl.innerHTML = meldHTML(state.melds[zone], zone) + state.flowers[zone].map((t,i)=>`<span class="meld-tile" style="background:#4a3b1a" onclick="removeFlower('${zone}',${i})">${t.n==='花'?'花':'百搭'}</span>`).join("");
}

function removeFlower(zone, idx) {
  state.flowers[zone].splice(idx,1); saveState(); renderAll();
}

function renderAll() {
  renderDiscardZone("up");
  renderDiscardZone("opp");
  renderDiscardZone("down");
  renderDiscardZone("self");
  const handEl = document.getElementById("handCards");
  handEl.innerHTML = state.hand.length ? state.hand.map((t,i)=>tileHTML(t,"hand",i)).join("") : '<span class="hint">点下方牌面加入手牌</span>';
  document.getElementById("handCount").textContent = state.hand.length + "/14";
}

function switchTarget(zone) {
  currentTarget = zone;
  document.querySelectorAll(".tbtn:not(.meld)").forEach(b => b.classList.toggle("active", b.dataset.target === zone));
  const labels = {hand:"手牌", self:"我已打", up:"上家已打", opp:"对家已打", down:"下家已打",
    "meld-self":"我的碰杠", "meld-up":"上家碰杠", "meld-opp":"对家碰杠", "meld-down":"下家碰杠", "flower-self":"我的花"};
  document.getElementById("targetLabel").textContent = labels[zone] || zone;
}

// ============ 规则面板 ============
const RULE_OPTS = ["滴零","连庄不占局数","送杠包三家","抢杠胡包三家","小胡3花可抢杠","门清不能杠爆","硬自摸","豪七","四喜翻倍","可胡七对"];
function renderRuleOpts() {
  const box = document.getElementById("ruleOpts");
  box.innerHTML = RULE_OPTS.map(o => `<label><input type="checkbox" data-opt="${o}"> ${o}</label>`).join("");
  // 恢复
  const saved = JSON.parse(localStorage.getItem("mj_rules") || "{}");
  if (saved.opts) saved.opts.forEach(o => {
    const cb = box.querySelector(`[data-opt="${o}"]`);
    if (cb) cb.checked = true;
  });
}

function collectRules() {
  const opts = [...document.querySelectorAll("#ruleOpts input:checked")].map(i => i.dataset.opt);
  return {
    game: document.getElementById("ruleGame").value,
    huFa: document.getElementById("ruleHuFa").value,
    players: document.getElementById("rulePlayers").value,
    banker: document.getElementById("ruleBanker").checked,
    fanPai: document.getElementById("ruleFanPai").value,
    wall: document.getElementById("ruleWall").value,
    opts,
    flowers: {
      self: document.getElementById("flowerSelf").value,
      up: document.getElementById("flowerUp").value,
      opp: document.getElementById("flowerOpp").value,
      down: document.getElementById("flowerDown").value,
    },
    note: document.getElementById("ruleNote").value,
  };
}

function saveState() {
  localStorage.setItem("mj_state", JSON.stringify(state));
  localStorage.setItem("mj_rules", JSON.stringify(collectRules()));
  localStorage.setItem("mj_model_text", document.getElementById("modelText").value);
  localStorage.setItem("mj_model_vision", document.getElementById("modelVision").value);
}

function restoreState() {
  try {
    const s = JSON.parse(localStorage.getItem("mj_state") || "null");
    if (s && s.hand) { Object.assign(state, s); }
    const r = JSON.parse(localStorage.getItem("mj_rules") || "{}");
    if (r.game) document.getElementById("ruleGame").value = r.game;
    if (r.huFa) document.getElementById("ruleHuFa").value = r.huFa;
    if (r.players) document.getElementById("rulePlayers").value = r.players;
    if (r.banker !== undefined) document.getElementById("ruleBanker").checked = r.banker;
    if (r.fanPai) document.getElementById("ruleFanPai").value = r.fanPai;
    if (r.wall !== undefined) document.getElementById("ruleWall").value = r.wall;
    if (r.flowers) Object.entries(r.flowers).forEach(([k,v]) => {
      const el = document.getElementById("flower" + k.charAt(0).toUpperCase() + k.slice(1));
      if (el && v !== undefined && v !== "") el.value = v;
    });
    if (r.note) document.getElementById("ruleNote").value = r.note;
    if (r.opts) [...document.querySelectorAll("#ruleOpts input")].forEach(i => {
      i.checked = r.opts.includes(i.dataset.opt);
    });
  } catch(e) {}
  updateFanPaiVisible();
}

function updateFanPaiVisible() {
  document.getElementById("fanpaiWrap").style.display =
    document.getElementById("ruleGame").value === "2" ? "" : "none";
}

// ============ Prompt 构建 ============
const RULES_PROMPT = `你是专业麻将博弈智能代理，精通苏州麻将。只做麻将推理。硬性纪律：
1. 禁止编造手牌：拆解、推荐打出的每一张牌必须真实存在于当前手牌中；手牌共14张(或13张)，拆解必须覆盖全部手牌、不多不少
2. 只输出下方四个模块，禁止重复牌局输入内容，禁止输出模块之外任何文字
3. 推荐打出的牌 = 手牌中一张具体的牌；理由必须基于拆解与风险分析
4. 【引擎精确分析】一节的数据是权威事实(听牌/进张/胡型已用算法算好)：牌型拆解、是否听牌、进张牌必须照抄引擎结果；"推荐打出"必须从引擎"打出每张牌后的精确分析"列表里选一张，理由中引用该牌对应的引擎数据(如"打X后进张最多/听牌")
5. 别家推测必须基于该家"已打"和"碰杠"信息：某家没有碰杠就写"无"；若某家信息不足, 推测写"信息不足, 难以判断", 禁止编造吃碰记录
6. 高危牌从引擎"全场未出现的牌"列表中挑选, 优先字牌和边张

【苏州麻将规则要点】
- 只能碰、杠，不能吃；基础胡型是"对对胡"(碰碰胡)；七对可胡；顺子平胡分值低
- 牌组：万、条(索)、筒各1-9，东南西北中发白共34种；仅当玩法标注"百搭"时才有万能牌(百搭)
- 字牌(东南西北中发白)不是百搭，普通玩法下就是普通字牌
- 花牌计分：万/条/筒的1、5、9和东南西北都算"花"；底花+5分，每花+1分
- 胡法"X摸Y冲"：自摸每家X倍底分，点炮者Y倍底分
- 番型加分：对对胡+5 清一色+10 混一色+5 七对+10 大吊车+10 杠上开花+5 天胡+50 地胡+28 大门清+10 小门清+5 大小门清+15 海底捞+5 吊百搭+5 无百搭+5 豪华七对x2 超豪华七对x4 超超豪华七对x8
- 翻倍：滴零(必下胡)x2、四喜x2；抢杠胡=抢别人明杠/补杠牌胡
- 危险牌：别家打过的牌相对安全；全场没出现过的字牌、边张1/9更危险；牌墙越少风险越大
- 听牌判断：凑齐4组面子+1对将即听牌(14张含摸牌)；重点盯对对胡/七对听牌

【强制输出格式，不要改标题】
【我方手牌分析】
当前手牌：
牌型拆解：
是否听牌：
我方需要的进张牌：

【别家胡牌推测】
玩家A（上家）：已打XX，吃碰XX，推测可能胡：
玩家B（对家）：已打XX，吃碰XX，推测可能胡：
玩家C（下家）：已打XX，吃碰XX，推测可能胡：
高危牌（尽量不要打）：

【打牌决策】
推荐打出：
理由：
备选可打牌：

【风险总结】
点炮风险高/中/低`;

function formatDiscards(arr) { return arr.map(tileName).join(" ") || "无"; }
function formatMelds(zone) {
  const groups = {};
  state.melds[zone].forEach(n => groups[n] = (groups[n]||0)+1);
  return Object.entries(groups).map(([n,c]) => (c>=4?"杠":"碰")+n).join(" ") || "无";
}

function buildPrompt() {
  const r = collectRules();
  const huFaName = {"1":"1摸2冲","2":"2摸3冲","3":"3摸4冲"}[r.huFa];
  const gameName = r.game === "1" ? "苏州麻将" : "苏州百搭(翻牌"+r.fanPai+"张)";
  const lines = [];
  lines.push(`玩法：${gameName}，${r.players}人，胡法${huFaName}${r.banker?"，我是庄家":""}`);
  if (r.opts.length) lines.push("已开规则：" + r.opts.join("、"));
  if (r.flowers.self !== "0" || r.flowers.up !== "0" || r.flowers.opp !== "0" || r.flowers.down !== "0")
    lines.push(`各家花数：我${r.flowers.self} 上家${r.flowers.up} 对家${r.flowers.opp} 下家${r.flowers.down}`);
  lines.push(`牌墙剩余约${r.wall}张`);
  lines.push("我方手牌：" + (state.hand.map(tileName).join(" ") || "未知"));
  lines.push("我的碰杠：" + formatMelds("self"));
  lines.push("我已打：" + formatDiscards(state.discards.self));
  lines.push("上家已打：" + formatDiscards(state.discards.up) + "；上家碰杠：" + formatMelds("up"));
  lines.push("对家已打：" + formatDiscards(state.discards.opp) + "；对家碰杠：" + formatMelds("opp"));
  lines.push("下家已打：" + formatDiscards(state.discards.down) + "；下家碰杠：" + formatMelds("down"));
  if (state.flowers.self.length) lines.push("我摸到的花/百搭牌：" + state.flowers.self.map(tileName).join(" "));
  if (r.note) lines.push("备注：" + r.note);
  lines.push("请按强制输出格式输出本手决策。");
  return lines.join("\n");
}

// ============ 引擎精确分析 ============
function computeEngineReport() {
  const names = state.hand.map(tileName);
  const report = { names, meldCnt: Math.round(Object.values(state.melds.self).reduce((a,b)=>a+b.length,0) / 3) };
  const st = MAHJONG.analyzeStructure(names);
  report.structure = st;
  report.flowers = MAHJONG.countFlowers(names);
  const others = [...state.discards.up, ...state.discards.opp, ...state.discards.down].map(tileName);
  report.danger = MAHJONG.dangerTiles(state.discards.self.map(tileName), others);
  report.dangerTop = report.danger.slice(0, 12).map(d => d.name);

  if (names.length % 3 === 2) {
    report.mode = "discard";
    report.discardOpts = MAHJONG.analyzeDiscardOptions(names);
    report.best = report.discardOpts[0];
  } else {
    report.mode = "wait";
    report.analysis = MAHJONG.analyze(names, 0);
    report.best = null;
  }
  return report;
}

function renderEngineModules(report) {
  const lines = [];
  lines.push("【我方手牌分析】");
  lines.push("当前手牌：" + report.names.join(" "));
  const st = report.structure;
  lines.push("牌型拆解：对子[" + (st.pairs.join(" ") || "无") + "] 刻子[" + (st.tripletCands.join(" ") || "无") + "] 单张[" + (st.singles.join(" ") || "无") + "]");
  if (report.mode === "discard") {
    lines.push("是否听牌：未听(摸牌后待打状态, 逐张精确分析如下)");
    lines.push("我方需要的进张牌：");
    report.discardOpts.forEach(o => {
      if (o.listening) {
        lines.push("  打" + o.discard + " → 听牌! 胡: " + o.huTiles.join("/") + " (胡型: " + [...new Set(o.winTypes)].join("/") + ")");
      } else {
        const j = o.jinTiles.length ? ", 1向听进张: " + o.jinTiles.join("/") : "";
        lines.push("  打" + o.discard + " → 未听, 有用进张" + o.usefulTiles.length + "种(" + o.usefulTiles.slice(0,6).join("/") + ")" + j);
      }
    });
  } else {
    const a = report.analysis;
    if (a.listening) {
      lines.push("是否听牌：已听牌!");
      lines.push("我方需要的进张牌(胡牌)：" + a.huTiles.join(" ") + " (胡型: " + [...new Set(a.winTypes)].join("/") + ")");
    } else {
      lines.push("是否听牌：未听");
      lines.push("我方需要的进张牌：" + (a.xiangTing.length ? a.xiangTing.join(" ") : "暂无有效1向听进张"));
    }
  }
  lines.push("花数：" + report.flowers + " (花=万条筒1/5/9+东南西北, 底花5+每花1分)");
  return lines.join("\n");
}

function engineReason(opt, report) {
  if (opt.listening) {
    return "打出" + opt.discard + "后立即听牌, 胡牌口" + opt.huTiles.length + "张(" + opt.huTiles.join("/") + "), 是全场最优选择(算法精确计算)";
  }
  const FLOWER_IDX = [0,4,8,9,13,17,18,22,26,27,28,29,30];
  const idx = MAHJONG.nameToIdx(opt.discard);
  const dangerHit = report.dangerTop.includes(opt.discard);
  const flowerLoss = idx !== undefined && FLOWER_IDX.includes(idx);
  let r = "打出" + opt.discard + "后保留有用进张" + opt.usefulTiles.length + "种(" + opt.usefulTiles.slice(0,5).join("/") + "等)";
  if (opt.jinTiles.length) r += ", 含1向听进张(" + opt.jinTiles.join("/") + ")";
  if (dangerHit) r += "; " + opt.discard + "是全场未出现的危险牌, 建议结合下家动态权衡";
  if (flowerLoss) r += "; 注意" + opt.discard + "本身是花牌, 打出会减少花分";
  r += " (算法精确计算)";
  return r;
}

function renderEngineDecision(report) {
  const lines = [];
  lines.push("【打牌决策】");
  if (report.mode === "discard" && report.best) {
    lines.push("推荐打出：" + report.best.discard);
    lines.push("理由：" + engineReason(report.best, report));
    lines.push("备选可打牌：" + report.discardOpts.slice(1).map(o => o.discard).join(" "));
  } else {
    lines.push("推荐打出：等待摸牌(当前手牌" + report.names.length + "张)");
    lines.push("理由：摸牌前状态, 摸到后重新分析");
  }
  return lines.join("\n");
}

function buildLlmPrompt(report) {
  const lines = [];
  lines.push(buildPrompt());
  lines.push("");
  lines.push("【引擎精确分析(权威数据, 禁止反驳或重算)】");
  lines.push(renderEngineModules(report).split("\n").slice(0, 8).join("\n"));
  lines.push("");
  lines.push("【你的任务: 只输出以下两个模块, 禁止其他内容, 禁止重复牌局信息】");
  lines.push("【别家胡牌推测】");
  lines.push("玩家A（上家）：已打XX，吃碰XX，推测可能胡：");
  lines.push("玩家B（对家）：已打XX，吃碰XX，推测可能胡：");
  lines.push("玩家C（下家）：已打XX，吃碰XX，推测可能胡：");
  lines.push("高危牌（尽量不要打）：");
  lines.push("");
  lines.push("【风险总结】");
  lines.push("点炮风险高/中/低 + 一句话说明");
  lines.push("");
  lines.push("要求: 已打/吃碰照抄牌局数据(无碰杠就写无); 高危牌从引擎危险牌列表挑选; 推测基于各家已打牌, 禁止编造");
  return lines.join("\n");
}

// ============ AI 分析(引擎+LLM协作) ============
async function analyze() {
  const btn = document.getElementById("btnAnalyze");
  const resultPanel = document.getElementById("resultPanel");
  const box = document.getElementById("resultBox");
  if (!state.hand.length) { toast("请先输入手牌"); return; }
  btn.disabled = true; btn.textContent = "🤔 推理中... (约30-90秒)";
  resultPanel.style.display = "block";
  resultPanel.scrollIntoView({behavior:"smooth"});

  const report = computeEngineReport();
  const engineText = renderEngineModules(report) + "\n\n" + renderEngineDecision(report);
  const render = () => {
    box.innerHTML = engineText.replace(/\n/g, "<br>")
      .replace(/【(我方手牌分析|打牌决策)】/g, '<span class="mod-title">【$1】</span>');
  };
  render();
  box.innerHTML += "<br><br><span class='mod-title' style='color:#9ad9a9'>⏳ AI 正在补充别家推测与风险分析... (请勿离开)</span>";

  try {
    const text = await callOllama({
      model: document.getElementById("modelText").value || "qwen2.5vl:7b",
      prompt: RULES_PROMPT + "\n\n" + buildLlmPrompt(report),
      options: {temperature: 0.3, num_ctx: 8192},
    });
    let clean = text.replace(/【当前牌局】[\s\S]*$/, "").trim();
    const bidx = clean.indexOf("【别家胡牌推测】");
    if (bidx > 0) clean = clean.slice(bidx);
    render();
    const llmHtml = clean.replace(/\n/g, "<br>").replace(/【(别家胡牌推测|风险总结)】/g, '<span class="mod-title">【$1】</span>');
    box.innerHTML += "<br><br>" + llmHtml;
    document.getElementById("resultTime").textContent = "· " + new Date().toLocaleTimeString();
  } catch(e) {
    render();
    box.innerHTML += "<br><br><span class='mod-title' style='color:#f87171'>⚠️ AI补充失败: " + e.message + "</span><br>(引擎核心分析不受影响, 请检查 Ollama 后重试)";
  } finally {
    btn.disabled = false; btn.textContent = "🧠 AI 分析决策";
  }
}

// ============ 截图识别 ============
function openModal() {
  document.getElementById("shotModal").style.display = "flex";
  document.getElementById("shotPreview").style.display = "none";
  document.getElementById("ocrStatus").textContent = "";
  shotImageB64 = null;
}
function closeModal() { document.getElementById("shotModal").style.display = "none"; }

function setShotImage(b64) {
  shotImageB64 = b64;
  const img = document.getElementById("shotPreview");
  img.src = "data:image/png;base64," + b64;
  img.style.display = "block";
  document.getElementById("ocrStatus").textContent = "图片就绪, 点击「开始识别」";
}

async function runOcr() {
  if (!shotImageB64) { toast("请先粘贴截图或选择图片"); return; }
  const status = document.getElementById("ocrStatus");
  status.textContent = "识别中... (视觉模型约1-3分钟, 请稍候)";
  try {
    const text = await callOllama({
      model: document.getElementById("modelVision").value || "qwen2.5vl:3b",
      prompt: `这是一张麻将游戏截图。请仔细识别牌局信息,只输出一个JSON对象,不要其他文字。
JSON格式(字段均为字符串数组,牌用中文如"5万""3条""9筒""东""中";认不清的不要猜,直接省略):
{"hand":["我方手牌每张一个元素,通常13-14张"],"my_discard":["我方已打的牌"],"up_discard":["上家已打的牌"],"opp_discard":["对家已打的牌"],"down_discard":["下家已打的牌"],"meld":["各家碰杠,如'上家碰5条'"],"flowers":["花牌如'我方花2']"}
只输出JSON。`,
      images: [shotImageB64],
      options: {temperature: 0.1},
    });
    let parsed = null;
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try { parsed = JSON.parse(text.slice(s, e+1)); } catch(err) {}
    }
    if (parsed) {
      applyOcr(parsed);
      status.textContent = "✅ 识别完成, 已自动填入! 请检查手牌是否正确(可点击修改), 再点「AI 分析决策」";
    } else {
      status.textContent = "⚠️ 识别结果解析失败, 原始输出:\n" + text.slice(0, 500);
    }
  } catch(err) {
    status.textContent = "❌ 识别失败: " + err.message;
  }
}

function parseTiles(arr) {
  const map = new Map();
  TILE_DEFS.forEach(t => map.set(tileName(t), t));
  const out = [];
  (arr || []).forEach(s => {
    let x = String(s).trim();
    // 容错: "五万"→"5万", "伍万"→"5万", "8万 " 等
    const cn = {"一":"1","二":"2","三":"3","四":"4","五":"5","六":"6","七":"7","八":"8","九":"9"};
    x = x.replace(/[一二三四五六七八九]/g, c => cn[c] || c);
    x = x.replace("饼","筒").replace("索","条").replace("桶","筒");
    const t = map.get(x);
    if (t) out.push(t);
  });
  return out;
}

function applyOcr(parsed) {
  const hand = parseTiles(parsed.hand);
  if (hand.length) state.hand = hand.slice(0, 14);
  const dm = {"my_discard":"self","up_discard":"up","opp_discard":"opp","down_discard":"down"};
  Object.entries(dm).forEach(([k, zone]) => {
    const arr = parseTiles(parsed[k]);
    if (arr.length) state.discards[zone] = arr.slice(0, 40);
  });
  // 碰杠文本 "上家碰5条" → melds
  (parsed.meld || []).forEach(s => {
    const m = String(s).match(/(上家|对家|下家|我|自己)(碰|杠)(.+)/);
    if (!m) return;
    const zoneMap = {"上家":"up","对家":"opp","下家":"down","我":"self","自己":"self"};
    const zone = zoneMap[m[1]];
    if (!zone) return;
    const t = parseTiles([m[3]])[0];
    if (t) {
      const name = tileName(t);
      const cnt = m[2] === "杠" ? 4 : 3;
      state.melds[zone].push(...Array(cnt).fill(name));
    }
  });
  (parsed.flowers || []).forEach(s => {
    const m = String(s).match(/花\s*(\d+)/);
    if (m) {
      const who = String(s).includes("我") ? "self" : "";
      if (who) document.getElementById("flowerSelf").value = m[1];
    }
  });
  saveState(); renderAll();
}

// ============ 粘贴/文件 ============
function handlePaste(e) {
  const items = (e.clipboardData || window.clipboardData).items;
  if (!items) return;
  for (const it of items) {
    if (it.type.startsWith("image/")) {
      const f = it.getAsFile();
      const rd = new FileReader();
      rd.onload = () => { openModal(); setShotImage(rd.result.split(",")[1]); };
      rd.readAsDataURL(f);
      e.preventDefault();
      break;
    }
  }
}

// ============ 工具 ============
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#d97706;color:#fff;padding:10px 22px;border-radius:10px;font-size:14px;z-index:999;box-shadow:0 4px 12px rgba(0,0,0,.4);transition:opacity .3s";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.opacity = "0", 2200);
}

function togglePanel(id) {
  const el = document.getElementById(id);
  el.style.display = el.style.display === "none" ? "" : "none";
}

function clearAll() {
  Object.assign(state, {hand:[], discards:{self:[],up:[],opp:[],down:[]}, melds:{self:[],up:[],opp:[],down:[]}, flowers:{self:[],up:[],opp:[],down:[]}});
  saveState(); renderAll(); toast("已清空");
}

// ============ 初始化 ============
document.addEventListener("DOMContentLoaded", () => {
  renderRuleOpts();
  renderPicker();
  restoreState();
  renderAll();
  fetchModels();
  updateFanPaiVisible();

  document.querySelectorAll(".tbtn").forEach(b => {
    b.onclick = () => switchTarget(b.dataset.target);
  });
  document.getElementById("ruleGame").onchange = updateFanPaiVisible;
  document.getElementById("btnAnalyze").onclick = analyze;
  document.getElementById("btnClear").onclick = clearAll;
  document.getElementById("btnScreenshot").onclick = openModal;
  document.getElementById("btnCloseModal").onclick = closeModal;
  document.getElementById("btnPickFile").onclick = () => document.getElementById("shotFile").click();
  document.getElementById("shotFile").onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => setShotImage(rd.result.split(",")[1]);
    rd.readAsDataURL(f);
  };
  document.getElementById("btnRunOcr").onclick = runOcr;
  document.getElementById("btnRefreshModels").onclick = fetchModels;
  document.getElementById("btnCopy").onclick = () => {
    const text = document.getElementById("resultBox").innerText;
    navigator.clipboard.writeText(text).then(() => toast("已复制"));
  };
  document.addEventListener("paste", handlePaste);
  // 规则变化自动保存
  ["ruleGame","ruleHuFa","rulePlayers","ruleFanPai","ruleWall","ruleNote","flowerSelf","flowerUp","flowerOpp","flowerDown"].forEach(id => {
    document.getElementById(id).onchange = saveState;
  });
  document.getElementById("ruleBanker").onchange = saveState;
});
