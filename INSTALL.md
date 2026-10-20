# cnbm知识库安装手册（DSH）

以**当前登录人身份**读取 WPS 365 知识库与云文档。插件本身不做权限判断，可见范围完全由
WPS 后台授权决定（应用 scope ∩ 可用范围 ∩ 个人权限）。

| 项 | 值 |
|---|---|
| 插件显示名 | cnbm知识库 |
| 插件包名 | `@local/dsh-wps365`（技术标识不变） |
| 当前版本 | `1.2.1` |
| 安装包 | `dist/local-dsh-wps365-1.2.1.tgz`（35,361 字节） |
| SHA-256 | `15c9c6c4fa755e6a557ac4228d5469507a0ad257c4a38803747a525dd5de79cf` |
| 适用环境 | DeepSeek Harness 0.2.x（desktop profile） |
| 依赖 | 官方 `wps365-cli` ≥ 0.3.6 |

> 校验和以仓库 `dist/SHA256SUMS` 为准；版本升级后请同步更新本文档。

## 一、前置条件（团队一次性，个人一次）

| 条件 | 说明 |
|---|---|
| WPS 365 企业账号 | 个人版账号拿不到企业数据 |
| 企业套餐 | 商业高级版 / 商业企业版 / 商业旗舰版 / 教育标准版及以上；免费版、体验版申请权限时会被拦 |
| 企业自建应用 | 已有 `App ID`（团队共享，不敏感）与 `App Secret`（每人单独向管理员获取） |
| 已开通 scope（**用户授权类型**） | 本团队当前开通：`kso.wiki.readwrite`、`kso.user_base.read`、`kso.file.read`；`kso.drive.readwrite` 未开通，因此「列云盘 / 列目录」类工具不可用，知识库与读正文链路正常 |
| 应用「可用范围」包含该成员 | 否则登录成功但数据为空 |
| 已安装 `wps365-cli` | 见下一步 |

## 二、安装 CLI（每台机器一次）

```bash
# macOS / Linux
curl -fsSL https://open-docs.wpscdn.cn/cli/install.sh | bash

# Windows PowerShell
irm https://open-docs.wpscdn.cn/cli/install.ps1 | iex

wps365-cli --version    # 应 ≥ 0.3.6
```

## 三、安装插件（三选一）

### 方式 A：内网 Git（推荐）

```bash
dsh plugin --profile desktop add git+https://<内网Git地址>/dsh-wps365.git
```

> 仓库地址与版本标签由管理员维护；升级时重新执行 add 或按内网 Git 的 tag 更新。

### 方式 B：安装包（tarball）

从内网 Git 的 Release 附件（或内网文件盘）取得 `local-dsh-wps365-1.2.1.tgz`，先校验：

```bash
shasum -a 256 local-dsh-wps365-1.2.1.tgz
# 应为 15c9c6c4fa755e6a557ac4228d5469507a0ad257c4a38803747a525dd5de79cf
```

然后安装：

```bash
dsh plugin --profile desktop add ./local-dsh-wps365-1.2.1.tgz
```

### 方式 C：私有 npm 源

```bash
dsh plugin --profile desktop add @your-scope/dsh-wps365@1.2.1
```

安装完成后**完全退出并重开 DeepSeek Harness**（Host 工具可热更新，客户端面板与源码必须重启才加载）。
重开后：

- 侧栏出现「cnbm知识库」图标 → 点击进入中央面板（状态 / 登录 / 知识库 / 搜索 / 读正文）；
- 会话工具集中出现 15 个 `wps365_*` 工具。

## 四、配置应用凭证与登录（每人一次）

```bash
# 1) 写入应用凭证：App ID 团队共享；App Secret 向管理员单独领取
wps365-cli auth setup --client-id <团队AppID> --client-secret <向管理员获取>

# 2) 设备码登录（用【企业账号】在浏览器确认）
wps365-cli auth login --device --scopes kso.wiki.readwrite,kso.user_base.read,kso.file.read

# 3) 验证
wps365-cli user me     # 应返回你的姓名 / 企业
```

