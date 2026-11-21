#!/usr/bin/env node
/**
 * 剧本校验器 —— 发布前必须跑通
 *
 *   node tools/validate.mjs            校验全部游戏
 *   node tools/validate.mjs zhiwei     只校验一个
 *
 * 它检查两类问题：
 *   结构类：断线节点、没有兜底的选项、用错的数值名、条件写错
 *   玩法类：穷举所有路径，看每个结局能不能真的走到、每个选项是不是永远点不到
 *
 * 退出码：0 = 通过，1 = 有错误
 */
import { listGames, loadGame, enumeratePaths, MAX_PATHS } from './lib.mjs';

const C = {
  ok: s => `\x1b[32m${s}\x1b[0m`,
  bad: s => `\x1b[31m${s}\x1b[0m`,
  warn: s => `\x1b[33m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

const RESERVED = new Set([
  'has', 'true', 'false', 'null', 'undefined', 'typeof', 'new', 'void',
  'in', 'of', 'this', 'NaN', 'Infinity',
]);

function idTokens(expr) {
  const bare = String(expr)
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '``');
  return (bare.match(/[A-Za-z_$\u4e00-\u9fa5][A-Za-z0-9_$\u4e00-\u9fa5]*/g) || [])
    .filter(t => !RESERVED.has(t));
}

function validateGame(id) {
  const errors = [];
  const warns = [];
  let story;
  try {
    story = loadGame(id);
  } catch (e) {
    return { id, errors: [e.message], warns, stats: null };
  }

  const nodes = story.nodes;
  const statKeys = (story.stats || []).map(s => s.key);
  const nodeIds = Object.keys(nodes);

  // ---------- 基本字段 ----------
  if (!story.meta || !story.meta.title) errors.push('meta.title 缺失');
  if (!Array.isArray(story.stats) || !story.stats.length) errors.push('stats 缺失或为空');
  for (const s of story.stats || []) {
    if (typeof s.init !== 'number') errors.push(`数值「${s.key}」缺少 init`);
    if (typeof s.min !== 'number' || typeof s.max !== 'number') errors.push(`数值「${s.key}」缺少 min/max`);
    if (s.max <= s.min) errors.push(`数值「${s.key}」的 max 必须大于 min`);
    if (typeof s.init === 'number' && (s.init < s.min || s.init > s.max))
      errors.push(`数值「${s.key}」的 init 超出 [min, max]`);
  }
  if (!nodes[story.start]) errors.push(`start 指向不存在的节点：${story.start}`);

  // ---------- 逐节点 ----------
  const outTargets = new Map();
  for (const [nid, n] of Object.entries(nodes)) {
    const outs = [];
    if (n.next) outs.push(n.next);
    (n.choices || []).forEach(c => outs.push(c.next));
    outTargets.set(nid, outs);
    for (const t of outs) {
      if (t == null) errors.push(`「${nid}」有选项没写 next`);
      else if (!nodes[t]) errors.push(`「${nid}」指向不存在的节点「${t}」`);
    }

    if (n.ending) {
      if (n.choices || n.next) warns.push(`「${nid}」是结局节点，同时写了出口，出口会被忽略`);
      if (!n.ending.title) errors.push(`结局「${nid}」缺少 title`);
    } else {
      if (!n.text) errors.push(`「${nid}」没有正文 text`);
      if (!n.next && !(n.choices || []).length) errors.push(`「${nid}」没有出口（next / choices / ending 都没有）`);
      if ((n.choices || []).length && !n.choices.some(c => !c.require))
        errors.push(`「${nid}」所有选项都带条件，玩家可能卡死——必须留一条无条件选项`);
      if ((n.choices || []).length > 6) warns.push(`「${nid}」有 ${n.choices.length} 个选项，手机上可能一屏放不下`);
    }

    // effect 里的数值名
    const checkEff = (eff, where) => {
      if (!eff) return;
      for (const k of Object.keys(eff)) {
        if (k === 'flags') {
          if (!Array.isArray(eff.flags)) errors.push(`${where} 的 flags 应该是数组`);
          continue;
        }
        if (typeof eff[k] === 'number') {
          if (!statKeys.includes(k)) errors.push(`${where} 用了未定义的数值「${k}」`);
        } else if (typeof eff[k] !== 'boolean') {
          errors.push(`${where} 的「${k}」既不是数字也不是布尔值`);
        }
      }
    };
    checkEff(n.effect, `「${nid}」effect`);
    (n.choices || []).forEach((c, i) => {
      if (!c.text) errors.push(`「${nid}」第 ${i + 1} 个选项缺少 text`);
      checkEff(c.effect, `「${nid}」第 ${i + 1} 个选项的 effect`);
      if (c.require) {
        try {
          new Function('has', ...statKeys, 'return (' + c.require + ')');
        } catch (e) {
          errors.push(`「${nid}」第 ${i + 1} 个选项的 require 语法错误：${c.require}`);
        }
        for (const t of idTokens(c.require)) {
          if (!statKeys.includes(t)) errors.push(`「${nid}」第 ${i + 1} 个选项的 require 引用了不存在的名字「${t}」`);
        }
      }
    });
  }

  // ---------- 连通性 ----------
  const seen = new Set();
  const stack = [story.start];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur) || !nodes[cur]) continue;
    seen.add(cur);
    (outTargets.get(cur) || []).forEach(t => stack.push(t));
  }
  const orphans = nodeIds.filter(n => !seen.has(n));
  if (orphans.length) errors.push(`这些节点走不到：${orphans.join(', ')}`);

  // ---------- 路径穷举 ----------
  const { results, usedChoices, cycles, truncated } = enumeratePaths(story);

  if (cycles.length) {
    const uniq = [...new Set(cycles)];
    errors.push(`检测到环（引擎不支持循环）：${uniq[0]}`);
  }
  if (truncated) warns.push(`通关路径超过 ${MAX_PATHS} 条，只枚举了前面一部分，结论可能不完整`);

  const endings = Object.entries(nodes).filter(([, n]) => n.ending);
  const hit = new Map();
  for (const r of results) hit.set(r.end, (hit.get(r.end) || 0) + 1);

  if (!results.length) {
    errors.push('没有任何一条路径能走到结局——检查最后的选项条件是不是全都满足不了');
  }
  for (const [nid, n] of endings) {
    const title = n.ending.title || nid;
    if (!seen.has(nid)) errors.push(`结局「${title}」是不可达节点（没有任何 next 指向它）`);
    else if (!hit.get(title)) errors.push(`结局「${title}」的条件永远满足不了——数值涨不到，或者需要的标记拿不到`);
  }

  // 永远点不到的选项
  for (const [nid, n] of Object.entries(nodes)) {
    (n.choices || []).forEach((c, i) => {
      if (!c.require) return;
      if ((usedChoices.get(`${nid}#${i}`) || 0) === 0) {
        warns.push(`选项永远点不到：「${nid}」第 ${i + 1} 个（条件 ${c.require}）`);
      }
    });
  }

  // ---------- 数值范围 ----------
  const ranges = {};
  if (results.length) {
    for (const k of statKeys) {
      const vals = results.map(r => r.stats[k]);
      ranges[k] = [Math.min(...vals), Math.max(...vals)];
    }
  }

  return { id, title: story.meta.title, errors, warns, stats: { nodes: nodeIds.length, endings, hit, results, ranges, truncated } };
}

