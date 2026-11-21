#!/usr/bin/env node
/**
 * 新建一个游戏
 *
 *   npm run new -- my-game
 *   npm run new -- my-game "我的游戏名"
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, GAMES_DIR } from './lib.mjs';

const C = { ok: s => `\x1b[32m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`, bad: s => `\x1b[31m${s}\x1b[0m` };

const id = process.argv[2];
const title = process.argv[3];

if (!id) {
  console.error(C.bad('用法：npm run new -- <游戏id> ["游戏名"]'));
  console.error(C.dim('  id 只能用小写字母、数字、连字符，例如：my-story'));
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
  console.error(C.bad(`游戏 id「${id}」不合法，只能用小写字母、数字和连字符`));
  process.exit(1);
}

const dst = path.join(GAMES_DIR, id);
if (fs.existsSync(dst)) {
  console.error(C.bad(`games/${id} 已经存在了`));
  process.exit(1);
}

const tpl = fs.readFileSync(path.join(ROOT, 'templates', 'new-game', 'story.js'), 'utf8');
const story = title
  ? tpl.replace(`title: '未命名',`, `title: '${title.replace(/'/g, "\\'")}',`)
  : tpl;

fs.mkdirSync(dst, { recursive: true });
fs.writeFileSync(path.join(dst, 'story.js'), story);

console.log(C.ok('✓') + ` 已创建 games/${id}/story.js`);
console.log('');
console.log('下一步：');
console.log(C.dim(`  1. 编辑 games/${id}/story.js`));
console.log(C.dim(`  2. ./serve.sh ${id}`));
console.log(C.dim(`  3. npm run validate`));
