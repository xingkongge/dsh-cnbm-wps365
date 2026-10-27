# cnbm知识库（WPS 365 云文档插件，DSH）

> 显示名：**cnbm知识库**。v2.0.0 起技术标识也统一为 `cnbm` 前缀：包名 `@cnbm/dsh-wps365`、
> 工具 `cnbm_*`、路由 `/cnbm`、客户端模块 id 与包名一致。从 v1.x 升级需要重新安装插件。

以**当前登录人的身份**读取 WPS 365 知识库与云文档。可见范围完全由 WPS 后台授权决定——
插件不做任何权限判断，也不缓存任何凭证。

```
Agent 工具 ──→ lib/runner.js ──execFile──→ wps365-cli ──Bearer(delegated)──→ openapi.wps.cn
                                              ↑ 钥匙串: secret/token            ↑ 授权判定
                                         凭证只存在这里，插件碰不到
```

## 前置条件

| 条件 | 说明 |
|------|------|
| WPS 365 **企业账号** | 个人版 WPS 账号拿不到企业数据 |
| 企业套餐 | 商业高级版 / 商业企业版 / 商业旗舰版 / 教育标准版及以上；**免费版、体验版会在申请权限时被拦** |
| 企业自建应用 | 已创建并拿到 `App ID` / `App Secret` |
| 已开通 scope | `kso.user_base.read`、`kso.file.readwrite`、`kso.drive.readwrite` 等，需管理员审批生效 |
| 应用「可用范围」含该成员 | 否则登录成功但数据为空 |
| 已安装 `wps365-cli` | 见下方第一步 |

## 第一步：安装 CLI（每台机器一次）

```bash
# macOS / Linux
curl -fsSL https://open-docs.wpscdn.cn/cli/install.sh | bash

# Windows PowerShell
irm https://open-docs.wpscdn.cn/cli/install.ps1 | iex
```

确认：`wps365-cli --version`

## 第二步：配置应用凭证（每人一次）

```bash
wps365-cli auth setup --client-id <团队AppID> --client-secret <向管理员获取>
```

- `App ID` 团队共享，不敏感，可随插件预置。
- `App Secret` 由管理员通过密码管理器 / 一次性链接发放。**不要发群聊，不要提交到 Git。**
- 凭证写入系统钥匙串，插件不保存、不回显、不写日志。

## 第三步：用企业账号登录（每人一次，换机时重做）

```bash
wps365-cli auth login --device
```

会打开浏览器并显示用户码，**用企业账号**确认授权。也可以装好插件后在对话里说「登录 WPS」，由 `cnbm_login` 工具发起。

验证：`wps365-cli user me` 应返回你自己的姓名 / 邮箱 / 所属企业。

## 安装插件

本目录就是一个 cordis bundle。任选一种方式安装：

| 方式 | 操作 |
|------|------|
| **CLI（最可复现）** | `dsh plugin --profile desktop add <本目录绝对路径>` |
| 侧边栏 GUI | 插件 → 安装，填 git 地址 / `.tgz` / 本地目录 |
| tarball | `node scripts/release.mjs` 后把 `dist/*.tgz` 路径交给上面任一方式 |

实测结论：`dsh plugin add <路径>` 会**同时完成两步**——写入 `dependencies`，并把包名追加进 `dsh.profile.bundles`。
不需要手工改 profile 清单；**首次安装**经 HMR 即可生效，无需重启。

> 但**修改已安装插件（link: 本地目录）的源码不会热重载**——ESM 模块缓存不会因为文件改动而重建。
> 改完代码需完全退出并重开应用。这条用 `<路径>` 本地 `link:` 方式开发调试时必须注意。

### 打包分发（本地发版）

```bash
node scripts/release.mjs   # 产出 dist/cnbm-dsh-wps365-2.1.0.tgz + dist/SHA256SUMS（约 35KB）
```

产物已验证**自包含**：解包后可直接 `import`，15 个工具全部注册，不依赖工作区里的任何其它文件。
安装包只留在本地 `dist/`、随内网 Git 的 Release 附件分发，**不进 Git**；校验和见 `dist/SHA256SUMS`。

