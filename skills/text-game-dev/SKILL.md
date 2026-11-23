---
name: text-game-dev
description: Use when building, extending, balancing, debugging, or publishing a Chinese text-based narrative game (文字剧情游戏 / 文字养成 / 宫斗 / 乙女向 / 多结局分支剧情) with the huaben engine. Covers writing story.js, adding games, tuning stat caps and ending thresholds so endings stay reachable, validating story graphs, and shipping single-file HTML to Vercel. Triggers on 文字游戏, 剧情游戏, 分支剧情, 多结局, 文字养成, 话本, huaben.
metadata:
  version: "1.0.0"
  date: "2026-11-21"
---

# 文字剧情游戏开发

用 huaben 引擎做中文分支剧情游戏。引擎零依赖、纯前端、可打包成单文件发布。

**项目位置**：`/Users/eeexu/Developer/huaben`（在线版 https://huaben.vercel.app）

开始时先在项目根目录确认结构：

```bash
cd /Users/eeexu/Developer/huaben && ls && node tools/validate.mjs
```

如果目录不存在，说明本项目未就位，先向用户确认。

---

## 项目结构与命令

```
engine/            引擎（HTML 外壳 / CSS / JS），一般不动
games/<id>/story.js  一个游戏 = 一个文件夹，剧本只改这里
tools/validate.mjs 剧本校验器
tools/build.mjs    单文件打包器
docs/              格式 / 数值 / 存档 / 部署文档
```

| 命令 | 作用 |
|---|---|
| `./serve.sh <id>` | 起本地服务并打开游戏（**存档必须走 http**） |
| `npm run new -- <id> "名字"` | 从模板新建游戏 |
| `npm run validate` | 校验全部剧本 |
| `npm run build` | 打包到 `dist/<id>.html` 与 `dist/index.html` |
| `npm run check` | 校验 + 打包（发版前必跑） |

---

## 写剧本的硬性规则

完整格式见 `docs/story-format.md`。以下是会导致返工的几条：

1. **每个决策节点必须留一条不带 `require` 的选项**。全锁死 = 玩家卡死，校验器直接报错。
2. **节点正文 120～220 字**。超过 250 字手机上要滚动，节奏散掉。
3. **单节点 2～4 个选项**。超过 6 个决策疲劳。
4. **`stats[].max` 要按真实可达上限设，不是按 100 设**。否则进度条永远只填一小截，玩家以为系统坏了。
5. **条件不满足的选项要显示并置灰 + `hint`**（如 `需 声望 26`），不要隐藏。看见错过什么才能勾起重玩。
6. 正文里不要写 HTML（会被转义）；真需要 `</script` 字面量要写成 `<\/script`，否则单文件打包失败。

---

## 数值与结局阈值：必须"量"而不是"拍"

**这是本项目最容易翻车的地方。** 三类真实事故：

### 事故 A：阈值拍高了，结局够不着

第一版写 `圣宠>=55 && 心计>=55`，但全流程最高只能到 `圣宠 20 / 心计 35`。
结果 432 条路径**全部**只能走兜底结局，三个精心设计的分支等于不存在。

### 事故 B：max 设 100 但只能涨到 40

进度条永远只填 20%，观感像坏了。

### 事故 C：互斥资源陷阱（最隐蔽）

出宫结局要求 `has('玉佩') && 银两>=250`，但剧情里玉佩和银两是**二选一**给的。
数学上永远不可能达成。人眼极难发现，穷举一跑就现形。

### 正确流程

```
写完剧情骨架（数值先随便给）
  → npm run validate
  → 看输出里的「数值 A~B」真实范围
  → 用 B 定 max，用 A~B 区间定结局阈值
  → 再跑一遍，确认每个结局路径数 > 0
  → 微调阈值，重复
```

**一分钟一轮**的循环。

---

## 读校验器输出

```
▶ zhiwei  知微
  ✓ 结构  29 个节点 / 4 个结局
  ✓ 路径  672 条通关路径
  ✓ 结局  凤仪天下(40)  长乐无极(92)  雪夜出宫(108)  冷宫(432)
  ✓ 数值  圣宠 4~20  心计 15~35  声望 0~40  银两 130~260
  → 通过
```

| 输出 | 含义 |
|---|---|
| 结局 `xxx(0)` | **该结局永远不可达**，必须修 |
| 数值 `A~B` | 用 B 定 `max` |
| `! 选项永远点不到` | 设计的选项在全部路径里都点不亮 |
| `✗ 全部选项都带条件` | 会卡死玩家 |

**发版前必须全绿，不能有 `✗`。**

---

## 存档与发布

**存档纯前端**：`localStorage` + 存档码，无后端。

- 键名 `huaben.save.<gameId>` / `huaben.ends.<gameId>`
- **`file://` 下多数浏览器不存**（Arc/Safari 尤其严格）→ 本地测试必须 `./serve.sh`
- 存储被禁时封面会出红条，「存档码」始终可用
- **完全不防作弊**：存档码是明文 base64，改数值即可跳结局。要防盗必须上后端

详见 `docs/save-system.md`。

发布：两条线路都已配好，`git push` 到 main 自动重建。构建命令 `node tools/build.mjs`，输出 `dist`。

- **主线路** GitHub Pages `https://m505569537.github.io/huaben/` —— 国内可直连，但要求仓库公开
- **备用** Vercel `https://huaben.vercel.app` —— `vercel.app` 国内被墙，需梯子

⚠️ Pages 不支持 `cleanUrls`，站内链接要写 `./<id>.html`，不要写 `/zhiwei`。
⚠️ 仓库公开意味着 `games/` 剧本可被 clone，内容保护见 `docs/deployment.md`。

---

## 排错速查

| 症状 | 原因 / 解法 |
|---|---|
| 刷新后进度没了 | 用 `file://` 打开的。改 `./serve.sh`，或部署到 https |
| 点选项没反应 | `next` 指向不存在的 id，跑校验器 |
| 玩到一半卡死 | 该节点所有选项都带 `require`，加一条兜底 |
| 结局拿不到 | 阈值高于可达上限，或所需标记与数值互斥 |
| 进度条几乎不动 | `stats[].max` 设太大 |
| 打的包双击白屏 | 正文里出现了 `</script`，改写成 `<\/script` |
| Vercel 部署 Blocked | 提交邮箱匹配不到 GitHub 账号，改用 `<id>+<login>@users.noreply.github.com` |
| GitHub Pages 422 | 免费账号不支持私有仓库 Pages，改用 Vercel |
| `curl` 线上返回 000 | 沙箱网络限制，不是站点挂了，用浏览器验证 |

---

## 验收方式

改完必须**在浏览器里实机点一遍**，不要只看代码：

1. 起服务，点开封面 → 开始
2. 走到任一结局，确认结局卡正常
3. **刷新一次**，点「继续上次」，确认正文一致
4. 通关后确认「已解锁结局 N / 4」计数增加

移动端用 390×844 视口验证；360×640 也要能放得下。
