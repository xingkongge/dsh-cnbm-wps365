# WPS 365 插件规划（基于 wps365-cli）

> 状态：**规划已确认，并经 v0.3.6 二进制实测校准，可开工**
> 实测环境：macOS 27.0.1 / arm64 / wps365-cli v0.3.6（官方 release，SHA256 已校验）
> 目标插件：在 DeepSeek Harness 中提供"以**当前登录人身份**访问 WPS 365 内容"的能力，内容范围**完全由 WPS 后台授权决定**。

---

## 已确认决策（2026-10-16）

| 决策项 | 结论 | 影响 |
|--------|------|------|
| 插件形态 | **DeepSeek Harness 插件（CLI 包壳）** = 方案 A | 按第 4 节实施；方案 B/C 降为备选 |
| 首个业务域 | **只做云文档**：搜索 / 列表 / 正文 / 下载 | M2 范围收敛为云文档；其余域推迟到 M4 |
| 应用资质 | 已有 `client_id` / `client_secret`，目标 scope 已审批 | **M0 审批部分跳过**，但见下方环境自检 |
| 读写范围 | **默认只读**，预留 `Config.allowWrite` 开关（默认 false） | 工具默认拒绝写命令；写操作需显式配置 + 用户确认 |

### 环境自检结果（2026-10-16）

| 检查项 | 结果 | 处理 |
|--------|------|------|
| `wps365-cli` 可执行文件 | ⚠️ **未安装到系统**；已下载 v0.3.6 到本目录 `.tools/` 用于契约验证（SHA256 已与官方 release digest 逐位比对一致） | 正式开工时装到 `~/.local/bin` |
| `WPS365_CLI` 环境变量 | 未设置 | 插件按"环境变量 → `~/.local/bin` → PATH"顺序探测 |
| `WPS365_CLIENT_ID` 环境变量 | 未设置 | 不影响：凭证走 CLI 钥匙串，用户执行 `auth setup` 即可 |

> 结论：M0 从"审批"变成"装 CLI + `auth setup` + `auth login --device` + `user me`"四步，预计 10 分钟内可完成。

### M1 实施记录（2026-10-19）

M1（插件骨架 + 鉴权工具）已落地，产物即本目录的 cordis bundle。

| 项 | 结果 |
|----|------|
| `package.json` / `cordis.patch.yml` | 已写，Host-only bundle（不含 `dsh.client`，理由见下） |
| `index.js` | 10 个工具：status / login / logout / me / docs×5 / api |
| `lib/runner.js` | CLI 定位、配置目录注入、命令探测、认证状态解析、8 类错误映射、只读拦截、设备码后台登录 |
| `locale/{zh,en}.json` + `icon.svg` | 已写，插件页可显示中文标题 |
| `test/plugin.test.mjs` | 21 项用例全绿，含对真实 CLI 的端到端调用 |
| 验证方式 | 用假 `ctx` 收集工具声明并真实执行，**不依赖 DSH 运行** |

**两个与原规划的偏差（有意为之）：**

1. **暂不做 Client UI 面板。** 本会话的 standard 预设没有 `cordis_inspect_query`，我无法核对当前版本的 slot 注册参数与 props；也没有 `plugin_manager`，装不上就看不到渲染结果。写一个装不上、验不了的 UI 违反"先交付可用插件"原则。策略改为**Agent 驱动登录**：`cnbm_login` 返回验证地址与用户码，用户在浏览器授权，`cnbm_status` 确认。面板留到能安装/能验证时再补。
2. **不导出 `Config` schema。** 引入 `schemastery` 需要额外依赖解析，而 `apply(ctx, config)` 直接接收原始 config 已够用；配置项在 `cordis.patch.yml` 注释里说明。

**尚未验证的部分（诚实标注）：**

- 未在真实 DSH 中安装，**slot / 插件页渲染未验证**（本期无 UI，风险已规避）。
- 未用真实企业账号跑 `auth login --device`，**设备码输出格式未实测**；因此 `cnbm_login` 采取"原文透传 + 尽力提取 URL/用户码"的降级策略，而不是假定格式解析。
- `drive file-content get` 的返回体字段（`content` / `data.content`）未实测，读取工具做了多字段兜底。
- `probeBusinessCommands` 与 `readAuthStatus` 已对真实二进制验证（含配置目录不可写的负例）。

### 插件安装记录（2026-10-19）

M1 已装进本机 `desktop` profile 并且**在真实 DSH 中生效**。

| 步骤 | 命令 | 结果 |
|------|------|------|
| 备份 | 复制 `package.json` / `cordis.patch.yml` 到 `.backup/` | 完成 |
| 装包 | `dsh plugin --profile desktop add <本目录>` | `+ @cnbm/dsh-wps365 link:...`，pnpm 锁文件校验通过 |
| 选 bundle | **自动完成** | `dsh.profile.bundles` 末尾自动出现 `@cnbm/dsh-wps365` |
| 生效验证 | HMR 热更新 | 新的 `cnbm_*` 工具注入会话工具集 = 硬证据 |
| 装 CLI | 官方 install.sh | v0.3.6 → `~/.local/bin/wps365-cli`，SHA-256 校验通过 |
| 端到端 | `cnbm_status` | 正确报 `credentials-missing`（而非 `spec-unavailable`），说明业务命令集在宿主进程加载正常 |

**三个新发现（已回写 README）：**

1. `dsh plugin add <本地路径>` **同时完成"装包"和"选为 bundle"**，不必手工改 profile 清单。
2. `selectedDefault: cordis` 只影响**新会话**；既有会话的工具集是固定的，所以 Creator 预设并未给我额外的 `plugin_manager` 工具。安装走的是 `dsh` CLI 路径。
3. 配置目录不可写（实测坑 A）**只发生在沙箱化的工具进程**里；插件运行在宿主 Electron 进程，`~/Library/Application Support/wps365-cli` 可正常写入。该坑的适用范围需要在文档里说清楚，否则会误导排障方向。

**仍未完成：** 应用凭证（`auth setup`）与用户登录（`auth login --device`）必须由本人执行，`client_secret` 不应经过对话或工具调用。

### 阻塞日志：scope 未开通（2026-10-19）

凭证已配置（`auth status` 显示 client_id / client_secret 均已就绪），但设备码登录被拒绝，证据链：

| 测试 | 输出 | 结论 |
|------|------|------|
| `cnbm_login`（无 scopes） | `invalid_scope: No allowed scopes remain after applying defaults for this client` | 默认 scope 与该应用允许集交集为空 |
| `cnbm_login --scopes kso.user_base.read` | `invalid_scope: The requested scope 'kso.user_base.read' is not allowed` | 该 scope 的 **user（delegated）** 权限未开通 |
| `user me --token-type app` | `--token-type=app is incompatible with operation security` | 该端点仅支持用户身份，不能用于判别 app scope |
| `auth token --app` | `no app token available` | 应用身份 token 也拿不到 |

**CLI 内置的 scope 词汇只有 4 个**（从二进制字符串提取，不存在只读变体）：
`kso.user_base.read`、`kso.drive.readwrite`、`kso.file.readwrite`、`kso.airpage.readwrite`

