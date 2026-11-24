/**
 * 工具链公用：定位游戏、沙箱加载剧本、遍历剧本
 *
 * 为什么不再「穷举所有通关路径」：
 * 分支一多，路径数就是指数级（《知微》v2 是百万级）。
 * 所以拆成两件事——
 *   countPaths()     数一数有多少条路（到了上限就停，只报「20 万+」）
 *   exploreStates()  按「(节点, 数值, 标记)」去重遍历状态空间。
 *                    路径很多，但不同的状态很少，因此可以精确回答
 *                    「结局够不够得到」「选项点不点得到」「数值范围」。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GAMES_DIR = path.join(ROOT, 'games');

/** 列出所有游戏目录（含 story.js 的） */
export function listGames() {
  if (!fs.existsSync(GAMES_DIR)) return [];
  return fs.readdirSync(GAMES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(GAMES_DIR, d.name, 'story.js')))
    .map(d => d.name)
    .sort();
}

/** 在沙箱里执行 story.js，拿到 STORY 对象 */
export function loadGame(id) {
  const file = path.join(GAMES_DIR, id, 'story.js');
  if (!fs.existsSync(file)) throw new Error(`找不到剧本文件：${path.relative(ROOT, file)}`);
  const ctx = vm.createContext({ console });
  vm.runInContext(
    fs.readFileSync(file, 'utf8') + '\n;globalThis.__STORY__ = STORY;',
    ctx,
    { filename: file }
  );
  const story = ctx.__STORY__;
  if (!story || !story.nodes) throw new Error(`${path.relative(ROOT, file)} 里没有导出合法的 STORY 对象`);
  return story;
}

export const MAX_PATHS = 200000;
export const MAX_STATES = 400000;