// ------------------------------ 输出 ------------------------------
const args = process.argv.slice(2);
const targets = args.length ? args : listGames();

if (!targets.length) {
  console.log(C.bad('games/ 下面没有任何游戏'));
  process.exit(1);
}

let failed = 0;
for (const id of targets) {
  const r = validateGame(id);
  const head = `${C.bold('▶ ' + id)}${r.title ? '  ' + r.title : ''}`;
  console.log('\n' + head);

  const s = r.stats;
  if (s) {
    console.log(C.ok(`  ✓ 结构  `) + C.dim(`${s.nodes} 个节点 / ${s.endings.length} 个结局`));
    const reach = s.truncated ? '（截断）' : '';
    console.log(C.ok(`  ✓ 路径  `) + C.dim(`${s.results.length} 条通关路径${reach}`));
    const list = s.endings
      .map(([, n]) => `${n.ending.title}(${s.hit.get(n.ending.title) || 0})`)
      .join('  ');
    console.log(C.ok(`  ✓ 结局  `) + C.dim(list));
    const rng = Object.entries(s.ranges).map(([k, v]) => `${k} ${v[0]}~${v[1]}`).join('  ');
    if (rng) console.log(C.ok(`  ✓ 数值  `) + C.dim(rng));
  }

  for (const e of r.errors) console.log(C.bad('  ✗ ' + e));
  for (const w of r.warns) console.log(C.warn('  ! ' + w));

  if (r.errors.length) failed++;
  else console.log(C.ok('  → 通过'));
}

console.log(
  '\n' + (failed
    ? C.bad(`${failed} / ${targets.length} 个游戏有错误`)
    : C.ok(`全部通过（${targets.length} 个游戏）`))
);
process.exit(failed ? 1 : 0);