**待用户确认（决定修法）：**
1. 权限管理里目标 scope 状态是否为「已开通」，且**权限类型勾选了 `user`**（不是只有 `app`）；
2. 是否存在已发布并通过管理员审批的版本；
3. 应用开发类型是否为「企业内部应用 / 企业自建应用」。

> 这一条不是代码缺陷。插件侧行为正确：如实透传服务端错误，没有尝试绕过授权。

### 阻塞日志（二）：登录成功但令牌无任何可用 scope（2026-10-19 二次复核）

用户处理授权后重试，登录已可成功，但所有业务端点仍 403 `invalid_scope`。

| 测试 | 结果 |
|------|------|
| `cnbm_login`（无 scopes） | ✅ 成功，返回验证地址 `...user_code=RWBP-VCVZ` + 二维码，10 分钟内有效 |
| 用户浏览器授权 | ✅ 成功，`delegated: 可用（valid）`，`has_refresh: true` |
| `cnbm_me` | ❌ 403：`kso.user_base.read` 未授予 |
| `cnbm_docs_drives` | ❌ 403：需 `kso.drive.readwrite / mcp_yundoc / mcp_airpage` 之一 |
| 逐个探测 9 个候选 scope | ❌ 全部 `not allowed` |
| 解码 access token | 不透明串，仅含 `exp`，不携带 scope 信息 |
| `--device` + `--dry-run` | 不支持，无法预览请求参数 |

**结论：应用当前没有开通任何「用户授权（user/delegated）」类型的 scope。** 无 scope 的设备码登录仍会签发一个空权限令牌，所以"登录成功"具有欺骗性——它不是授权成功的证据。

**从本地 API spec 提取的精确 scope 要求（只读云文档最小集合）：**

| 端点 | 所需 scope（满足其一） |
|------|----------------------|
| `/v7/users/current` | `kso.user_base.read` |
| `/v7/drives` | `kso.drive.readwrite`（无只读变体） |
| `.../files/{parent_id}/children`（列目录） | `kso.file.read` |
| `.../files/{file_id}/content`（读正文） | `kso.file.read` 或 `kso.file.readwrite` |
| `/v7/files/search` | `kso.file.search` 或 `kso.file_search.readwrite` |

**待办（开放平台侧）：** 开通上述 scope 的 **user** 类型 → 创建版本发布 → 管理员审批 → 用
`cnbm_login --scopes "kso.user_base.read,kso.drive.readwrite,kso.file.read,kso.file.search"` 重新授权
（已有令牌不会自动获得新 scope，必须重新登录）。

### 转折：只开通了知识库 scope（2026-10-19 三次复核）

用户实际只申请到 **`kso.wiki.readwrite`**。这不是降级，而是换了条能走通的路：

| 验证 | 结果 |
|------|------|
| `kso.wiki.readwrite` 探测 | ✅ ALLOWED |
| `cnbm_login --scopes kso.wiki.readwrite` | ✅ 成功，`Granted scopes: kso.wiki.readwrite`（已授权过的应用自动放行，无需再次点击） |
| `GET /v7/wiki/spaces` | ✅ 返回 2 个知识库：信云智联企业知识库(`raJ2wEE`)、AI事业部知识库(`qdobkWP`) |
| `GET /v7/wiki/spaces/qdobkWP/files/0/children` | ✅ 返回真实文档节点（含 id / 名称 / 大小 / 创建人） |
| `POST /v7/wiki/search` | ✅ 返回命中文件 + **`file_content` 正文高亮片段** |

**关键发现：知识库的 16 个端点全部只需要 `kso.wiki.readwrite`**，与 drive/file scope 完全解耦。
其中搜索接口会直接返回正文片段，因此即使没有 `kso.file.read`，也能回答内容性问题——
只是拿不到完整正文。

**由此调整实现：**

1. 新增 4 个知识库工具：`cnbm_wiki_spaces` / `_nodes` / `_node_meta` / `_search`。
2. 新增**基于 `granted_scopes` 的前置权限检查**（`checkScope`）：缺权限时直接说明缺哪个、已授予哪些，
   而不是等服务端返回 403。`granted_scopes` 在 `auth status` 里可读（`null` 表示未知，此时不拦截）。
3. 状态工具新增 `logged-in-but-scopeless` 状态——登录成功但令牌零权限，这是实践中最容易被当成"成功"的假象。
4. 测试用例从 21 增至 25，并新增一条**真实链路用例**（未登录时自动跳过）。

**测试中发现的一个事实：凭证与令牌存放在系统钥匙串（全局），用临时配置目录无法隔离认证状态。**
因此测试改为环境无关断言，不再假设"空配置目录 = 未配置凭证"。

### 打通：完整正文读取链路（2026-10-19 终态）

补开 `kso.user_base.read` + `kso.file.read` 并重启后，全链路验证通过：

| 环节 | 结果 |
|------|------|
| scope 探测 | ✅ `kso.user_base.read`、`kso.file.read` 均 ALLOWED |
| 重新授权 | ✅ `Granted scopes: kso.file.read, kso.user_base.read, kso.wiki.readwrite` |
| `cnbm_me` | ✅ 返回 **李帅 / 企业 EPM2qA8** |
| `/v7/files/{id}/meta` | ✅ 返回 `drive_id` 与**真实文件 ID**（与知识库 link_id 不同） |
| `/v7/drives/{drive}/files/{real}/content?format=markdown` | ✅ 返回完整正文 |
| `cnbm_wiki_read` | ✅ **9727 字符干净 Markdown**，无目录域代码、无控制字符 |

**三个关键实现细节：**

1. **知识库节点 ID ≠ 真实文件 ID。** 节点 `cmTCLP53LuFd` 对应的真实文件是
   `h3QF1FLnmxMDNt8ztQtX1xddiZfKznFz1`，`drive_id` 要从 `/v7/files/{id}/meta` 换出来。
   `cnbm_wiki_read` 把这两步封装掉，调用方只传节点 ID。
2. **WPS 导出的 markdown/plain 都带 Word 目录域代码**（`TOC \o ... HYPERLINK \l _Toc... PAGEREF`）。
   不清洗会污染上下文，实测清洗后从"一堆控制字符 + 书签"变成可读的层级文档。
3. **正文格式用 `format=markdown`**（spec 里枚举为 `kdc/plain/markdown/html`）。
   `cnbm_docs_read` 与 `cnbm_wiki_read` 共用同一条 `readDocumentBody` 链路。

**最终工具集（15 个）：** 环境身份 4 + 知识库 5 + 云文档 5 + 兜底 1。
测试 26 项全绿，其中 2 项为真实账号端到端用例（知识库列表、正文读取）。

### 封装完成（v1.0.0，2026-10-19）

| 项 | 状态 |
|----|------|
| 版本自检 | ✅ 启动时比对 `wps365-cli ≥ 0.3.6`，结果缓存避免重复探测；`status` 显示是否兼容 |
| 包元信息 | ✅ `version 1.0.0`、`license MIT`、`keywords`、`engines.node>=18`、`private: true` |
| 分发产物 | ✅ `pnpm pack` → `local-dsh-wps365-1.0.0.tgz`（18KB，9 个文件） |
| 自包含验证 | ✅ 解包到干净目录后可直接 `import`，15 个工具全部注册 |
| 团队文档 | ✅ README 含四种分发方式 + 成员三步接入 + 7 状态排障表 |

**M1 / M2 / 封装 已完成。**

