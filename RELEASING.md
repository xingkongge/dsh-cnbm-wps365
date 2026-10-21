# 发版与团队分发（本地工作流）

本仓库同时承担两个角色：**源码仓库**（最终推送到内网 Git）和**本地发版工作区**。
安装包不进 Git，放在本地 `dist/`，通过内网 Git 的 Release 附件分发。

## 目录约定

```
wps365-plugin/                 ← 源码仓库（git init 后推送内网 Git）
├── index.js / client.js / lib/ / locale/ / test/   ← 源码与测试
├── INSTALL.md                 ← 安装手册（知识库直接粘贴这一份）
├── RELEASING.md               ← 本文档
├── scripts/release.mjs        ← 打包 + 归档 + SHA-256
├── dist/                      ← 安装包归档（.gitignore，随 Release 分发）
│   ├── cnbm-dsh-wps365-2.0.0.tgz
│   └── SHA256SUMS
└── .tools/ .wpscfg/ .backup/  ← 本机验证用，不入库
```

约定：

- **源码**：Git 管理，打语义化 tag（`v1.2.0`）。
- **安装包**：只进 `dist/` 与 Release 附件，绝不提交到 Git（二进制不适合版本库）。
- **校验和**：`dist/SHA256SUMS` 累积所有版本，一行一个。
- **知识库**（插件库）：只放索引与安装手册，不放二进制（知识库文档是 Markdown）。

## 每次发版清单

1. **改版本号**：`package.json` 的 `version`（如 `1.2.0` → `1.2.1`）。
2. **跑测试**：`node --test test/`（当前 42 项，含真实 CLI 端到端）。
3. **打安装包**：

   ```bash
   node scripts/release.mjs
   # 也可指定包管理器：node scripts/release.mjs --pack-cmd npm
   ```

   产物：`dist/cnbm-dsh-wps365-<version>.tgz` + `dist/SHA256SUMS`，脚本会打印新的 SHA-256。

4. **自检**：解包目录能 `import`，`client.js` 语法通过：

   ```bash
   TMP=$(mktemp -d) && tar -xzf dist/cnbm-dsh-wps365-<version>.tgz -C "$TMP" \
     && (cd "$TMP/package" && node -e "import('./index.js').then(()=>console.log('ok'))" && node --check client.js) \
     && rm -rf "$TMP"
   ```

5. **同步文档里的校验和**：
   - `INSTALL.md` 的版本、文件名、SHA-256；
   - 工作区 `PLUGINS.md`（本地索引）；
   - 知识库《DSH 插件库索引》（版本 + SHA-256 + 安装包名）。
6. **提交与打 tag**：

   ```bash
   git add -A
   git commit -m "release: v<version>"
   git tag -a v<version> -m "cnbm知识库 v<version>"
   ```

7. **推内网 Git**（首次需加 remote）：

   ```bash
   git remote add origin git@<内网Git>:<组>/dsh-wps365.git
   git push -u origin main --tags
   ```

8. **建 Release / 上传附件**：把 `dist/cnbm-dsh-wps365-<version>.tgz` 与
   `dist/SHA256SUMS` 作为附件上传到该 tag 的 Release（Gitea/GitLab/内部制品库均可）。
9. **通知团队**：发内网 Git 链接 + 安装手册文档链接；`App Secret` 走管理员单独发放。

> 客户端（`client.js`）改动、Host 源码改动都需要成员**完全退出并重开 DSH** 才会加载；
> 只有首次安装新 bundle 时 Host 工具才可能经 HMR 立即出现。

## 回滚

安装包按版本保存在 `dist/` 且 SHA-256 可查，回滚就是重新安装旧版本包并重启：

```bash
dsh plugin --profile desktop add ./dist/local-dsh-wps365-<旧版本>.tgz
```

## 团队分享边界

| 层 | 内容 | 共享方式 |
|---|---|---|
| L1 插件代码 | 仓库源码、安装包 | 内网 Git + Release 附件 |
| L2 应用身份 | `App ID`、scope | 应用级一次配置；`App ID` 可随手册公开 |
| L3 用户身份 | `App Secret`、用户 token | **每人自持**；secret 由管理员单独发放，token 各自登录获取 |