| 分发方式 | 成员侧安装命令 |
|---------|---------------|
| **内网 Git（推荐）** | `dsh plugin --profile desktop add git+https://内网/…/dsh-wps365.git` |
| tarball | `dsh plugin --profile desktop add ./dist/cnbm-dsh-wps365-2.1.0.tgz` |
| 私有 npm | `dsh plugin --profile desktop add @cnbm/dsh-wps365@2.1.0` |
| 侧边栏 GUI | 插件 → 安装，粘贴上述任一地址 |

包内只含 12 个文件：`index.js` / `client.js` / `lib/runner.js` / `lib/ui.js` / `lib/ui-page.js` /
`cordis.patch.yml` / `package.json` / `icon.svg` / `locale/{zh,en}.json` / `README.md` / `LICENSE`。
**不含测试、不含 `.tools/`、不含任何凭证。** `INSTALL.md` 与 `RELEASING.md` 只在仓库里，不打进安装包。

本地管理约定：源码走内网 Git；`dist/` 归档安装包与校验和；`INSTALL.md` 是安装手册（知识库直接粘贴这份）；
`RELEASING.md` 是发版流程。工作区根目录的 `PLUGINS.md` 是本机插件索引，`plugin-docs/` 是「插件库」知识库的
粘贴源（索引 + 手册），知识库不存二进制制品。`private: true` 保证不会被误发到公共 npm。

> **从 v1.x 升级（v2.0.0 破坏性改名）**：旧包名 `@local/dsh-wps365`、旧工具 `wps365_*`、旧路由 `/wps365` 全部弃用。
> 完全退出 DSH 后先移除旧包、再安装新包，然后重开应用：
>
> ```bash
> dsh plugin --profile desktop remove @local/dsh-wps365
> dsh plugin --profile desktop add ./dist/cnbm-dsh-wps365-2.1.0.tgz
> # 或：dsh plugin --profile desktop add git+https://内网/…/dsh-wps365.git
> ```

安装成功后 Host 工具可经 HMR 立即出现；**但客户端面板（`client.js`）与源码改动需要完全退出并重开应用**才会加载新的 JS 模块。验证方式：侧栏出现「cnbm知识库」图标，或调用 `cnbm_status`。

> `dsh` 可执行文件在 `DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`，未加入 PATH；GUI 安装则用侧边栏插件页。
> `plugin_manager` 工具仅在 **Creator 预设**启用，且预设切换只对新会话生效——已在运行的老会话工具集不会变。

## 内嵌面板与 Web 控制台

插件有两条 UI 入口，共用同一份 Host 数据接口：

| 入口 | 位置 | 说明 |
|------|------|------|
| **内嵌面板（推荐）** | 侧栏「cnbm知识库」图标 → 中央面板 | 与 Harness 一体，跟随深浅色主题；状态/登录、知识库钻取、搜索、正文阅读都在面板内完成 |
| 独立页面（兜底） | `${GUI 同源地址}/cnbm` | 自包含 HTML，无构建步骤，适合排障、深链或在没有面板的宿主里使用 |

> 页面端口由 Harness 启动时动态分配（不再是固定 19387），请从当前 GUI 地址取同源路径，
> 例如 `http://127.0.0.1:61978/cnbm`。

| 区块 | 能力 |
|------|------|
| 状态卡 | 登录状态徽章、CLI 版本与兼容性、已授予 scope 列表；**始终提供「登录 / 重新登录」**，令牌过期可原地重新授权并自动轮询结果 |
| 知识库 | 知识库列表 → 节点树钻取（面包屑/返回上级）→ 点文档读正文 |
| 搜索 | 关键字搜索，结果带正文高亮片段，可直接「读正文」 |

实现要点：

