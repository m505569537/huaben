/**
 * 工具链公用：定位游戏、沙箱加载剧本、枚举路径
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

/**
 * 穷举所有通关路径：一边走一边结算数值和标记，用来判断
 * 「这个结局到底够不够得着」「这个选项是不是永远点不到」
 */
export function enumeratePaths(story) {
  const statKeys = story.stats.map(s => s.key);
  const initStats = Object.fromEntries(story.stats.map(s => [s.key, s.init]));

  const results = [];
  const reached = new Set();
  const usedChoices = new Map();
  const cycles = [];
  let truncated = false;

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

  function walk(id, stats, flags, onPath, depth) {
    if (results.length >= MAX_PATHS) { truncated = true; return; }
    const n = story.nodes[id];
    if (!n || depth > 500) return;
    if (onPath.has(id)) { cycles.push([...onPath, id].join(' → ')); return; }

    reached.add(id);
    stats = { ...stats };
    flags = { ...flags };
    apply(n.effect, stats, flags);

    const nextPath = new Set(onPath);
    nextPath.add(id);

    if (n.ending) {
      results.push({ end: n.ending.title || id, stats, flags, depth });
      return;
    }

    let list = n.choices;
    if (!list && n.next) list = [{ text: '（继续）', next: n.next }];
    if (!list) return;

    list.forEach((c, i) => {
      if (!evalCond(c.require, stats, flags)) return;
      usedChoices.set(`${id}#${i}`, (usedChoices.get(`${id}#${i}`) || 0) + 1);
      const s2 = { ...stats }, f2 = { ...flags };
      apply(c.effect, s2, f2);
      walk(c.next, s2, f2, nextPath, depth + 1);
    });
  }

  walk(story.start, { ...initStats }, {}, new Set(), 0);

  return { results, reached, usedChoices, cycles, truncated, statKeys };
}
