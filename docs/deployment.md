# 部署

本项目是纯静态站点，但**有一个构建步骤**（把多个游戏打包成单文件）。所以托管平台必须支持「构建命令 + 输出目录」这两个配置。

---

## 三种托管方式

| 方式 | 私有仓库 | 国内直连 | 成本 | 现状 |
|---|---|---|---|---|
| **GitHub Pages** | ❌ 必须公开 | ✅ 实测可用 | 免费 | **主线路** |
| Vercel | ✅ 支持 | ❌ 需梯子 | 免费 | 备用线路 |
| Netlify / Cloudflare Pages | ✅ 支持 | ⚠️ 不稳 | 免费 | 未验证 |

> `vercel.app` 域名在国内被 DNS 污染，不挂梯子打不开。
> `*.github.io` 经实测（手机 4G、未挂 VPN）可正常访问，故主线路切到 Pages。

静态托管的通用配置（三家都一样）：

| 项 | 值 |
|---|---|
| 构建命令 | `node tools/build.mjs` |
| 输出目录 | `dist` |
| Node 版本 | 20 |
| 安装命令 | 无需安装（零依赖） |

`vercel.json` 里已经写死了这些，换平台照抄即可。

---

## Vercel 首次部署实录

在线地址：**https://huaben.vercel.app**

### 步骤

1. 打开 https://vercel.com/new
2. 在 **Import Git Repository** 里找到 `huaben` → 点 **Import**
3. 项目名默认 `huaben`，Root Directory 保持 `./`
4. 展开 **Build and Output Settings**，确认三项已从 `vercel.json` 读到：
   - Build Command `node tools/build.mjs`
   - Output Directory `dist`
   - Install Command `echo "no dependencies"`
5. 点 **Deploy**

### 坑 1：要求身份验证

首次部署会弹 **Verify Your Identity**，往注册邮箱发 6 位码。

点 `Send Code` → 去邮箱取码 → 填进 `input[name="digits"]` → 自动提交。

这一步只能人工做，agent 无法代读邮箱。

### 坑 2：首次自动部署被 Blocked

手动导入的那次能成功，但之后 `git push` 触发的部署会失败：

```
Deployment Blocked
The deployment was blocked because the commit email
xuhs0978@fingard.com could not be matched to a GitHub account.
Ensure your git email matches your GitHub account.
```

**原因**：Vercel 要求 Git 提交作者邮箱必须能对应上 GitHub 账号。用公司邮箱提交就会挂。

**解法**：把作者改成 GitHub 的 noreply 地址。

```bash
# 1. 查账号 id 和 login
gh api user --jq '{login, id}'
# {"login":"m505569537","id":30860973}

# 2. 设仓库级 git 身份（noreply 格式：<id>+<login>@users.noreply.github.com）
git config user.name "Xueee"
git config user.email "30860973+m505569537@users.noreply.github.com"

# 3. 重写历史（保留时间和提交信息）
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --env-filter '
export GIT_AUTHOR_NAME="Xueee"
export GIT_AUTHOR_EMAIL="30860973+m505569537@users.noreply.github.com"
export GIT_COMMITTER_NAME="Xueee"
export GIT_COMMITTER_EMAIL="30860973+m505569537@users.noreply.github.com"
' -- --all

# 4. 清理备份引用 + 强推
rm -rf .git/refs/original
git push -f origin main
```

代价：commit SHA 全变。私有单人仓库无所谓。

> 验证成功的标志：部署状态从 `Blocked` 变成 `Ready`，构建约 5 秒。

### 坑 3：Pages 要求仓库公开

```
HTTP 422: Your current plan does not support GitHub Pages for this repository.
```

免费账号的**私有仓库**不支持 Pages。解法是把仓库转公开：

```bash
gh repo edit --visibility public --accept-visibility-change-consequences
# Pages 源设为 GitHub Actions
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

然后让 `pages.yml` 在 push 时触发即可。

### Pages 与 Vercel 的行为差异

| | GitHub Pages | Vercel |
|---|---|---|
| 路径 | `/zhiwei.html`（严格匹配文件） | `/zhiwei`（`cleanUrls` 生效） |
| 构建 | Actions 里跑 `tools/build.mjs` | `vercel.json` 里配 |
| 国内访问 | ✅ | ❌ |

所以站内链接一律用 `./<id>.html`，两边都能用。

---

## 自动部署验证

push 之后有三种确认方式：

```bash
# 1. GitHub Actions 是否绿
gh run list --limit 2

# 2. Vercel 部署状态（浏览器）
#    https://vercel.com/<scope>/<project>/deployments

# 3. 直接开线上页面
open https://huaben.vercel.app/zhiwei
```

⚠️ 命令行 `curl` 可能被沙箱拦（返回 `000`），别据此判断站点挂了。用浏览器确认。

---

## 发版前 checklist

```bash
npm run check      # 校验剧本 + 打包，必须绿
```

- [ ] `npm run check` 通过，没有 `✗`
- [ ] 每个结局都至少有一条路径可达（看校验器输出的括号里的数字，不能是 0）
- [ ] 每个决策节点都有无条件兜底选项
- [ ] 浏览器实机点一遍主线，确认没有死路
- [ ] 线上地址打开确认标题、数值条正常
- [ ] 刷新页面确认能续玩（`https` 下存档才可靠）

---

## 换成自己的域名

Vercel → 项目 → Settings → Domains → 添加域名，按提示配 DNS。

⚠️ 国内访问需要 ICP 备案；用 `*.vercel.app` 默认域名可以先跑起来。


---

## 内容保护

Pages 要求仓库公开，意味着 `games/*/story.js` 全文可被搜索、可被 `git clone` 后改名重发。

**这是纯前端方案的固有代价**：即使仓库私有，网页上的正文本来也能被人复制。

### 缓解方案（按成本排序）

| 方案 | 防什么 | 成本 |
|---|---|---|
| 随时接受 | —— | 无 |
| 只公开引擎，剧本放私有仓库，构建时用 PAT 拉取 | 防 clone 后重发（正文仍可看） | 中，需配 secret |
| 加后端，付费内容按会话下发 | 防全文被抓 | 高 |

第二种的实现思路：

1. 建私有仓库 `<owner>/huaben-games`，存放 `games/`
2. 在公开仓库建细粒度 PAT（只读该私有仓库），存进 `Settings → Secrets → GAMES_TOKEN`
3. `pages.yml` 里构建前先拉取：

```yaml
- name: 拉取私有剧本
  run: |
    git clone --depth 1 https://x-access-token:${{ secrets.GAMES_TOKEN }}@github.com/<owner>/huaben-games.git .games
    cp -R .games/games/* games/
```

这样公开仓库里没有剧本，clone 下来是个空壳；而部署出来的站点照常可玩。