- **面板是 React 组件，不是 iframe**：注册在 `sidebar.panellist` + `main` 槽位，样式只用 `--dsw-alias-*` 主题 token；iframe 拿不到宿主主题、深浅色和语言，官方实践明确不推荐。
- **同一份数据契约**：面板与 Agent 工具共用 `statusPayload` / 知识库操作，Panel 只是渲染层。
- **零外部资源**：面板无构建步骤、无 CDN 依赖；独立页面 HTML/CSS/JS 全部内联。
- **仅回环可访问**：校验 `Host` 与 `Origin`；面板/页面调用 `/cnbm/api/*` 时还必须带 `x-dsh-cnbm: 1` 自定义头，挡住跨站页面与裸 GET。
- **优雅降级**：若宿主没有 `webServer` 服务，只跳过独立页面，Agent 工具不受影响；Web 注册失败会被隔离并记一条 warning，不会连带回滚工具。

## 授权过期自动重登（v2.2.0）

WPS 的 refresh token 可能失效（`invalid_grant: not_found`），此时 `auth status` 仍显示
`delegated.available=true`，但任何业务调用都会 401。v2.2.0 起：

1. 前置检查把 `status !== "valid"` 一律视为失效（`auth-expired`）；
2. 任意工具探测到失效后，**自动拉起设备码登录**（浏览器自动打开），并把验证地址与用户码
   直接放进工具结果；
3. 登录进程在后台等待，用户确认后再次调用即可，无需手动执行 `cnbm_login`；
4. 面板进入「登录已过期」时自动发起重登，并轮询状态，授权完成自动刷新。

可关闭/定制：`autoRelogin: false`、`loginScopes: "kso.wiki.readwrite,..."`。

## 提供的工具

### 环境与身份（4）

| 工具 | 作用 |
|------|------|
| `cnbm_status` | 排障入口：CLI / 命令集 / 凭证 / 登录 / **已授予 scope** |
| `cnbm_login` | 发起设备码登录；**传 `scopes` 才能拿到权限**，不传只有空令牌 |
| `cnbm_logout` | 退出用户授权（保留应用凭证） |
| `cnbm_me` | 当前登录用户（需 `kso.user_base.read`） |

### 知识库 wiki（4）— 需要 `kso.wiki.readwrite`

| 工具 | 作用 |
|------|------|
| `cnbm_wiki_spaces` | 列出可访问的知识库，拿 space-id |
| `cnbm_wiki_nodes` | 列知识库节点树（parent-id 用 `0` 表示根） |
| `cnbm_wiki_node_meta` | 单个节点的元信息 |
| `cnbm_wiki_search` | **按关键字搜索，返回正文高亮片段** |
| `cnbm_wiki_read` | **读完整正文（Markdown）**；自动把知识库节点 ID 解析为真实文件 ID，无需知道 drive-id |

### 云文档 drive（5）— 需要 `kso.drive.readwrite` / `kso.file.*`

| 工具 | 作用 |
|------|------|
| `cnbm_docs_drives` | 列出可访问的云盘 |
| `cnbm_docs_search` | 在授权范围内搜索文档 |
| `cnbm_docs_list` | 浏览云盘目录 |
| `cnbm_docs_read` | 抽取文档正文 |
| `cnbm_docs_download` | 获取下载地址（返回地址，非文件本体） |

### 兜底（1）

| 工具 | 作用 |
|------|------|
| `cnbm_api` | 调用任意开放平台端点，默认只读 |

> 所有工具在调用前会用令牌里的 `granted_scopes` 做**前置权限检查**：缺权限时直接告诉你缺哪个 scope、已授予哪些，而不是丢一个 403 出来。

## 配置项

在 profile 的 `cordis.patch.yml` 里按需覆盖：

```yaml
- id: cnbm-knowledge
  config:
    cliPath: ''            # 留空按 WPS365_CLI → ~/.local/bin → PATH 探测
    configDir: ''          # 留空用 CLI 自身默认目录（推荐，与手工用 CLI 共享凭证）
    timeoutMs: 30000
    maxOutputChars: 20000
    readOnly: true         # 默认只读
    allowWrite: false      # 开启写操作需两项同时为 false/true
    loginTimeoutMs: 300000
    autoRelogin: true       # 授权失效时自动拉起设备码登录（v2.1）
    loginScopes: ''         # 自动重登申请的 scope；留空=沿用令牌里已授予的 scope
```

## scope 决定你能用哪组工具

