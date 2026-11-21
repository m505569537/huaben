#!/usr/bin/env node
/**
 * 打包器 —— 把引擎 + 剧本压成一个自包含的 HTML
 *
 *   node tools/build.mjs            打包全部游戏
 *   node tools/build.mjs zhiwei     只打一个
 *
 * 产物：
 *   dist/<id>.html    单文件，双击能玩，发给谁都能打开
 *   dist/index.html   游戏列表页（GitHub Pages 的首页）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, GAMES_DIR, listGames, loadGame } from './lib.mjs';

const ENGINE_HTML = path.join(ROOT, 'engine', 'index.html');
const ENGINE_CSS = path.join(ROOT, 'engine', 'engine.css');
const ENGINE_JS = path.join(ROOT, 'engine', 'engine.js');
const DIST = path.join(ROOT, 'dist');

const C = { ok: s => `\x1b[32m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`, bad: s => `\x1b[31m${s}\x1b[0m` };

function read(p, label) {
  if (!fs.existsSync(p)) throw new Error(`缺少 ${label}：${path.relative(ROOT, p)}`);
  return fs.readFileSync(p, 'utf8');
}

/** 内联时如果内容里出现 </script> 会把 HTML 提前截断 */
function guard(code, label) {
  if (/<\/script/i.test(code)) {
    throw new Error(`${label} 里出现了 </script，无法内联到单文件。请改成 <\\/script`);
  }
  return code;
}

function inlineOnce(html, pattern, replacement, label) {
  if (!pattern.test(html)) throw new Error(`engine/index.html 里找不到 ${label} 的占位`);
  return html.replace(pattern, replacement);
}

function buildGame(id, shell, css, engine) {
  const story = read(path.join(GAMES_DIR, id, 'story.js'), `${id}/story.js`);
  const data = loadGame(id);
  const title = (data.meta && data.meta.title) || id;
  const desc = (data.meta && (data.meta.subtitle || data.meta.tagline)) || '文字剧情游戏';

  let html = shell;

  html = inlineOnce(html, /<link rel="stylesheet" href="engine\.css">/, `<style>\n${css}\n</style>`, 'engine.css');
  html = inlineOnce(html, /<script>\s*window\.HUABEN[\s\S]*?<\/script>/, `<script>window.HUABEN = { inline: true, game: ${JSON.stringify(id)} };</script>`, 'HUABEN 配置块');
  html = inlineOnce(
    html,
    /<script src="engine\.js"><\/script>/,
    `<script>\n${guard(story, 'story.js')}\n</script>\n<script>\n${guard(engine, 'engine.js')}\n</script>`,
    'engine.js'
  );

  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
  html = html.replace(
    /<meta name="description"[^>]*>/,
    ''
  ).replace(/<\/title>/, `</title>\n<meta name="description" content="${desc.replace(/"/g, '&quot;')}">`);

  const out = path.join(DIST, `${id}.html`);
  fs.writeFileSync(out, html);
  return { id, title, desc, size: Buffer.byteLength(html), nodes: Object.keys(data.nodes).length,
           endings: Object.values(data.nodes).filter(n => n.ending).length };
}

function buildIndex(games) {
  const rows = games.map(g => `
      <a class="card" href="./${g.id}.html">
        <div class="t">${g.title}</div>
        <div class="d">${g.desc}</div>
        <div class="m">${g.nodes} 个节点 · ${g.endings} 个结局</div>
      </a>`).join('');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#14100e">
<title>话本 · 文字游戏</title>
<style>
  :root{ --ink:#e9dfd0; --dim:#a2957f; --faint:#6d6252; --gold:#d3b073; --red:#c0473a;
         --serif:"Songti SC","Noto Serif SC","Source Han Serif SC",serif; }
  *{ box-sizing:border-box; }
  body{ margin:0; min-height:100vh; padding:56px 22px calc(56px + env(safe-area-inset-bottom));
        background:radial-gradient(120% 75% at 50% -10%, #2b211c 0%, #1a1411 42%, #120e0c 100%);
        color:var(--ink); font-family:var(--serif); -webkit-font-smoothing:antialiased; }
  .wrap{ max-width:560px; margin:0 auto; }
  h1{ margin:0; font-size:26px; font-weight:400; letter-spacing:.36em; text-indent:.36em; text-align:center; }
  .sub{ margin:14px 0 44px; text-align:center; font-size:11.5px; letter-spacing:.26em; color:var(--faint); }
  .card{ display:block; padding:20px 22px; margin-bottom:12px; text-decoration:none; color:inherit;
         border:1px solid rgba(211,176,115,.16); border-radius:3px; background:rgba(255,255,255,.018);
         transition:border-color .18s, background .18s; }
  .card:hover{ border-color:rgba(211,176,115,.5); background:rgba(211,176,115,.055); }
  .card .t{ font-size:19px; letter-spacing:.14em; color:#f1e6d4; }
  .card .d{ margin-top:9px; font-size:12.5px; line-height:1.8; color:var(--dim); }
  .card .m{ margin-top:11px; font-size:10.5px; letter-spacing:.16em; color:var(--faint); }
  .foot{ margin-top:40px; text-align:center; font-size:10.5px; letter-spacing:.14em; color:var(--faint); }
  .foot a{ color:var(--faint); }
</style>
</head>
<body>
  <div class="wrap">
    <h1>话 本</h1>
    <p class="sub">文 字 剧 情 游 戏</p>
${rows}
    <p class="foot">由 话本引擎 构建</p>
  </div>
</body>
</html>`;
  fs.writeFileSync(path.join(DIST, 'index.html'), html);
}

// ------------------------------ main ------------------------------
const args = process.argv.slice(2);
const ids = args.length ? args : listGames();

try {
  fs.mkdirSync(DIST, { recursive: true });
  const shell = read(ENGINE_HTML, 'engine/index.html');
  const css = read(ENGINE_CSS, 'engine/engine.css');
  const engine = read(ENGINE_JS, 'engine/engine.js');

  const built = [];
  for (const id of ids) {
    const g = buildGame(id, shell, css, engine);
    built.push(g);
    console.log(C.ok('✓') + ` ${g.id}.html  ${C.dim(g.title + ' · ' + (g.size / 1024).toFixed(1) + ' KB')}`);
  }
  if (!args.length) {
    buildIndex(built);
    console.log(C.ok('✓') + ` index.html  ${C.dim('游戏列表页')}`);
  }
  console.log(`\n输出目录 ${C.dim('dist/')}`);
} catch (e) {
  console.error(C.bad('✗ ' + e.message));
  process.exit(1);
}