### M3 完成：Web 控制台（v1.1.0，2026-10-20）

原计划做 Client slot 面板，但本会话缺少 `cordis_inspect_query` / `plugin_manager`，
无法核对 slot 注册契约。改用生态内的通行做法绕开这个阻塞：

**通过 `ctx.webServer.register({ kind:'prefix', path:'/cnbm', handler })` 注册同源页面。**
`dsh-knowledge` 的管理台就是同一机制，因此这是被验证过的路径，不需要 slot 检查工具。

| 项 | 实现 |
|----|------|
| 页面 | `lib/ui-page.js`，14.6KB 自包含 HTML（全内联，**零外部资源**） |
| 路由 | `lib/ui.js`，注册 `/cnbm` + 6 个 API 端点 |
| 数据 | 与 Agent 工具**共用** `statusPayload` / `apiCall` / `resolveFileIdentity` / `readDocumentBody` |
| 安全 | 仅回环可访问：校验 `Host` 与 `Origin`，非本机返回 403 |
| 降级 | 宿主无 `webServer` 服务时只跳过 UI，Agent 工具不受影响 |

**验证方式（真实 HTTP + 真实 CLI，非 mock）**：用 `scripts/verify-ui.mjs` 把 handler 挂到真实
`http.createServer` 上逐个打端点，实测结果：

| 端点 | 结果 |
|------|------|
| `GET /cnbm` | 200，14,664 字符，外部资源引用：无 |
| `GET /api/status` | 200，`state=logged-in`，CLI 0.3.6，3 个 scope |
| `GET /api/spaces` | 200，返回 2 个真实知识库 |
| `GET /api/nodes` | 200，返回 3 篇真实文档（含 ID/大小） |
| `GET /api/search` | 200，返回命中与高亮片段 |
| `GET /api/read` | 200，9,727 字符干净 Markdown |
| 非回环 Host / 跨站 Origin | 403 |

**验证中发现并修复的一个真实 bug**：`/v7/wiki/search` 的 `page_size` 是**必填**项，
缺省返回 `400408021 参数无效: ('PageSize':'required')`。该缺陷同时存在于 Agent 工具
（`cnbm_wiki_search`）与 UI 中，因为此前测试恰好都传了 `pageSize` 而未暴露。
现两处均补默认值 20。

**测试**：37 项（26 插件 + 11 UI 路由）。UI 测试覆盖：页面自包含性、6 个端点、
非法 ID 拒绝、404/405、Host/Origin 防护。

**未验证**：页面在浏览器中的**视觉渲染**（无浏览器控制能力）。HTTP 层与 HTML 结构已验证，
样式与交互需人工打开 `http://127.0.0.1:19387/cnbm` 确认。

### M4 完成：Harness 内嵌面板（v1.2.0，2026-10-20）

**动机**：M3 的独立页面不在 GUI 导航内、不共享宿主主题与语言。用 Client `Slots` 检查当前
真实槽位树后确认：`sidebar.panellist`（list，id/order/label，图标拿 `{ size, active }`）与
`main`（keyed，「Central panel selected by sidebar entry id」）就是官方内嵌入口；同 profile 的
`@cnbmtech/dsh-zentao-session` 已验证「Host 路由 + 客户端面板」这一形态可行。

| 项 | 实现 |
|----|------|
| 客户端半 | 新增 `client.js`（约 500 行，React 无构建），`window.__ModuleLoader__.load({ id: 包名 })` |
| 清单 | `package.json` 增加 `exports["./client"]`、`files` 含 `client.js`、`dsh.client = { platform: "web", immediately: true }` |
| 槽位 | `sidebar.panellist`（id `wps365`，order 50，label thunk）+ `main`（key `wps365`），图标复用 `icon.svg` 造型 |
| 数据 | 复用已有的 `/cnbm/api/*` 同源 JSON 接口；面板与页面都不新增 Host 业务逻辑 |
| 样式 | 只使用 `--dsw-alias-*` 主题 token；不再依赖 `prefers-color-scheme`，跟随宿主深浅色 |
| 防 CSRF | API 额外要求 `x-dsh-cnbm: 1` 请求头；页面与面板都带上；Host/Origin 回环校验保留 |
| 隔离 | Host 侧改用 `ctx.get('webServer')`；UI 注册整体 `try/catch`，失败只记 warning，不再连带回滚 15 个工具 |
| 保留 | 独立页面 `/cnbm` 继续作为兜底/深链入口，不再写死端口 |

**验证**：

- `node --test test/`：42 项全绿（新增 `test/client.test.mjs` 3 项 + API 缺头 403 等 2 项）。
- 真实 Cordis 4.0.5 激活冒烟：提供假 `webServer` 时 15 工具 + `/cnbm` 路由均注册；
  `webServer.register` 抛错时工具仍保留、只打 warning；无 `webServer` 时纯工具模式正常。
- 面板在浏览器里的视觉与交互需重启应用后人工确认（Client 模块不会热重载）。

**未做（后续）**：面板文案暂为中文（未接 Client locale）；无退出登录按钮；未导出 `Config` schema，
配置仍需改 `cordis.patch.yml`；未做「面板 ↔ 会话」联动（把文档引用进对话）。

### M5：技术标识统一为 cnbm（v2.0.0，2026-10-21）

用户要求包名、工具名也统一改成 `cnbm` 前缀（此前只改了显示名）。这是一次**破坏性迁移**：

| 项 | v1.x | v2.0.0 |
|----|------|--------|
| 包名 | `@local/dsh-wps365` | `@cnbm/dsh-wps365` |
| Host 插件行 / 侧栏与面板 key | `wps365` / `wps365` | `cnbm-knowledge` |
| 工具名 | `wps365_*`（15 个） | `cnbm_*`（15 个，后缀不变） |
| 同源路由 | `/wps365/api/*` | `/cnbm/api/*` |
| 请求头 | `x-dsh-wps365: 1` | `x-dsh-cnbm: 1` |
| 客户端模块 id | `@local/dsh-wps365` | `@cnbm/dsh-wps365`（等于包名） |
| 安装包 | `local-dsh-wps365-<v>.tgz` | `cnbm-dsh-wps365-<v>.tgz` |

保留不动：`wps365-cli`（官方 CLI 名称）、`WPS365_CLI` 环境变量、`wps365-plugin/` 目录名、
内网 Git 仓库占位地址 `dsh-wps365.git`、scope 名称与 WPS 平台端点。

**升级方式（必须重装，不能热更新）**：完全退出 DSH 后

```bash
dsh plugin --profile desktop remove @local/dsh-wps365
dsh plugin --profile desktop add /Users/liangli/Documents/deepseek-harness/default-workspace/wps365-plugin
```

再重开应用。旧会话里的 `wps365_*` 调用会失效，新工具为 `cnbm_*`；旧 `/wps365` 页面不再注册。
真实链路测试曾出现 `invalid_grant`（refresh token 过期），升级后需重新执行一次 `cnbm_login`。

### M6：授权过期可重新登录（v2.0.1，2026-10-21）

现场问题：令牌 refresh 失败（`invalid_grant`）时，`auth status` 仍报 `delegated.available`，面板显示「已登录」，
登录按钮被隐藏，用户没有任何入口重新授权。

修复：