| scope | 解锁能力 |
|-------|---------|
| `kso.wiki.readwrite` | 知识库 4 个工具（列表 / 节点树 / 元信息 / 搜索+高亮） |
| `kso.user_base.read` | `cnbm_me` |
| `kso.drive.readwrite`、`kso.file.read` | 云文档 5 个工具 |

**只申请 wiki scope 也能用**——知识库搜索返回正文片段，足以回答内容性问题。
**加上 `kso.file.read` 后**，`cnbm_wiki_read` 可以读出完整正文（实测约 9.7K 字符的 Markdown，
自动剥离 Word 目录域代码与控制字符）。

> 知识库节点 ID（如 `cmTCLP53LuFd`）与真实文件 ID（如 `h3QF1FL...`）不是同一个。
> `cnbm_wiki_read` 内部先用 `/v7/files/{id}/meta` 换出 `drive_id` + 真实文件 ID，再读正文，调用方无需关心。

## 排障：7 种状态对应 7 种动作

`cnbm_status` 会明确报告处于哪种状态，避免"登录了但没数据"这类误判。

| 状态 | 含义 | 下一步 |
|------|------|--------|
| `cli-missing` | 没装 wps365-cli | 执行第一步 |
| `spec-unavailable` | 业务命令全部消失，`drive`/`user` 都不在 `--help` 里 | 配置目录不可写 → 设置 `configDir` 指向可写目录 |
| `credentials-missing` | 没配 App ID / Secret | 执行第二步 |
| `not-logged-in` | 没登录或已过期 | 调用 `cnbm_login` |
| `logged-in` | 正常 | — |
| `scope-missing` | 应用未开通权限 | 开放平台申请 scope → 发布 → 管理员审批 |
| `entitlement-missing` | **企业套餐权益不足**（`403000001`） | 找管理员开通商业高级版 / 旗舰版；**不是 scope 问题** |
| `out-of-range` | 账号不在可用范围 | 应用管理员把成员纳入可用范围 |

> 最容易混淆的是最后两类：`scope-missing` 要批权限，`entitlement-missing` 要买套餐，提示错了会让管理员白忙。

## 团队共享说明

- **共享**：插件代码、`App ID`、scope 申请（应用级一次，全团队复用）。
- **不共享**：`App Secret`（每人自填）、用户 token（每人各自登录）。
- **反模式**：不要"管理员登录一次把 token 发给全组"。WPS 侧审计会全部记在该个人名下，权限也失真。

## 安全

- 插件进程**从不接触 token**，所有请求由 CLI 带凭证发出。
- `execFile` 参数数组调用，不做 shell 拼接。
- 默认只读；写操作需要显式 `readOnly: false` + `allowWrite: true`，且 `cnbm_api` 的写方法会被拦截。
- 退出：`cnbm_logout`；彻底清理：`wps365-cli auth clean --force`。

## 开发与自测

```bash
node --test test/        # 45 项用例，含真实 CLI 端到端调用与面板槽位注册
```

测试会用一个假 `ctx` 收集工具声明，并对 `.tools/wps365-cli` 真实执行，覆盖命令探测、认证状态解析、
8 类错误映射、只读拦截等；`test/ui.test.mjs` 覆盖页面与 API（含自定义头校验），
`test/client.test.mjs` 覆盖客户端模块的两个槽位注册。`.tools/`、`.wpscfg/` 不入库（见 `.gitignore`）。


## v2.2.0 · 免 CLI 配置的绑定与扫码登录

- 面板首次使用直接填 **App ID / App Secret**，点「保存并登录」→ 调 `wps365-cli auth setup` 存进本机钥匙串；
- 之后设备码登录会同时显示 **二维码 PNG**（`wps365-cli auth qrcode`）+ 验证地址 + 用户码；
- 也支持在 profile 的 `cordis.patch.yml` 用 `clientId` / `clientSecret` / `apiBase` 注入（走 `WPS365_CLIENT_ID` 等环境变量，不落盘）；
- 同事不需要先跑 `config init`，装好插件、填一次 App ID/Secret、扫码即可。