也可以装好插件后，在面板里点「登录 WPS」，或让 Agent 调用 `wps365_login`。

> 已有令牌不会自动获得新 scope；scope 变更后必须重新登录。
> `App Secret` 不要发群聊、不要提交到 Git、不要写入知识库。

## 五、Scope 与能力对照

| scope | 解锁能力 |
|---|---|
| `kso.wiki.readwrite` | 知识库列表 / 节点树 / 元信息 / 搜索（含正文高亮片段） |
| `kso.user_base.read` | `wps365_me` |
| `kso.file.read` | `wps365_wiki_read`、`wps365_docs_read`（完整正文） |
| `kso.drive.readwrite` | 云盘列表 / 目录浏览 / 下载地址（本团队暂未开通） |

## 六、验证清单

1. 面板状态卡显示「已登录」，scope chips 含上述三项；
2. 知识库列表能列出「信云智联企业知识库」「AI事业部知识库」等；
3. 点开任一文档能读到完整 Markdown 正文；
4. 搜索 `方案` 等关键字能返回带高亮片段的结果；
5. 会话中调用 `wps365_status` 返回 `state: logged-in`。

## 七、排障（状态 → 动作）

| 状态 | 含义 | 下一步 |
|---|---|---|
| `cli-missing` | 没装 wps365-cli | 执行第二步 |
| `spec-unavailable` | 业务命令全部消失（配置目录不可写） | 设置 `configDir` 指向可写目录 |
| `credentials-missing` | 没配 App ID / Secret | 执行 `auth setup` |
| `not-logged-in` | 没登录或已过期 | 面板点「登录 WPS」或 `auth login --device` |
| `logged-in-but-scopeless` | 登录成功但令牌零权限（假象） | 开放平台申请 scope（用户授权类型）→ 发布 → 管理员审批 → 重新登录 |
| `scope-missing` | 应用未开通所需 scope | 同上；工具会直接指出缺哪个 |
| `entitlement-missing`（`403000001`） | 企业套餐权益不足，**不是 scope 问题** | 找管理员开通商业高级版/旗舰版；成员账号也需对应套餐 |
| `out-of-range` | 账号不在应用可用范围 | 应用管理员把成员纳入「可用范围」 |

## 八、升级、回滚、卸载

```bash
# 升级（Git 方式）：拉新 tag 后重新 add
dsh plugin --profile desktop add git+https://<内网Git地址>/dsh-wps365.git

# 升级（tarball 方式）：覆盖安装新版本包，然后完全重启
dsh plugin --profile desktop add ./local-dsh-wps365-<新版本>.tgz

# 卸载
dsh plugin --profile desktop remove @local/dsh-wps365
# 或：设置 → 插件 → 找到「cnbm知识库」→ 卸载，然后重启
```

回滚：保留旧版本 tarball 与 `dist/SHA256SUMS`，安装旧版本即可；回滚后同样需要重启。

## 九、安全与团队约定

- **共享**：插件代码、`App ID`、scope 申请（应用级一次，全团队复用）。
- **不共享**：`App Secret`（每人自填）、用户 token（每人各自登录）。
- **反模式**：管理员登录一次把 token 发给全组——WPS 审计会全部记在该个人名下，且权限失真。
- 插件进程不接触 token：所有请求由 CLI 带系统钥匙串里的凭证发出；`execFile` 参数数组传递，无 shell 拼接。
- 默认只读；写操作需要同时显式配置 `readOnly: false` 与 `allowWrite: true`。

## 十、相关位置

| 内容 | 位置 |
|---|---|
| 源码仓库 | 内网 Git（本机工作副本：`wps365-plugin/`） |
| 安装包与校验和 | 仓库 `dist/`（随内网 Git Release 分发） |
| 发布流程 | `RELEASING.md` |
| 知识库索引 | 插件库文档《DSH 插件库索引》 |