- 面板/页面识别 `登录已过期|invalid_grant|401` 等真实调用失败，自动把状态切换为「登录已过期」并提示重新登录；
- 登录按钮改为**始终可用**（未登录=「登录 WPS」，已登录=「重新登录」，CLI/凭证缺失时除外）；
- 重新登录时沿用当前 `grantedScopes`（无历史时用团队默认 scope 集），避免拿到空令牌；
- 登录轮询改为「真实读取一次知识库」判断是否完成，不再只依赖 `status.state === 'logged-in'`；
- 独立页面做同样处理。








---

## 补充确认：这是**企业版**能力，不是个人版（2026-10-19 复核）

### 结论

`wps365-cli` 面向 **WPS 365 企业版**。**个人版 WPS 账号无法获取企业数据**，也无法创建所需的应用。

### 官方依据

1. **WPS 开放平台「成为开发者」**（<https://365.kdocs.cn/3rd/open/documents/app-integration-dev/guide/developer>）原文：

   > WPS 开放平台仅支持以 **WPS 企业账号**身份进行企业自建应用管理、生态服务商认证等对接工作，请先注册 WPS 账号和**企业**。

   应用类型表：

   | 应用类型 | 场景 | 认证要求 |
   |---------|------|---------|
   | **企业自建应用** | 企业内部开发，**仅企业内可使用** | 无需认证 |
   | 第三方企业应用 | 服务商提供给不同租户企业 | 需认证 |
   | 第三方个人应用 | 服务商提供，**仅可对接用户授权类型开放能力** | 需认证 |

   → 即使叫"第三方**个人**应用"，指的也是"服务商的应用类型"，**不是个人版 WPS 用户**。

2. **CLI CHANGELOG v0.3.5** 明确区分两条路线：

   > WorkBuddy 连接器片段…**企业账号** `config init` + `auth login --device` 后接本地 `mcp serve`；与**金山文档个人 MCP（mcp-center）**分开

3. **前置准备文档**：凭证取自「**企业自建应用**」，scope 需**企业管理员**在 work.wps.cn 审批。

### 四个必须确认的坑

| # | 坑 | 后果 | 怎么确认 |
|---|----|------|---------|
| 1 | **账号必须属于应用所属企业**，且在应用「可用范围」内 | 授权成功但数据为空，或直接报"不在可用范围" | `wps365-cli user me` 看返回的组织；后台检查可用范围 |
| 2 | **企业套餐门槛**：官方对接文档写明仅支持 WPS 365 **商业高级版 / 商业企业版 / 教育标准版 / 教育高级版 / 教育旗舰版**；**免费版/体验版在申请权限环节就被拦** | scope 申请提交不了 | WPS 365 管理后台 → 订单权益 → 订单记录 |
| 3 | **成员也需有套餐**：要读取文档的每个成员账号同样需要上述套餐 | 能登录但读不到文档 | 同上，逐个成员看 |
| 4 | **两类错误要分开**：`403000001 / ErrPrivileges`（如 `interface_company_doc`）= **企业套餐权益不足**，不是 OAuth scope 问题；scope 未开通是另一类错误 | 提示错了会让管理员白忙 | 插件错误映射必须区分（见 4.4） |

> 第 2、3 条来自腾讯乐享对接 WPS 云文档连接器的官方文档（<https://cloud.tencent.com.cn/document/product/1831/138287>），与 CLI CHANGELOG 中 `403000001` 的处理口径一致。

### 对规划的影响

- 登录步骤（S2/S3）**必须用企业账号**：`auth login --device` 时在浏览器里用 `@公司域名` 的企业账号授权，不要用个人 WPS 账号。
- 错误映射表（4.4）补一档：**"企业套餐权益不足" ≠ "scope 未开通"**，两种提示的下一步动作完全不同（一个找管理员买套餐，一个找管理员批 scope）。
- 如果将来确实要接**个人版金山文档**，那不是本插件，得走 `mcp-center` 那条独立路线。


---

## 0. 调研来源与一个前提说明

