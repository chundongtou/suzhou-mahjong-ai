// ============ 苏州麻将确定性分析引擎 ============
// 牌编码: 万=0-8, 条=9-17, 筒=18-26, 东=27 南=28 西=29 北=30 中=31 发=32 白=33
const MAHJONG = (() => {
  const TILE_IDX = {};
  (() => {
    ["万","条","筒"].forEach((s, si) => {
      for (let n = 1; n <= 9; n++) TILE_IDX[n + s] = si * 9 + n - 1;
    });
    ["东","南","西","北","中","发","白"].forEach((z, i) => TILE_IDX[z] = 27 + i);
  })();
  const TILE_NAME = [];
  (() => {
    for (let i = 0; i < 27; i++) TILE_NAME.push((i%9+1) + ["万","条","筒"][Math.floor(i/9)]);
    ["东","南","西","北","中","发","白"].forEach(z => TILE_NAME.push(z));
  })();
  const nameToIdx = n => TILE_IDX[n];

  // 手牌(数组) -> 计数数组[34]
  function countsFromNames(names) {
    const c = new Array(34).fill(0);
    names.forEach(n => { const i = nameToIdx(n); if (i !== undefined) c[i]++; });
    return c;
  }

  // 判断 [34]计数 是否胡(标准 4面子+1对, 或7对)
  function isHu(counts) {
    const total = counts.reduce((a,b)=>a+b,0);
    if (total % 3 !== 2) return false;
    // 七对
    let pairs = 0, has4 = false;
    for (let i = 0; i < 34; i++) { if (counts[i] === 4) has4 = true; if (counts[i] >= 2) pairs++; }
    if (pairs === 7) return { type: has4 ? "豪华七对" : "七对" };
    // 4面子+1对: 尝试每种将
    for (let j = 0; j < 34; j++) {
      if (counts[j] < 2) continue;
      const c = counts.slice(); c[j] -= 2;
      if (canFormGroups(c)) return { type: isAllTriplets(counts) ? "对对胡" : "平胡" };
    }
    return false;
  }

  // 全刻子(对对胡)
  function isAllTriplets(counts) {
    for (let i = 0; i < 27; i++) if (counts[i] % 3 !== 0 && i % 9 < 9) { /* 顺子消耗后无法区分, 用组合判定 */ }
    // 简化: 拆解时看是否无顺子可行
    return false;
  }

  function canFormGroups(c) {
    // 先处理字牌(只能刻)
    for (let i = 27; i < 34; i++) {
      if (c[i] % 3 !== 0) return false;
    }
    // 万条筒: 回溯, 每色单独处理
    for (let s = 0; s < 3; s++) {
      const arr = c.slice(s*9, s*9+9);
      if (!suitOk(arr)) return false;
    }
    return true;
  }
  function suitOk(a) {
    // 找第一个非零
    let i = a.findIndex(x => x > 0);
    if (i === -1) return true;
    if (a[i] >= 3) { a[i] -= 3; if (suitOk(a)) { a[i] += 3; return true; } a[i] += 3; }
    if (i <= 6 && a[i+1] > 0 && a[i+2] > 0) {
      a[i]--; a[i+1]--; a[i+2]--;
      if (suitOk(a)) { a[i]++; a[i+1]++; a[i+2]++; return true; }
      a[i]++; a[i+1]++; a[i+2]++;
    }
    return false;
  }

  // 听牌检测: 手牌(13/14张)+碰杠面子数 -> {listening, huTiles, xiangTing}
  function analyze(names, meldGroupCount) {
    // meldGroupCount: 已碰杠的面子数(每个碰/杠算1组, 杠算1组但多1张)
    const counts = countsFromNames(names);
    const total = counts.reduce((a,b)=>a+b,0);
    const results = { listening: false, huTiles: [], winType: null, xiangTing: null, counts, total };

    // 试34种牌加入后是否胡
    const need = 3 - (total % 3); // 摸牌后应是 3k+2
    for (let i = 0; i < 34; i++) {
      if (counts[i] >= 4) continue;
      const c = counts.slice(); c[i]++;
      const r = isHu(c);
      if (r) results.huTiles.push(TILE_NAME[i]);
    }
    if (results.huTiles.length) {
      results.listening = true;
      const c2 = counts.slice();
      results.winType = results.huTiles.map(t => isHu(addOne(counts, t))).find(r => r) || null;
      // 试每种可胡牌的类型
      const types = new Set();
      results.huTiles.forEach(t => { const r = isHu(addOne(counts, t)); if (r) types.add(r.type); });
      results.winTypes = [...types];
    } else {
      // 未听牌: 算 1 向听进张(加一张后能听牌的牌)
      const jin = new Set();
      for (let i = 0; i < 34; i++) {
        if (counts[i] >= 4) continue;
        const c = counts.slice(); c[i]++;
        // 检查是否听牌: 对14张, 试打任意一张后是否13张听
        let ting = false;
        for (let d = 0; d < 34 && !ting; d++) {
          if (c[d] === 0) continue;
          const cc = c.slice(); cc[d]--;
          for (let h = 0; h < 34; h++) {
            if (cc[h] >= 4) continue;
            const ccc = cc.slice(); ccc[h]++;
            if (isHu(ccc)) { ting = true; break; }
          }
        }
        if (ting) jin.add(TILE_NAME[i]);
      }
      results.xiangTing = [...jin];
    }
    return results;
  }
  function addOne(counts, name) {
    const c = counts.slice(); c[nameToIdx(name)]++; return c;
  }

  // 搭子拆解(近似): 找对子/两面搭/边搭/嵌搭
  function analyzeStructure(names) {
    const counts = countsFromNames(names);
    const struct = { pairs: [], seqCands: [], tripletCands: [], singles: [] };
    for (let i = 0; i < 34; i++) {
      if (counts[i] >= 2) struct.pairs.push(TILE_NAME[i] + "x" + counts[i]);
      if (counts[i] >= 3) struct.tripletCands.push(TILE_NAME[i]);
      if (counts[i] === 1 && i < 27) {
        const s = Math.floor(i/9), n = i%9;
        const l = [], r = [];
        if (n >= 1 && counts[i-1] > 0) l.push(TILE_NAME[i-1]);
        if (n >= 2 && counts[i-2] > 0 && counts[i-1] === 0) l.push("嵌" + TILE_NAME[i-1]);
        if (n <= 7 && counts[i+1] > 0) r.push(TILE_NAME[i+1]);
        if (n <= 6 && counts[i+2] > 0 && counts[i+1] === 0) r.push("嵌" + TILE_NAME[i+1]);
        if (!l.length && !r.length) struct.singles.push(TILE_NAME[i]);
      } else if (counts[i] === 1 && i >= 27) {
        struct.singles.push(TILE_NAME[i]);
      }
    }
    return struct;
  }

  // 花牌计数: 万条筒1/5/9 + 东南西北
  function countFlowers(names) {
    let cnt = 0;
    const flowerIdx = new Set([0,4,8, 9,13,17, 18,22,26, 27,28,29,30]);
    names.forEach(n => {
      const i = nameToIdx(n);
      if (i !== undefined && flowerIdx.has(i)) cnt++;
    });
    return cnt;
  }

  // 危险牌: 全场已打中未出现过的牌(按危险度排序)
  function dangerTiles(myDiscard, others) {
    const seen = new Set();
    myDiscard.forEach(n => seen.add(n));
    others.forEach(n => seen.add(n));
    const danger = [];
    for (let i = 0; i < 34; i++) {
      if (!seen.has(TILE_NAME[i])) {
        let w = 1;
        if (i >= 27) w = 3;                       // 字牌
        else if (i % 9 === 0 || i % 9 === 8) w = 2; // 边张1/9
        danger.push({ name: TILE_NAME[i], weight: w });
      }
    }
    danger.sort((a,b) => b.weight - a.weight);
    return danger;
  }


  // 14张(摸牌后待打)场景: 分析打出每张候选牌后的情况
  function analyzeDiscardOptions(names) {
    const counts = countsFromNames(names);
    const opts = [];
    for (let i = 0; i < 34; i++) {
      if (!counts[i]) continue;
      const c = counts.slice(); c[i]--;
      const huTiles = [], winTypes = [];
      for (let h = 0; h < 34; h++) {
        if (c[h] >= 4) continue;
        const cc = c.slice(); cc[h]++;
        const r = isHu(cc);
        if (r) { huTiles.push(TILE_NAME[h]); winTypes.push(r.type); }
      }
      let jinCount = 0, jinTiles = [];
      if (!huTiles.length) {
        const s = new Set();
        for (let a = 0; a < 34; a++) {
          if (c[a] >= 4) continue;
          const ca = c.slice(); ca[a]++;
          let ting = false;
          for (let d = 0; d < 34 && !ting; d++) {
            if (!ca[d]) continue;
            const cd = ca.slice(); cd[d]--;
            for (let h = 0; h < 34; h++) {
              if (cd[h] >= 4) continue;
              const ch = cd.slice(); ch[h]++;
              if (isHu(ch)) { ting = true; break; }
            }
          }
          if (ting) { s.add(TILE_NAME[a]); }
        }
        jinTiles = [...s];
        jinCount = s.size;
      }
      // 有用进张: 加一张后搭子/对子/刻子数增加的牌
      const useful = [];
      const baseStruct = analyzeStructure(countsToNames(c));
      const baseScore = baseStruct.pairs.length + baseStruct.tripletCands.length + seqCount(c);
      for (let h = 0; h < 34; h++) {
        if (c[h] >= 4) continue;
        const ch = c.slice(); ch[h]++;
        const st = analyzeStructure(countsToNames(ch));
        const sc = st.pairs.length + st.tripletCands.length + seqCount(ch);
        if (sc > baseScore) useful.push(TILE_NAME[h]);
      }
      const orig = counts[i];
      const keepPenalty = orig >= 3 ? 5 : orig === 2 ? 2 : 0; // 拆刻子/对子代价
      opts.push({ discard: TILE_NAME[i], listening: huTiles.length > 0, huTiles, winTypes, jinCount, jinTiles, usefulTiles: useful, keepPenalty });
    }
    opts.sort((a, b) => {
      if (a.listening !== b.listening) return (b.listening ? 1 : 0) - (a.listening ? 1 : 0);
      if (a.listening) return b.huTiles.length - a.huTiles.length;
      const sa = a.usefulTiles.length + a.jinCount * 2 - a.keepPenalty;
      const sb = b.usefulTiles.length + b.jinCount * 2 - b.keepPenalty;
      return sb - sa;
    });
    return opts;
  }


  function countsToNames(c) {
    const out = [];
    for (let i = 0; i < 34; i++) for (let k = 0; k < c[i]; k++) out.push(TILE_NAME[i]);
    return out;
  }
  // 顺子候选数(近似): 每色统计连续对/搭
  function seqCount(c) {
    let n = 0;
    for (let s = 0; s < 3; s++) {
      const a = c.slice(s*9, s*9+9);
      for (let i = 0; i <= 6; i++) {
        if (a[i] > 0 && a[i+1] > 0) n++;
        if (a[i] > 0 && a[i+2] > 0) n++;
      }
    }
    return n;
  }

  return { analyze, analyzeDiscardOptions, analyzeStructure, countFlowers, dangerTiles, TILE_NAME, nameToIdx, isHu };


})();

if (typeof module !== 'undefined' && module.exports) module.exports = MAHJONG;