/** 把 effect / require 的结算编译成闭包，两种遍历共用同一套语义 */
function compile(story) {
  const statKeys = story.stats.map(s => s.key);
  const initStats = Object.fromEntries(story.stats.map(s => [s.key, s.init]));

  // 只有被 require 引用过的标记才会影响走向；其余标记只是叙事记号，
  // 不参与状态去重，否则状态数会被无意义地撑大几十倍。
  const relevantFlags = new Set();
  for (const n of Object.values(story.nodes)) {
    for (const c of n.choices || []) {
      if (!c.require) continue;
      for (const m of c.require.matchAll(/has\('([^']+)'\)/g)) relevantFlags.add(m[1]);
    }
  }

  function apply(eff, stats, flags) {
    if (!eff) return;
    for (const k of Object.keys(eff)) {
      const v = eff[k];
      if (k === 'flags') { (v || []).forEach(f => { flags[f] = true; }); continue; }
      if (typeof v === 'number') {
        const cfg = story.stats.find(s => s.key === k);
        if (!cfg) continue;
        stats[k] = Math.max(cfg.min, Math.min(cfg.max, (stats[k] ?? cfg.init) + v));
      } else if (typeof v === 'boolean') {
        flags[k] = v;
      }
    }
  }

  function evalCond(expr, stats, flags) {
    if (!expr) return true;
    try {
      const scope = { has: f => !!flags[f] };
      for (const k of statKeys) scope[k] = stats[k];
      return !!new Function(...Object.keys(scope), 'return (' + expr + ')')(...Object.values(scope));
    } catch {
      return true;
    }
  }

  return { statKeys, initStats, apply, evalCond, relevantFlags };
}

/** 数通关路径。到了上限就停，只为了在输出里报个量级。 */
export function countPaths(story, cap = MAX_PATHS) {
  const { initStats, apply, evalCond } = compile(story);
  let count = 0;
  let truncated = false;

  function walk(id, stats, flags, onPath) {
    if (count >= cap) { truncated = true; return; }
    const n = story.nodes[id];
    if (!n) return;
    if (onPath.has(id)) return;
    stats = { ...stats };
    flags = { ...flags };
    apply(n.effect, stats, flags);
    const nextPath = new Set(onPath);
    nextPath.add(id);

    if (n.ending) { count++; return; }

    let list = n.choices;
    if (!list && n.next) list = [{ next: n.next }];
    if (!list) return;

    for (const c of list) {
      if (!evalCond(c.require, stats, flags)) continue;
      const s2 = { ...stats }, f2 = { ...flags };
      apply(c.effect, s2, f2);
      walk(c.next, s2, f2, nextPath);
    }
  }

  walk(story.start, { ...initStats }, {}, new Set());
  return { count, truncated };
}

/**
 * 状态空间遍历：同一条路走两遍只算一次。
 * 返回每个结局的落点数值、点过的选项、可达节点，用来做精确校验。
 */
export function exploreStates(story, cap = MAX_STATES) {
  const { statKeys, initStats, apply, evalCond, relevantFlags } = compile(story);
  const seen = new Set();
  const reached = new Set();
  const usedChoices = new Map();
  const cycles = [];
  const results = [];
  let truncated = false;
  let states = 0;

  function key(id, stats, flags) {
    let s = id + '|';
    for (const k of statKeys) s += stats[k] + ',';
    const on = [];
    for (const f of relevantFlags) if (flags[f]) on.push(f);
    on.sort();
    return s + '|' + on.join(',');
  }

  function walk(id, stats, flags, onPath) {
    if (states >= cap) { truncated = true; return; }
    const n = story.nodes[id];
    if (!n) return;
    if (onPath.has(id)) { cycles.push([...onPath, id].join(' → ')); return; }

    stats = { ...stats };
    flags = { ...flags };
    apply(n.effect, stats, flags);

    const k = key(id, stats, flags);
    if (seen.has(k)) return;
    seen.add(k);
    states++;
    reached.add(id);

    const nextPath = new Set(onPath);
    nextPath.add(id);

    if (n.ending) { results.push({ end: n.ending.title || id, stats }); return; }

    let list = n.choices;
    if (!list && n.next) list = [{ next: n.next }];
    if (!list) return;

    list.forEach((c, i) => {
      if (!evalCond(c.require, stats, flags)) return;
      usedChoices.set(`${id}#${i}`, (usedChoices.get(`${id}#${i}`) || 0) + 1);
      const s2 = { ...stats }, f2 = { ...flags };
      apply(c.effect, s2, f2);
      walk(c.next, s2, f2, nextPath);
    });
  }

  walk(story.start, { ...initStats }, {}, new Set());
  return { results, reached, usedChoices, cycles, truncated, states, statKeys };
}

/**
 * 贪心极值：每个数值各走一遍「一路选最大」和「一路选最小」，
 * 用来补状态空间被截断时的取值范围。带一步前瞻（看下一个节点的 effect）。
 */
export function extremeStats(story) {
  const { statKeys, initStats, apply, evalCond } = compile(story);
  const out = Object.fromEntries(statKeys.map(k => [k, { min: Infinity, max: -Infinity }]));

  function walk(key, dirMax) {
    let stats = { ...initStats };
    let flags = {};
    let id = story.start;
    const onPath = new Set();

    for (let step = 0; step < 500; step++) {
      const n = story.nodes[id];
      if (!n || onPath.has(id)) return;
      onPath.add(id);

      stats = { ...stats };
      flags = { ...flags };
      apply(n.effect, stats, flags);

      if (n.ending) {
        if (stats[key] < out[key].min) out[key].min = stats[key];
        if (stats[key] > out[key].max) out[key].max = stats[key];
        return;
      }

      let list = n.choices;
      if (!list && n.next) list = [{ next: n.next }];
      if (!list) return;

      let best = null, bestScore = null;
      for (const c of list) {
        if (!evalCond(c.require, stats, flags)) continue;
        const nxt = story.nodes[c.next];
        const score =
          ((c.effect && typeof c.effect[key] === 'number') ? c.effect[key] : 0) +
          ((nxt && nxt.effect && typeof nxt.effect[key] === 'number') ? nxt.effect[key] : 0);
        if (bestScore === null || (dirMax ? score > bestScore : score < bestScore)) {
          best = c; bestScore = score;
        }
      }
      if (!best) return;
      const s2 = { ...stats }, f2 = { ...flags };
      apply(best.effect, s2, f2);
      stats = s2; flags = f2;
      id = best.next;
    }
  }

  for (const k of statKeys) {
    walk(k, true);
    walk(k, false);
  }
  return out;
}