- 你给的链接 <https://365.kdocs.cn/l/cqi8RexYzQKD?source=wiki> 需要 WPS 登录后才能查看，匿名抓取会被重定向到 `passport/singlesign`，因此**其内容我没有读到**。
- 以下结论来自同一体系的公开资料：
  - [WPS365 CLI README](https://raw.githubusercontent.com/cnbm-open/cli/master/README.md)（官方开源仓库，MIT）
  - [前置准备：创建应用与权限配置](https://raw.githubusercontent.com/cnbm-open/cli/master/docs/prerequisites.md)
  - WPS 365 官方 MCP 平台：`https://openapi.wps.cn/mcp/v2/{service}/message`
- **待你确认**：wiki 里的指南是否就是这份 CLI 指南；若是另一套（比如自家企业封装版）请贴关键段落。

---

## 1. 需求拆解

把原话拆成三条硬要求：

| # | 要求 | 技术含义 |
|---|------|---------|
| R1 | "登录人需要**正常登录 WPS**" | 必须走 **delegated（用户授权）身份**，不是 app 身份、不是管理员服务账号。用户用自己的 WPS 账号在浏览器/扫码完成授权 |
| R2 | "根据 WPS **后台的授权**获取内容" | 内容边界 = `应用已开通的 scope` ∩ `应用可用范围/数据权限` ∩ `该用户自身权限`。插件**不做**权限判定，只如实透传与呈现 |
| R3 | "获取登录账户**可以获取的内容**" | 插件把该身份下能读到的内容交给 Agent 使用；越权必须失败，且失败要能解释清楚原因 |

**由此得出两条设计红线：**

1. **插件不实现授权，只承载授权结果。** 一切 token 获取/刷新交给 WPS 侧机制，插件不自行签发或提权。
2. **权限失败必须可解释。** `403 / scope 未开通 / 无数据权限 / 用户不在可用范围` 要映射成"去哪申请、找谁审批"，而不是一句 `error`。

---

## 2. 现状调研结论

### 2.1 wps365-cli 能提供什么

| 维度 | 结论 |
|------|------|
| 形态 | 官方 Go CLI，MIT 开源，单文件二进制，装到 `~/.local/bin` |
| 覆盖 | 9 大业务域、120 条精装命令：日历 / 即时通讯 / 通讯录 / 邮箱 / 云文档 / 智能文档 / 智能表格 / 多维表 / 会议 |
| 兜底 | `wps365-cli api get\|post\|put\|patch\|delete\|head` 可调**任意**开放平台端点 |
| 认证 | `delegated`（用户身份）与 `app`（应用身份）双模式，按 OpenAPI `security` 自动选，`--token-type` 可覆盖 |
| 凭证 | macOS/Windows 存系统钥匙串，Linux 用 AES-256-GCM 加密文件；**明文 secret 不落盘** |
| Token 生命周期 | 过期前 10s 主动刷新；401 透明重试；refresh_token 失效才提示重新登录 |
| 输出 | `-o json / yaml / table / tsv`，脚本友好 |
| 调试 | `--dry-run` 预览请求；`--timeout`；`spec status/update` |

三条起步命令：

```bash
wps365-cli config init          # 首次：打开浏览器完成应用创建/绑定
wps365-cli auth login --device  # 设备码授权（可省略 --scopes）
wps365-cli user me              # 确认当前登录身份
```

### 2.2 授权是怎么"被后台决定"的（关键）

WPS 365 的授权是**两级审批**，这也是 R2 的实现本质：

```
创建企业自建应用 → 拿 client_id / client_secret
        → 注册回调地址（授权码模式需要 http://localhost:18365/callback）
        → 申请 capability scope（如 kso.user_base.read、kso.calendar.read）
        → 创建版本 → 申请发布
        → 企业管理员在 work.wps.cn 审批
        → 审批通过（"已开通"）→ 授权才真正生效
```

**要点**：只申请不发布不审批 = scope 一直是"待提交审核"，接口不生效。部分通讯录接口还需要额外配置「可用范围」和「数据权限」。
`config init` 可以代替手工建应用，但**scope 审批绕不过管理员**（除非管理员预先配了"CLI 应用免审规则"）。

### 2.3 另一条路：WPS 官方 MCP

WPS 侧已经提供按域拆分的 MCP Server：

```
https://openapi.wps.cn/mcp/v2/kso-yundoc/message     # 云文档
https://openapi.wps.cn/mcp/v2/kso-calendar/message   # 日历
https://openapi.wps.cn/mcp/v2/kso-mail/message       # 邮箱
... kso-message / kso-meeting / kso-todo / kso-dbsheet / kso-airpage
```

只要带上 `Authorization: Bearer <delegated token>` 即可调用。这是"零业务代码"的可能路径，但**token 需要有人持续刷新**。

---

## 2.4 实测的 CLI 契约（v0.3.6，非文档推测）

以下均为在 macOS arm64 上对官方二进制实际执行 `--help` / `--version` 得到的真实契约。

### 云文档域（M2 全部能力都在这里）

| 子命令 | 说明 | 关键参数 |
|--------|------|---------|
| `drive list` | 按归属身份分页查询可访问的**盘**列表 | `--allotee-type user\|group\|app`、`--page-size`、`--page-token` |
| `drive doclib list` / `get` | 文档库 / 团队文档 | — |
| `drive file list <drive-id> <parent-id>` | 列子文件与文件夹 | `--page-size`、`--filter-type`、`--filter-exts`、`--order-by`、`--with-permission` |
| `drive file search` | **搜索文件** | `--keyword`、`--type`(默认 all)、`--file-type`、`--file-exts`、`--drive-ids`、`--parent-ids`、`--page-size`、`--page-token`、`--with-permission` |
| `drive file-content get <drive-id> <file-id>` | **文档正文抽取**（M2 核心） | `--format` |
| `drive file download <drive-id> <file-id>` | 获取**下载地址/参数**（注意：不是文件本体，需二次 HTTP 取流） | `--with-hash` |
| `drive recent-file` / `starred-file` / `frequent-file` | 最近 / 收藏 / 常用 | 分页参数 |
| `drive file-version` / `drive link` | 版本 / 分享链接 | — |
| `user me` | 当前登录用户 | `--token-type delegated\|app` |

> 关键细节：**正文抽取和下载是两回事**。`file-content get` 返回内容，`file download` 只返回地址。规划里原先把"下载"理解为拿文件，实测后更正。

### 认证命令（M1 行为契约）

| 命令 | 实测行为 |
|------|---------|
| `auth status -o json` | **直接给结构化 JSON**，字段：`client_id_configured`、`client_secret_configured`、`delegated.available`/`status`、`app.available`/`status`、`config_dir`、`redirect_uri`、`auth_url`、`token_url` → **状态面板的数据契约直接用它，不用解析人话** |
| `auth login --device` | 自动开浏览器，并向 **stderr** 打印 ASCII 二维码；可省略 `--scopes` |
| `auth login`（授权码模式） | **需要交互终端**且必须显式传 `--scopes` → 不适合桌面插件，一律用 `--device` |
| `auth qrcode <url> --ascii` / `--file` | 单独出码；全局 `-o` 是输出格式不是文件路径 |
| `auth token [--app]` | 输出 token 明文（输出格式仍受 `-o` 影响，见下方安全注意） |
| `auth setup --client-id --client-secret` | 写凭证；`--api-base` 可换环境 |

### ⚠️ 实测发现的两个坑（规划必须吸收）

**坑 A：不设可写 `WPS365_CONFIG_DIR`，业务命令会全部消失。**

首次执行时 CLI 试图把 spec 缓存写到 `~/Library/Application Support/wps365-cli`。在受限环境下写入被拒后：

- 只有 8 个基础命令（auth / config / spec / mcp / update …）
- **`drive`、`user`、`calendar`、`mail` 等 9 个业务域命令全部不出现**
- 报错只是一行 `Warning: save ... spec failed`，极易被误判成"未登录"或"版本不对"

对策：`Runner` 必须**显式注入 `WPS365_CONFIG_DIR`** 指向插件可写的目录（或用户主配置目录），并把"命令集缺失"识别为该错误，而不是登录问题。已实测 `WPS365_CONFIG_DIR` 覆盖生效。

**坑 B：`--dry-run` 不能当"无凭证的能力探测"用。**

`--dry-run drive file search` 在未配置凭证时直接失败：

```
⚠ delegated token unavailable, using app identity
prepare dry-run request: resolve auth token: get app token: app credentials not configured
```

因为 dry-run 在构造请求前仍要 resolve token。所以：

- 规划 7 节里"用 `--dry-run` 做能力自检"的设计**作废**
- 能力自检只能在**登录后**发真实只读请求（选最小代价的那种，如 `user me` + 一次 `drive list --page-size 1`）

---

## 3. 架构选型

| 方案 | 做法 | 工作量 | 覆盖度 | 安全 | 结论 |
|------|------|--------|--------|------|------|
| **A. DSH 插件 = CLI 包壳** | 插件 shell out 调 `wps365-cli`，CLI 自己管 token | 低 | 满（120 命令 + api 兜底） | 最高（token 永不进入插件进程） | ✅ **推荐** |
| B. DSH 插件 = 原生 OAuth + REST | 插件自己实现设备码流程、token 存储、刷新、端点封装 | 高 | 需自行维护端点映射 | 中（token 进插件、要自建存储与刷新） | 二期备选 |
| C. 纯 MCP 桥 | `@deepseek-ai/dsh-mcp-client` 直连 WPS MCP，配 `Authorization` 头 | 极低 | 仅 MCP 已开放的域 | 中（token 刷新/泄露面问题） | 作为**补充**，不作为主路径 |

**推荐 A**，理由：

1. **安全边界最干净**——插件进程从头到尾**不接触 token**，只发起子进程调用；`client_secret` 与 token 都留在 WPS CLI 的钥匙串里。方案 B/C 都要把凭证搬进 DSH，泄露面更大。
2. **覆盖度立刻拉满**——`api` 命令让任意开放平台端点可用，不必等我们逐个封装。
3. **官方维护授权链路**——OAuth 流程、刷新、401 重试、spec 更新都由上游负责，我们跟随升级即可。
4. **可渐进**——后续若发现某域 MCP 更好用（如需要流式），再用方案 C 单独补一个 bundle，不动主插件。

**代价与对策**：多一次子进程开销（~50–200ms，可忽略）；CLI 需预装（启动时自检并给安装指引）；stdout 解析有耦合（尽量用 `-o json`，并固定 CLI 大版本）。

---

## 4. 推荐架构（方案 A）细化

### 4.1 分层

```
┌─────────────────────────── DSH Web UI ───────────────────────────┐
│  Client 插件：侧边栏/设置面板                                      │
│   · 登录状态卡片（未装 CLI / 未配置 / 未登录 / 已登录 + 过期时间） │
│   · 设备码 + 二维码 + 授权进度                                     │
│   · 「我的可访问范围」自检结果                                     │
└──────────────────────────────┬───────────────────────────────────┘
                               │ ctx.slots / client-callable Host 入口
┌──────────────────────────────┴───────────────────────────────────┐
│  Host 插件 (index.js)                                            │
│   · ctx.tools 注册工具  ─┐                                        │
│   · 登录/状态服务         ├─→ wps365Runner（唯一出口）             │
│   · 错误映射器           ─┘      │                                │
└──────────────────────────────────┼───────────────────────────────┘
                                   │ child_process.execFile
                        ┌──────────┴──────────┐
                        │  wps365-cli (官方)   │
                        │  钥匙串: secret/token │  ← 凭证只在这里
                        │  自动刷新 / 401 重试  │
                        └──────────┬──────────┘
                                   │ HTTPS + Bearer(delegated)
                        ┌──────────┴──────────┐
                        │ openapi.wps.cn       │  ← 授权判定在服务端
                        └──────────────────────┘
```

### 4.2 插件文件结构（DSH cordis bundle）

```
wps365-plugin/
├── package.json          # 声明 dsh.bundle.patch + dsh.client + icon/meta
├── cordis.patch.yml      # insert: wps365-host 行 + wps365-client 行
├── index.js              # Host 插件：export function apply(ctx, config)
├── client.js             # Client 插件：注册 slot
├── locale/zh.json        # 显示文案（标题/描述/错误提示）
├── locale/en.json
└── icon.svg
```

Host 插件遵守的规则（来自 Harness 插件开发约定）：

- `export function apply(ctx, config)`，所有注册用 `ctx.effect` / `ctx.on` 并返回清理函数；
- 需要的能力放 `inject`（如 `['tools']`），缺失时保持惰性而不是抛错；
- 可调项（CLI 路径、超时、单次输出上限、只读开关）放进 `Config`，用户可在 `cordis.patch.yml` 覆盖；
- 不在会话日志里新增自定义事件类型（会破坏 replay）。

### 4.3 唯一的执行出口 `wps365Runner`

一个小模块，所有工具都经过它，集中处理：

| 关注点 | 做法 |
|--------|------|
| 定位 CLI | 依次找 `WPS365_CLI` 环境变量 → `~/.local/bin/wps365-cli` → `PATH`；找不到返回结构化"未安装"状态 + 安装命令 |
| **配置目录** | 显式注入 `WPS365_CONFIG_DIR`（插件私有可写目录）。**不设会导致业务命令集体消失**，见 2.4 坑 A |
| 调用 | `execFile(cli, args, { timeout, env })`，**绝不拼 shell 字符串**，参数数组传递，避免注入 |
| 输出 | 优先 `-o json`；解析失败时降级为文本并截断 |
| 截断 | 大结果按 `Config.maxOutputChars` 截断并附"已截断，请用分页参数"提示，防止灌爆上下文 |
| 错误映射 | 见 4.4 |
| 只读默认 | `Config.readOnly=true` 时，拦截写类命令（send/create/update/delete）直接拒绝并说明如何放开 |

### 4.4 错误 → 可执行指引的映射表

| WPS 侧返回 | 插件呈现 |
|-----------|---------|
| 未登录 / delegated token 不存在 | "尚未登录 WPS，请在插件面板点『登录』（设备码授权）" |
| refresh_token 过期 | "登录已过期，请重新授权" |
| `insufficient_scope` / 权限类错误 | "当前应用未开通 `<scope>`。需要在 open.wps.cn 应用 → 权限管理申请，并创建版本提交发布，由企业管理员在 work.wps.cn 审批" |
| `403000001` / `ErrPrivileges`（含 `interface_company_doc` 等权益点） | **企业套餐权益不足，不是 scope 问题**："需要企业管理员在 WPS 365 管理后台开通【商业高级版】/【商业旗舰版】；且要读取文档的成员账号也需对应套餐" |
| 通讯录类返回空/权限错误 | "除能力权限外，还需配置『可用范围』与『数据权限』" |
| 用户不在可用范围 | "该账号不在应用的可用范围内，请联系管理员" |
| 429 / 超时 | 指数退避重试 1 次，仍失败则明示 |

### 4.5 为什么 token 不进插件

- 需要 token 的场景只有"直接调 MCP"（方案 C）。届时也**不落盘**：用 `wps365-cli auth token` 在调用瞬间取值注入子进程环境变量，用完即弃，且**绝不写入会话日志/工具结果**。
- 面板只显示**元信息**：是否已登录、过期时间、认证模式、已生效域。不显示 token 本身。

---

## 5. 认证与授权时序

### 5.1 首次开通（人机协作，一次性）

```
用户 → 插件面板「环境自检」
        ├─ 无 CLI      → 面板给出安装命令（curl … install.sh | bash）
        ├─ 无应用凭证  → 引导 `wps365-cli config init`（浏览器建/绑应用）
        └─ 未登录      → 点「登录」→ 设备码流程
                          · 面板显示 user_code + 验证 URL + 二维码
                          · 用户在浏览器用自己的 WPS 账号同意授权
                          · 插件轮询 `auth status` 直到登录成功
        └─ 成功后      → 调用 `user me` 显示当前身份
```

设备码模式**不需要回调地址**，比授权码模式更适合桌面插件（授权码模式需先在后台注册 `http://localhost:18365/callback`）。

### 5.2 日常调用（每次工具调用）

```
Agent: cnbm_docs_search(keyword="季度报告")
  → Runner 执行: wps365-cli -o json drive file search --keyword "季度报告"
  → CLI: 读钥匙串 token → 快过期则刷新 → 注入 Bearer → 请求
  → 服务端按 (用户权限 ∩ app scope ∩ 可用范围) 过滤
  → 返回该账号"确实能看到"的文档列表
  → Runner 截断/裁剪 → 工具结果
```

**关键点**：插件全程没有"能看什么"的判断逻辑——返回什么就是授权允许什么，这正是 R2 想要的语义。

---

## 6. 工具设计（Agent 能力清单）

统一前缀 `cnbm_`，分三层：

### 6.1 环境与身份层

| 工具 | 作用 |
|------|------|
| `cnbm_status` | CLI 是否安装、是否配置凭证、是否登录、过期时间、认证模式、版本 |
| `cnbm_login` | 发起设备码登录，返回 user_code + URL（二维码由面板渲染） |
| `cnbm_logout` | 退出当前用户授权（保留凭证） |
| `cnbm_me` | 当前登录用户信息（姓名/邮箱/部门） |

### 6.2 内容层（云文档，命令已实测对齐）

| 工具 | 实际执行命令 |
|------|-------------|
| `cnbm_docs_drives` | `drive list --allotee-type user --page-size N` |
| `cnbm_docs_search` | `drive file search --keyword K --type all --page-size N [--drive-ids ...]` |
| `cnbm_docs_list` | `drive file list <drive-id> <parent-id> --page-size N [--filter-type ...]` |
| `cnbm_docs_doclib` | `drive doclib list` / `drive doclib get <id>` |
| `cnbm_docs_read` | `drive file-content get <drive-id> <file-id> [--format ...]` ← **核心** |
| `cnbm_docs_download` | `drive file download <drive-id> <file-id>` 取地址 → 再由 Host 走 HTTP 下载到工作区 |
| `cnbm_docs_recent` | `drive recent-file`（另有 `starred-file` / `frequent-file`） |
| `cnbm_docs_link` | `drive link ...`（分享链接） |

所有工具统一追加 `-o json`，并透传 `--token-type delegated`（默认即是）。

后续按需扩：`cnbm_calendar_*`、`cnbm_mail_*`、`cnbm_im_*`、`cnbm_dbsheet_*`、`cnbm_meeting_*`。

### 6.3 兜底层

| 工具 | 作用 |
|------|------|
| `cnbm_api` | 通用端点调用，参数 `{ method, path, data }`。默认限制在 `GET`；写方法需显式 `Config.allowWrite` 或用户确认 |

**工具描述里写明所需 scope**（例如 `cnbm_docs_read` 需要 `kso.yundoc.read` 之类），这样 Agent 在失败时能自动给出正确的申请指引。

---

## 7. UI 面板设计

放在 DSH 侧边栏 / 设置页（用 slot 注册，复用宿主主题 token，不引入任何 Harness Client 包）：

1. **状态区**：CLI 版本、认证模式、登录身份、token 过期倒计时、按钮（登录 / 重新登录 / 退出）
2. **登录区**：user_code 大字显示 + 可点 URL + 二维码 + "已授权"自动跳转
3. **能力自检区**：**登录后**对每个域发一次**轻量只读**请求（`--dry-run` 不可用于无凭证探测，见 2.4 坑 B），用绿/黄/红标注：
   - 绿 = 该账号现在能访问
   - 黄 = 无权限（附：需要哪个 scope、去哪申请）
   - 红 = 技术故障
   > 自检必须只读、可取消、结果可缓存，避免每次都打一堆请求。
4. **审计提示**：明示"所有调用以你的 WPS 身份发生，可被企业审计"。

UI 与 Agent 工具**复用同一个 Host 服务方法**（一份实现两个调用方），不做两套逻辑。

---

## 8. 安全与合规

| 项 | 措施 |
|----|------|
| 凭证 | `client_secret`/token 只存 WPS CLI 钥匙串；插件不读、不写、不日志 |
| 注入 | `execFile` 参数数组，禁 shell 拼接；不把用户输入拼进命令行 |
| 最小权限 | 工具默认只读；写操作需显式配置 + 用户确认 |
| 越权 | 不实现任何重试/降级绕过 403 的逻辑 |
| 数据外发 | 内容进入模型上下文即离开本机——企业内使用需确认合规（这点要向管理员讲清） |
| 退出 | 提供 `cnbm_logout`；文档说明如何 `auth clean` 彻底清理 |
| 审计 | 每次调用在 DSH 会话日志中留痕（工具名 + 参数），与 WPS 侧服务端日志可对照 |

---

## 9. 分期实施与验收标准

| 阶段 | 内容 | 验收标准（可观测） |
|------|------|-------------------|
| **M0 环境准备** | 装 CLI、建/绑应用、申请 scope、管理员审批 | `wps365-cli user me` 返回真实用户；目标 scope 状态为"已开通" |
| **M1 插件骨架 + 鉴权** | bundle 打包、Runner、`cnbm_status/login/logout/me`、错误映射 | 面板显示正确登录状态；未登录时工具返回可执行指引；杀掉 CLI 后显示"未安装" |
| **M2 内容工具** | 云文档搜索/列表/正文/下载 | 用真实账号搜到并读到一篇自己有权限的文档；换一个无权限文档 → 返回明确的权限指引而非裸错误 |
| **M3 UI 面板** | 状态卡片 + 设备码 + 二维码 + 能力自检 | 从"未登录"到"已登录"全程在面板内完成，不需要手动敲命令；深浅色主题下与宿主一致 |
| **M4 扩展** | 日历/邮件/IM/多维表；可选 MCP 桥；写操作开关 | 每个新增域都有对应的只读工具 + 独立验收 |

---

## 10. 风险与未决项

| 风险 | 影响 | 对策 |
|------|------|------|
| **`WPS365_CONFIG_DIR` 未设/不可写** | 业务命令全部消失，被误判成"未登录"（实测坑 A） | Runner 强制注入可写配置目录；把该 Warning 单独识别成 `spec-unavailable` 错误态 |
| **`--dry-run` 被误当作无凭证探测** | 自检流程在登录前必然失败（实测坑 B） | 自检只在登录后跑；登录前只做文件存在性 + `auth status` 检查 |
| **应用/scope 审批卡在管理员** | 阻塞 M2 之后所有验收 | M0 提前做；先申请最小 scope 集；准备"免审规则"说明给管理员 |
| CLI stdout 格式变化 | 解析脆弱 | 只用 `-o json` + 锁定 CLI 大版本 + 解析失败降级为文本 |
| 设备码轮询与 CLI 进程生命周期 | 登录可能挂住 | 用带超时的子进程 + 面板轮询 `auth status`，超时可取消 |
| 大列表/大文档撑爆上下文 | 体验差、成本高 | 统一截断策略 + 分页参数 + 明确"已截断"提示 |
| DSH 安装 bundle 需要审批 / 我当前工具集不含 `plugin_manager` | 我可能无法自行安装 | 见第 11 节 Q4；不行就由你在侧边栏「Plugins」面板安装 |
| 企业数据合规 | 可能被安全部门叫停 | 一页说明文档：数据流向、审计能力、退出方式 |
| **团队成员的套餐档位不一致** | 部分人可用、部分人报权益错误，排障成本高 | 上线前先要一份全员套餐清单；插件把 `403000001` 单独识别（见 12.6） |
| **`client_secret` 分发失控** | 密钥外泄，需全员轮换 | 走策略 A（每人自填 + 密码管理器发放）；提供"重新填写"入口（见 12.4） |
| **成员未被纳入应用可用范围** | 登录成功但数据全空，易误判为 bug | 面板做团队级预检并给出诊断码（见 12.5 第 5 条） |

---

## 11. 开工顺序（决策已闭环）

| 步骤 | 动作 | 谁做 | 完成判据 |
|------|------|------|---------|
| S1 | 安装 `wps365-cli` | 你（或我在你授权后） | `wps365-cli --version` 有输出 |
| S2 | `wps365-cli auth setup` 写入 `client_id`/`client_secret` | 你（涉密，不经过对话） | `auth status` 显示已配置凭证 |
| S3 | `wps365-cli auth login --device` 登录 | 你 | `user me` 返回真实姓名/邮箱 |
| S4 | 确认云文档 scope 实际可用 | 我（只读探测） | 搜到一篇有权限的文档 |
| S5 | 写 M1 插件骨架（bundle + Runner + 鉴权工具） | 我 | 面板/工具能正确报告登录状态 |
| S6 | 写 M2 云文档工具 | 我 | 见第 9 节 M2 验收 |

**S2/S3 请你自己在终端执行**——`client_secret` 不应经过对话或工具调用（会进会话日志）。S1 我可以在你授权后执行，装完无需 sudo。

---

## 12. 团队共享方案（2026-10-19 追加）

### 12.1 先把"共享"拆成三件不同的事

| 层 | 内容 | 能否共享 | 说明 |
|----|------|---------|------|
| **L1 插件代码** | bundle 包、patch、Runner | ✅ 完全可共享 | 就是一份普通 npm 包 |
| **L2 应用身份** | `client_id` / `client_secret` / scope | ⚠️ 共享，但有讲究 | 应用是**企业级**的，天生一个团队共用 |
| **L3 用户身份** | delegated access/refresh token | ❌ **绝对不能共享** | token 是**个人身份凭证**，共享即冒用 |

**核心结论：团队共享 = 共享 L1 + L2，每人各自持有自己的 L3。**

这恰好就是 R2 想要的语义——**同一个人装同一个插件，登录自己账号，看到的是自己的授权范围**。这既是需求，也是合规要求。

### 12.2 反模式（必须明确排除）

> "管理员登录一次，把 token 发给全组用"

不行，三个原因：
1. **审计归属错位**：WPS 服务端所有调用都记在这个人名下，团队操作变成他个人行为；
2. **权限失真**：全组拿到的是管理员的视野，不是各自的权限，直接违背"登录账户可以获取的内容"；
3. **凭证失控**：refresh_token 一扩散就无法回收，只能整体 `auth clean` + 重新授权。

> 若确实需要"以应用身份读全企业文档"（不随人变），那是 **app token + `--token-type app`** 的另一条路径，需要管理员授予 app 类型权限（如 `interface_company_doc` 权益点），**不属于本插件的团队共享方案**，需单独决策。

### 12.3 分发通道（DSH 原生支持，按推荐度排序）

| 通道 | 安装方式 | 优点 | 缺点 | 建议 |
|------|---------|------|------|------|
| **内网 Git 仓库** | `install_bundle` 传 git 地址 | 可 code review、可追溯、零额外基础设施 | 需 Git 访问权限 | ✅ **首选** |
| **私有 npm registry** | registry 包名 | 版本管理规范、升级最顺 | 要维护 registry | 规模化后升级到此 |
| **tarball（`.tgz`）** | 本地/内网路径 | 零基础设施 | 手工升级 | 小团队过渡 |
| **本地目录** | 绝对路径 | 最快验证 | 每人手工拷贝 | 仅试点 |

配套：bundle 里声明 `icon` + `locale/*.json`（`meta.title` / `meta.description`），这样在插件管理页能正常显示中文标题，否则会回退成包名。

### 12.4 `client_secret` 的三种策略（必须选一个）

`auth setup` 实测强制要求 `client_id` 与 `client_secret` 同时提供，绕不过去：

| 策略 | 安全 | 便利 | 做法 | 推荐度 |
|------|------|------|------|--------|
| **A. 每人自填（一次）** | 高 | 中 | 插件面板引导输入 → 直接写入本机 CLI 钥匙串；secret 不进代码库、不进对话 | ✅ **推荐** |
| **B. 包内预置** | 低 | 高 | 把 secret 写进 bundle 的 patch/config | ❌ 不推荐：包一旦外泄即事故；且 `cordis.patch.yml` 是明文 |
| **C. 服务端 broker** | 高 | 中 | 内部服务持 secret，成员走 OAuth 换个人 token | 安全但工作量大，架构升级，二期再议 |

**策略 A 的落地要点**：
- secret 由管理员通过**密码管理器 / 一次性链接**发放，不走群聊、不走 Git；
- 插件面板明确文案："这是**团队共享应用**的密钥，向管理员获取，只需填一次"；
- 填完立即写入 CLI 钥匙串，插件**不回显、不记录、不写入会话日志**；
- 提供"重新填写"入口，方便密钥轮换（后台重置后全员需重填）。

### 12.5 为"团队友好"要额外做的 6 处改造

1. **`Config.clientId` 可配置**：bundle patch 里预填团队统一的 App ID（client_id 不敏感），成员只需补 secret。
2. **secret 永不入包**：patch 里只允许出现 client_id；代码里禁止任何 secret 默认值。
3. **CLI 版本自检**：`wps365-cli --version` 低于 0.3.6 时给出明确升级指引（命令面在版本间有差异）。
4. **配置目录隔离**：`WPS365_CONFIG_DIR` 按用户隔离（插件私有目录），避免与个人其它配置串味。
5. **团队级预检**：登录后除 `user me` 外，额外检查"是否在应用可用范围内"，并给出管理员可读的诊断码。
6. **可观测的失败分类**：把"未安装 CLI / 配置目录不可写 / 未配置凭证 / 未登录 / 不在可用范围 / 套餐权益不足 / scope 未开通"做成 7 个明确状态，团队排障时一眼定位。

### 12.6 三个非技术前置（团队落地真正会卡的地方）

| 前置 | 谁负责 | 不满足的后果 |
|------|--------|-------------|
| 应用「可用范围」纳入**全体成员** | 应用管理员 | 成员登录成功但数据为空 |
| 每个成员账号都有**商业高级版及以上**套餐 | 企业管理员 | 部分成员读不到文档，且报的是权益错误 |
| 企业 IT / 安全知晓**数据流向** | 团队负责人 | 可能被合规叫停（内容会进入模型上下文） |

> scope 只需**应用级申请一次**，全团队共用——这是团队共享最大的收益。

### 12.7 各成员的实际操作（三行）

```bash
# 1. 装 CLI（一次性）
curl -fsSL https://open-docs.wpscdn.cn/cli/install.sh | bash
# 2. 填团队 App ID + 向管理员要的 secret（一次性）
wps365-cli auth setup --client-id <团队AppID> --client-secret <向管理员获取>
# 3. 用自己的企业账号登录（每次换机时）
wps365-cli auth login --device
```

之后插件里的所有工具都以**这个人自己的身份**执行。

### 12.8 关于"我能不能帮你装"

实测确认：`plugin_manager` 工具**仅在 Creator 模式启用**，其他预设默认禁用——本会话是 standard 预设，所以我当前没有该工具，无法代你 `install_bundle`。两条路：

- 你在**侧边栏 → 插件**页手动安装（传入 git 地址 / tarball / 本地目录）；
- 或切到 **Creator 预设**后我就可以代装（每次操作仍需你批准）。

---

## 附：M1 大概会写成什么样（示意）

```js
// index.js（Host 插件骨架）
export const name = 'wps365'
export const inject = ['tools']
export const Config = {
  cliPath: { type: 'string', default: '' },        // 空则自动探测
  timeoutMs: { type: 'number', default: 30000 },
  maxOutputChars: { type: 'number', default: 20000 },
  readOnly: { type: 'boolean', default: true },
}

export function apply(ctx, config) {
  const runner = createRunner(ctx, config)   // 唯一的 CLI 出口

  ctx.effect(() => ctx.tools.register({
    name: 'cnbm_status',
    description: '检查 wps365-cli 安装/凭证/登录状态及其过期时间。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() { return runner.status() },
  }))

  // cnbm_me / cnbm_login / cnbm_docs_search … 同形
}
```

（真实实现前会先用 `cordis_inspect_query` 核对当前 Harness 的 `ctx.tools`、`Config`、slot 与 `ctx.authorization` 的**确切**签名，不靠记忆写 API。）
