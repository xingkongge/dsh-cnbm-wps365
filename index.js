/**
 * cnbm知识库（WPS 365） Host 插件。
 *
 * 能力边界：本插件不实现授权、不做权限判定。它只把"当前登录人的身份"
 * 通过官方 wps365-cli 发到 WPS 服务端，服务端返回什么就是该账号被授权
 * 可见的内容。越权必然失败，失败会被翻译成可执行的下一步动作。
 *
 * 工具分两组：
 *   - 云文档（drive/file）：需要 kso.drive.readwrite / kso.file.* 等
 *   - 知识库（wiki）：需要 kso.wiki.readwrite
 * 调用前会用令牌里的 granted_scopes 做前置检查，避免把 403 直接抛给用户。
 */
import {
  DEFAULTS,
  authNeedsLogin,
  checkScope,
  classifyFailure,
  extractDevicePrompt,
  isWriteCommand,
  probeBusinessCommands,
  readAuthStatus,
  resolveCliPath,
  runCli,
  runCliJson,
  startDeviceLogin,
  truncate,
} from './lib/runner.js'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerWebUi } from './lib/ui.js'

export const name = 'cnbm-knowledge'
export const inject = ['tools']

/** 统一的文本型工具结果声明。 */
const TEXT_OUTPUT = Object.freeze({
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
})

/** 插件按此版本的命令面编写；低于它可能缺命令或参数。 */
const MIN_CLI_VERSION = '0.3.6'

/** 语义化版本比较，返回 -1/0/1。 */
function compareVersion(a, b) {
  const pa = String(a).split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1
    if (pa[i] < pb[i]) return -1
  }
  return 0
}

/** 各能力所需的 scope 集合（满足其一即可）。 */
const SCOPE_USER = ['kso.user_base.read']
const SCOPE_DOCS = [
  'kso.drive.readwrite',
  'kso.file.read',
  'kso.file.readwrite',
  'kso.mcp_yundoc.readwrite',
  'kso.mcp_airpage.readwrite',
]
const SCOPE_WIKI = ['kso.wiki.readwrite']

export function apply(ctx, rawConfig = {}) {
  const config = { ...DEFAULTS, ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {}) }
  const login = { current: null }

  // ── 授权过期自动重登 ────────────────────────────────────────────
  // 实测：refresh token 可能失效（invalid_grant: not_found），此时 auth status 仍报
  // delegated.available=true / status=expired。任何工具一旦探测到，自动拉起设备码登录，
  // 并把验证地址与用户码直接返回给调用方，用户只需在浏览器确认一次。
  const DEFAULT_LOGIN_SCOPES = [
    'kso.wiki.readwrite',
    'kso.user_base.read',
    'kso.file.read',
    'kso.file.readwrite',
    'kso.dbsheet.readwrite',
  ]
  const autoLogin = { lastScopes: null, lastStartedAt: 0, lastPrompt: null, lastQr: null }

  const needsLogin = (auth) => authNeedsLogin(auth)

  // 后台保持令牌新鲜：剩余 < 15 分钟且有 refresh token 时静默续期
  ctx.effect(() => {
    const tick = async () => {
      try {
        const cli = resolveCliPath(config)
        if (!cli) return
        const auth = await readAuthStatus(cli, config)
        if (!auth.ok) return
        const d = auth.delegated || {}
        const remain = Number(d.remaining_seconds) || 0
        if (d.has_refresh && (d.status !== 'valid' || remain < 900)) {
          await runCli(cli, ['auth', 'refresh', '--delegated', '-o', 'json'], config)
        }
      } catch { /* 后台失败静默，下次工具调用仍会处理 */ }
    }
    const timer = setInterval(tick, 10 * 60 * 1000)
    setTimeout(tick, 30 * 1000).unref?.()
    return () => clearInterval(timer)
  })

  function loginScopes() {
    if (config.loginScopes) return String(config.loginScopes)
    const granted = autoLogin.lastScopes
    return (granted && granted.length ? granted : DEFAULT_LOGIN_SCOPES).join(',')
  }

  function loginInfo() {
    const pending = login.current
    if (!pending) return null
    const prompt = extractDevicePrompt(pending.output)
    return {
      pending: pending.exitCode === null,
      url: prompt.url || '',
      userCode: prompt.userCode || '',
      startedAt: pending.startedAt,
      exitCode: pending.exitCode,
      qr: autoLogin.lastQr && autoLogin.lastQr.url === prompt.url ? autoLogin.lastQr.data : '',
    }
  }

  function loginPromptBlock(result) {
    if (!result || result.disabled) return ''
    const prompt = result.prompt || autoLogin.lastPrompt || {}
    const lines = [
      result.reused
        ? '🔐 WPS 授权已失效，自动重登正在进行中：'
        : '🔐 WPS 授权已失效，已自动发起重新登录（浏览器应已自动打开）：',
      prompt.url ? `验证地址：${prompt.url}` : '',
      prompt.userCode ? `用户码：${prompt.userCode}` : '',
      '请用【企业账号】在浏览器确认授权；完成后重新调用本工具即可，无需再手动登录。',
    ]
    return lines.filter(Boolean).join('\n')
  }

  /** 把验证 URL 生成为 PNG data URL（扫码用），失败返回空串。 */
  async function makeQr(url) {
    if (!url) return ''
    if (autoLogin.lastQr && autoLogin.lastQr.url === url) return autoLogin.lastQr.data
    try {
      const cli = resolveCliPath(config)
      if (!cli) return ''
      // CLI 要求 --file 相对当前工作目录，写入后用绝对路径读回
      const name = `.cnbm-qr-${Date.now()}.png`
      const res = await runCli(cli, ['auth', 'qrcode', url, '--file', name, '--size', '320'], config)
      if (!res.ok) return ''
      const file = path.resolve(process.cwd(), name)
      const data = `data:image/png;base64,${(await readFile(file)).toString('base64')}`
      await unlink(file).catch(() => {})
      autoLogin.lastQr = { url, data }
      return data
    } catch { return '' }
  }

  /** 复用进行中的登录进程，或新起一个设备码登录；返回 {pending,reused,prompt} */
  async function ensureRelogin(scopes) {
    if (config.autoRelogin === false) return { disabled: true }
    const cli = resolveCliPath(config)
    if (!cli) return { error: 'cli-missing' }
    const pending = login.current
    const grace = config.loginTimeoutMs ?? DEFAULTS.loginTimeoutMs
    if (pending && pending.child && pending.exitCode === null && Date.now() - pending.startedAt < grace) {
      const prompt = extractDevicePrompt(pending.output)
      autoLogin.lastPrompt = prompt
      return { pending: true, reused: true, prompt }
    }
    const requested = scopes || loginScopes()
    const state = startDeviceLogin(cli, config, { scopes: requested })
    login.current = state
    autoLogin.lastStartedAt = state.startedAt
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const prompt = extractDevicePrompt(state.output)
    autoLogin.lastPrompt = prompt
    if (prompt.url) await makeQr(prompt.url)
    return { pending: state.exitCode === null, reused: false, prompt, scopes: requested }
  }

  function clearSettledLogin(auth) {
    const pending = login.current
    if (!pending) return
    if (pending.exitCode !== null || (auth && !needsLogin(auth))) login.current = null
  }

  // 插件卸载时确保没有遗留的登录子进程
  ctx.effect(() => () => {
    const pending = login.current
    if (pending && pending.child && !pending.settled) pending.child.kill('SIGTERM')
  })

  const register = (definition) => ctx.tools.register(definition)

  function guardScope(auth, anyOf) {
    const missing = checkScope(auth, anyOf)
    if (!missing) return null
    return `⛔ ${missing.title}\n\n${missing.hint}`
  }

  // CLI 版本只探测一次并缓存，避免每次工具调用都多一次子进程
  let cliVersionCache = null

  async function ensureCliVersion(cli) {
    if (cliVersionCache !== null && cliVersionCache.cli === cli) return cliVersionCache
    const result = await runCli(cli, ['--version'], config, { timeoutMs: 10_000 })
    const text = `${result.stdout || ''} ${result.stderr || ''}`
    const match = /(\d+\.\d+\.\d+)/.exec(text)
    cliVersionCache = match
      ? { cli, version: match[1], ok: compareVersion(match[1], MIN_CLI_VERSION) >= 0 }
      : { cli, version: 'unknown', ok: true }
    return cliVersionCache
  }

  // ── 公共前置检查 ────────────────────────────────────────────────
  async function preflight({ signal, scopes } = {}) {
    const cli = resolveCliPath(config)
    if (!cli) {
      return {
        ok: false,
        text: [
          '❌ 未安装 wps365-cli',
          '',
          '安装（macOS / Linux）：',
          '  curl -fsSL https://open-docs.wpscdn.cn/cli/install.sh | bash',
          '',
          'Windows PowerShell：',
          '  irm https://open-docs.wpscdn.cn/cli/install.ps1 | iex',
        ].join('\n'),
      }
    }
    const version = await ensureCliVersion(cli)
    if (!version.ok) {
      return {
        ok: false,
        text: [
          `⚠️ wps365-cli 版本过低：${version.version}（本插件要求 ≥ ${MIN_CLI_VERSION}）`,
          '',
          '升级：curl -fsSL https://open-docs.wpscdn.cn/cli/install.sh | bash',
          '或：wps365-cli update',
        ].join('\n'),
      }
    }
    let auth = await readAuthStatus(cli, config)
    // 令牌过期但 refresh token 仍有效时，先静默刷新，避免每次都弹登录
    if (auth.ok && needsLogin(auth) && auth.delegated && auth.delegated.has_refresh) {
      const refreshed = await runCli(cli, ['auth', 'refresh', '--delegated', '-o', 'json'], config)
      if (refreshed.ok) auth = await readAuthStatus(cli, config)
    }
    if (!auth.ok) {
      return {
        ok: false,
        text: auth.reason === 'cli-missing'
          ? '❌ wps365-cli 无法执行（路径存在但没有执行权限，或架构不匹配）。'
          : '❌ 无法读取认证状态，原始输出：\n' + truncate(auth.raw?.stderr || auth.raw?.stdout || '', 2000),
      }
    }
    if (auth.grantedScopes) autoLogin.lastScopes = auth.grantedScopes
    if (needsLogin(auth)) {
      if (!auth.clientIdConfigured || !auth.clientSecretConfigured) {
        return {
          ok: false,
          text: '⚠️ 未配置应用凭证，无法自动重登。\n\n下一步：wps365-cli auth setup --client-id <团队AppID> --client-secret <向管理员获取>',
        }
      }
      clearSettledLogin(auth)
      // 自动重登统一沿用「已授予 scope」全集，避免只申请当前工具所需权限而丢 scope
      const relogin = await ensureRelogin()
      const block = loginPromptBlock(relogin)
      return {
        ok: false,
        text: block
          ? `⚠️ WPS 登录已失效（${auth.delegated.status}）。\n\n${block}`
          : '⚠️ 尚未登录 WPS。\n\n下一步：调用 cnbm_login，用企业账号完成设备码授权。',
      }
    }
    clearSettledLogin(auth)
    if (scopes) {
      const blocked = guardScope(auth, scopes)
      if (blocked) return { ok: false, text: blocked }
    }
    return { ok: true, cli, auth }
  }

  /** 执行一条读取类 CLI 命令并把结果格式化为文本。 */
  async function execRead(cli, auth, args, { signal, parse = true } = {}) {
    if (config.readOnly && !config.allowWrite && isWriteCommand(args)) {
      return [
        '⛔ 当前为只读模式，已拒绝写操作：' + args.join(' '),
        '',
        '需要写权限时，在 profile 的 cordis.patch.yml 里设置 config.readOnly=false 与 config.allowWrite=true。',
      ].join('\n')
    }
    const full = parse ? [...args, '-o', 'json'] : args
    const result = await runCliJson(cli, full, config, { signal })
    if (!result.ok) {
      const failure = classifyFailure(result, auth)
      if ((failure.code === 'auth-expired' || failure.code === 'not-logged-in') && config.autoRelogin !== false) {
        const relogin = await ensureRelogin()
        const block = loginPromptBlock(relogin)
        if (block) return [`⚠️ ${failure.title}`, '', block].join('\n')
      }
      return [
        `⚠️ ${failure.title}`,
        '',
        `下一步：${failure.hint}`,
        '',
        `错误码：${failure.code}`,
        truncate((result.stderr || result.stdout || '').trim(), 4000),
      ].join('\n')
    }
    if (parse && result.json !== undefined) {
      return truncate(JSON.stringify(result.json, null, 2), config.maxOutputChars)
    }
    return truncate(result.stdout.trim(), config.maxOutputChars)
  }

  /** 通用 HTTP API 调用（知识库用），返回 { ok, json, text }。 */
  async function apiCall(cli, auth, method, apiPath, { query, data, signal } = {}) {
    const args = ['api', method, apiPath]
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') args.push('--query', `${key}=${value}`)
      }
    }
    if (data !== undefined) args.push('--data', typeof data === 'string' ? data : JSON.stringify(data))
    const result = await runCliJson(cli, [...args, '-o', 'json'], config, { signal })
    if (!result.ok) {
      const failure = classifyFailure(result, auth)
      if ((failure.code === 'auth-expired' || failure.code === 'not-logged-in') && config.autoRelogin !== false) {
        const relogin = await ensureRelogin()
        const block = loginPromptBlock(relogin)
        if (block) return { ok: false, text: [`⚠️ ${failure.title}`, '', block].join('\n') }
      }
      return {
        ok: false,
        text: `⚠️ ${failure.title}\n\n下一步：${failure.hint}\n\n${truncate(result.stderr || result.stdout, 3000)}`,
      }
    }
    return { ok: true, json: result.json?.data ?? result.json ?? {} }
  }

  /**
   * 清洗 WPS 导出的正文。
   * 实测 markdown/plain 都会残留 Word 的目录域代码（HYPERLINK / PAGEREF / TOC \o），
   * 不清洗会占掉大量上下文且干扰阅读。
   */
  function cleanDocumentText(raw) {
    if (typeof raw !== 'string') return ''
    let text = raw
      .replace(/\r\n/g, '\n')
      // 去掉控制字符，保留换行与制表
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    const lines = text.split('\n').filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (/HYPERLINK|PAGEREF/.test(trimmed)) return false
      if (/^TOC\s+\\o/.test(trimmed)) return false
      return true
    })
    return lines
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  /** 用 file_id 换出真实的 drive_id + 文件 ID（知识库节点 ID 与真实文件 ID 不同）。 */
  async function resolveFileIdentity(cli, auth, fileId, signal) {
    const result = await apiCall(cli, auth, 'get', `/v7/files/${fileId}/meta`, { signal })
    if (!result.ok) return result
    const data = result.json ?? {}
    if (!data.drive_id || !data.id) {
      return { ok: false, text: '⚠️ 未能从文件元信息中解析出 drive_id / 文件 ID。' }
    }
    return { ok: true, driveId: data.drive_id, fileId: data.id, meta: data }
  }

  /**
   * 结构化状态投影：工具（文本）与 UI（JSON）共用同一份判定，避免两处逻辑漂移。
   */
  async function statusPayload({ signal } = {}) {
    const cli = resolveCliPath(config)
    if (!cli) {
      return { ok: true, state: 'cli-missing', cliPath: '', cliVersion: '', versionOk: false, configDir: '',
               clientIdConfigured: false, clientSecretConfigured: false, grantedScopes: null,
               businessCommandsAvailable: false }
    }
    const [probe, version] = await Promise.all([
      probeBusinessCommands(cli, config),
      ensureCliVersion(cli),
    ])
    let auth = await readAuthStatus(cli, config)
    // 面板打开时也先静默续期，避免"必须点插件名才刷新"
    if (auth.ok && needsLogin(auth) && auth.delegated && auth.delegated.has_refresh) {
      const refreshed = await runCli(cli, ['auth', 'refresh', '--delegated', '-o', 'json'], config)
      if (refreshed.ok) auth = await readAuthStatus(cli, config)
    }
    const base = {
      ok: true,
      cliPath: cli,
      cliVersion: version.version,
      versionOk: version.ok,
      businessCommandsAvailable: probe.available,
      configDir: auth.ok ? auth.configDir : '',
      clientIdConfigured: auth.ok ? auth.clientIdConfigured : false,
      clientSecretConfigured: auth.ok ? auth.clientSecretConfigured : false,
      grantedScopes: auth.ok ? auth.grantedScopes : null,
      delegatedAvailable: auth.ok ? auth.delegated.available : false,
    }
    if (auth.ok && auth.grantedScopes) autoLogin.lastScopes = auth.grantedScopes
    if (auth.ok && !needsLogin(auth)) clearSettledLogin(auth)
    let state
    if (!probe.available) state = 'spec-unavailable'
    else if (!auth.ok) state = 'auth-status-unreadable'
    else if (!auth.clientIdConfigured || !auth.clientSecretConfigured) state = 'credentials-missing'
    else if (!auth.delegated.available) state = 'not-logged-in'
    else if (needsLogin(auth)) state = 'auth-expired'
    else if (auth.grantedScopes && auth.grantedScopes.length === 0) state = 'logged-in-but-scopeless'
    else state = 'logged-in'
    return {
      ...base,
      delegatedStatus: auth.ok ? auth.delegated.status : 'unknown',
      state,
      login: loginInfo(),
      signal,
    }
  }

  /** 读正文。markdown 优先，失败回退 plain。 */
  async function readDocumentBody(cli, auth, driveId, fileId, { signal, format = 'markdown' } = {}) {
    const result = await apiCall(cli, auth, 'get', `/v7/drives/${driveId}/files/${fileId}/content`, {
      query: { format },
      signal,
    })
    if (!result.ok) return result
    const data = result.json ?? {}
    const body = data[format] ?? data.markdown ?? data.plain ?? data.html ?? ''
    if (!body) {
      return { ok: false, text: '⚠️ 文档没有返回正文（可能仍在导出中，或该格式不支持）。' }
    }
    const cleaned = cleanDocumentText(String(body))
    return { ok: true, text: truncate(cleaned, config.maxOutputChars) }
  }

  // ── 知识库结果格式化（比裸 JSON 更省上下文） ──────────────────
  function formatSpaces(payload) {
    const items = payload?.items ?? []
    if (!items.length) return '（当前账号没有可访问的知识库）'
    return items.map((s) => `- ${s.name}\n  space-id: ${s.id}`).join('\n')
  }

  function formatNodes(payload) {
    const items = payload?.items ?? []
    if (!items.length) return '（该节点下没有子节点，或你没有访问权限）'
    return items.map((n) => {
      const kind = n.type === 'file' ? '文件' : '文件夹'
      const size = n.size ? ` · ${(n.size / 1024).toFixed(0)} KB` : ''
      return `- [${kind}] ${n.name}\n  id: ${n.id}${n.link_id && n.link_id !== n.id ? ` · link_id: ${n.link_id}` : ''}${size}`
    }).join('\n')
  }

  function formatSearch(payload) {
    const items = payload?.items ?? []
    if (!items.length) return '（没有匹配结果）'
    return items.map((hit, index) => {
      const file = hit.file ?? {}
      const snippets = (hit.highlights ?? [])
        .filter((entry) => entry.values?.length)
        .map((entry) => `  ${entry.key}: ${entry.values.join(' … ').replace(/<\/?em>/g, '').slice(0, 300)}`)
      return [`${index + 1}. ${file.name ?? '(未命名)'}`, `   id: ${file.id ?? ''}`, ...snippets].join('\n')
    }).join('\n\n')
  }

  // ── 环境与身份 ──────────────────────────────────────────────────
  register({
    name: 'cnbm_status',
    description:
      '检查 cnbm知识库（WPS 365）连接状态：CLI 是否安装、业务命令是否可用、应用凭证、是否已登录、令牌实际授予了哪些 scope。排障先调它。',
    parameters: { type: 'object', properties: {} },
    output: TEXT_OUTPUT,
    async execute(_args, exec) {
      const cli = resolveCliPath(config)
      if (!cli) {
        return [
          '状态：cli-missing',
          '❌ 未安装 wps365-cli',
          '',
          '下一步：curl -fsSL https://open-docs.wpscdn.cn/cli/install.sh | bash',
        ].join('\n')
      }
      const probe = await probeBusinessCommands(cli, config)
      const lines = [`CLI：${cli}`]

      const version = await runCli(cli, ['--version'], config, { timeoutMs: 10_000, signal: exec.signal })
      const rawVersion = (version.stdout || version.stderr || '未知').trim()
      lines.push(`版本：${rawVersion}`)
      const parsed = /(\d+\.\d+\.\d+)/.exec(rawVersion)
      if (parsed) {
        const compatible = compareVersion(parsed[1], MIN_CLI_VERSION) >= 0
        lines.push(`版本兼容（要求 ≥ ${MIN_CLI_VERSION}）：${compatible ? '是' : '否，请升级'}`)
      }

      if (!probe.available) {
        lines.push('', `状态：spec-unavailable（缺命令：${probe.missing.join(', ') || '未知'}）`)
        lines.push('⚠️ 业务命令未加载 —— 这通常不是登录问题，而是配置目录不可写，CLI 无法缓存 spec。')
        lines.push('下一步：在 cordis.patch.yml 设置 config.configDir 指向可写目录后重试。')
        if (probe.output) lines.push('', 'CLI 输出：', probe.output)
        return lines.join('\n')
      }

      const auth = await readAuthStatus(cli, config)
      if (!auth.ok) {
        lines.push('', '状态：auth-status-unreadable', '原始输出：', truncate(auth.raw?.stderr || '', 1200))
        return lines.join('\n')
      }

      lines.push('', `配置目录：${auth.configDir || '（CLI 默认）'}`)
      lines.push(`应用 ID 已配置：${auth.clientIdConfigured ? '是' : '否'}`)
      lines.push(`应用密钥已配置：${auth.clientSecretConfigured ? '是' : '否'}`)
      lines.push(`用户身份（delegated）：${auth.delegated.available ? '可用' : '不可用'}（${auth.delegated.status}）`)
      if (auth.grantedScopes) {
        lines.push(`已授予 scope：${auth.grantedScopes.length ? auth.grantedScopes.join(', ') : '（空）'}`)
      }

      if (!auth.clientIdConfigured || !auth.clientSecretConfigured) {
        lines.push('', '状态：credentials-missing')
        lines.push('下一步：wps365-cli auth setup --client-id <团队AppID> --client-secret <向管理员获取>')
      } else if (!auth.delegated.available || needsLogin(auth)) {
        lines.push('', `状态：${auth.delegated.available ? 'auth-expired' : 'not-logged-in'}（${auth.delegated.status}）`)
        const info = loginInfo()
        if (info && info.pending) {
          lines.push('', '自动重登进行中，请在浏览器完成授权：')
          if (info.url) lines.push(`验证地址：${info.url}`)
          if (info.userCode) lines.push(`用户码：${info.userCode}`)
        } else {
          const relogin = await ensureRelogin()
          const block = loginPromptBlock(relogin)
          if (block) lines.push('', block)
          else lines.push('下一步：调用 cnbm_login 发起设备码登录，用企业账号完成授权。')
        }
      } else if (auth.grantedScopes && auth.grantedScopes.length === 0) {
        lines.push('', '状态：logged-in-but-scopeless')
        lines.push('⚠️ 登录成功但令牌没有任何 scope，所有业务接口都会返回 403。')
        lines.push('下一步：在开放平台为应用开通 scope 的用户授权类型，然后带 --scopes 重新登录。')
      } else {
        lines.push('', '状态：logged-in')
      }

      const pending = login.current
      if (pending && !pending.settled) {
        const prompt = extractDevicePrompt(pending.output)
        lines.push('', '登录进行中：等待用户在浏览器完成授权。')
        if (prompt.userCode) lines.push(`用户码：${prompt.userCode}`)
        if (prompt.url) lines.push(`验证地址：${prompt.url}`)
      } else if (pending && pending.settled && pending.exitCode !== 0 && pending.exitCode !== null) {
        lines.push('', `上次登录进程已退出（exit=${pending.exitCode}），若未登录请重新调用 cnbm_login。`)
      }
      return lines.join('\n')
    },
  })

  register({
    name: 'cnbm_login',
    description:
      '发起 WPS 设备码登录。传 scopes 可申请指定权限（不传则只能拿到空权限令牌）。返回验证地址与用户码，由用户用自己的企业账号在浏览器完成授权。',
    parameters: {
      type: 'object',
      properties: {
        scopes: { type: 'string', description: '逗号分隔的 scope，例如 kso.wiki.readwrite；强烈建议显式传入' },
      },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const cli = resolveCliPath(config)
      if (!cli) return '❌ 未安装 wps365-cli，请先安装后重试。'

      const auth = await readAuthStatus(cli, config)
      if (auth.ok && (!auth.clientIdConfigured || !auth.clientSecretConfigured)) {
        return [
          '⚠️ 尚未配置应用凭证，无法登录。',
          '',
          '下一步：wps365-cli auth setup --client-id <团队AppID> --client-secret <向管理员获取>',
          '（密钥只需填一次，会写入系统钥匙串，插件不保存也不回显）',
        ].join('\n')
      }

      const pending = login.current
      if (pending && !pending.settled) {
        const prompt = extractDevicePrompt(pending.output)
        return [
          '登录已在进行中，请在浏览器完成授权：',
          prompt.userCode ? `用户码：${prompt.userCode}` : '',
          prompt.url ? `验证地址：${prompt.url}` : '',
          '',
          '完成后调用 cnbm_status 确认。',
        ].filter(Boolean).join('\n')
      }

      const state = startDeviceLogin(cli, config, { scopes: args.scopes || loginScopes(), signal: exec.signal })
      login.current = state

      // 给 CLI 一点时间打印验证地址与二维码，然后立即返回，不阻塞等授权。
      await new Promise((resolve) => setTimeout(resolve, 2500))

      if (state.error) {
        return `❌ 启动登录进程失败：${state.error.message}`
      }
      const prompt = extractDevicePrompt(state.output)
      const rawText = truncate(state.output.trim(), 4000)
      if (state.settled) {
        return ['登录进程已结束：', '', rawText || '（无输出）'].join('\n')
      }
      return [
        '已发起设备码登录。请用【企业账号】在浏览器打开下面的地址并确认授权：',
        '',
        prompt.url ? `验证地址：${prompt.url}` : '（未识别到验证地址，见下方原始输出）',
        prompt.userCode ? `用户码：${prompt.userCode}` : '',
        '',
        '授权完成后调用 cnbm_status 确认登录结果（本工具不会等待授权完成）。',
        '',
        '--- CLI 原始输出 ---',
        rawText || '（暂无输出）',
      ].filter((line) => line !== '').join('\n')
    },
  })

  register({
    name: 'cnbm_logout',
    description: '退出当前 WPS 用户授权（保留应用凭证，之后可直接重新登录）。',
    parameters: { type: 'object', properties: {} },
    output: TEXT_OUTPUT,
    async execute(_args, exec) {
      const cli = resolveCliPath(config)
      if (!cli) return '❌ 未安装 wps365-cli。'
      const result = await runCli(cli, ['auth', 'logout'], config, { signal: exec.signal })
      if (!result.ok) {
        const failure = classifyFailure(result)
        return `⚠️ ${failure.title}\n\n${truncate(result.stderr || result.stdout, 2000)}`
      }
      login.current = null
      return truncate((result.stdout || result.stderr || '已退出登录').trim(), 2000)
    },
  })

  register({
    name: 'cnbm_me',
    description: '获取当前登录的 WPS 用户信息（用于确认登录的是哪个企业身份）。需要 kso.user_base.read。',
    parameters: { type: 'object', properties: {} },
    output: TEXT_OUTPUT,
    async execute(_args, exec) {
      const ready = await preflight({ signal: exec.signal, scopes: SCOPE_USER })
      if (!ready.ok) return ready.text
      return execRead(ready.cli, ready.auth, ['user', 'me'], { signal: exec.signal })
    },
  })

  // ── 知识库（wiki）：只需要 kso.wiki.readwrite ──────────────────
  register({
    name: 'cnbm_wiki_spaces',
    description: '列出当前账号可访问的 WPS 知识库（wiki space），返回 space-id，后续列节点和搜索都需要它。',
    parameters: {
      type: 'object',
      properties: {
        pageSize: { type: 'number', description: '分页大小，最大 100' },
        pageToken: { type: 'string', description: '分页标记' },
      },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const ready = await preflight({ signal: exec.signal, scopes: SCOPE_WIKI })
      if (!ready.ok) return ready.text
      const result = await apiCall(ready.cli, ready.auth, 'get', '/v7/wiki/spaces', {
        query: { page_size: args.pageSize, page_token: args.pageToken },
        signal: exec.signal,
      })
      return result.ok ? formatSpaces(result.json) : result.text
    },
  })

  register({
    name: 'cnbm_wiki_nodes',
    description: '列出知识库中某个节点下的子节点（文件/文件夹）。parent-id 用 0 表示知识库根目录。',
    parameters: {
      type: 'object',
      properties: {
        spaceId: { type: 'string', description: '知识库 ID（来自 cnbm_wiki_spaces）' },
        parentId: { type: 'string', description: '父节点 ID，根目录用 0' },
        pageSize: { type: 'number', description: '分页大小' },
        pageToken: { type: 'string', description: '分页标记' },
      },
      required: ['spaceId', 'parentId'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const ready = await preflight({ signal: exec.signal, scopes: SCOPE_WIKI })
      if (!ready.ok) return ready.text
      if (!/^[\w-]+$/.test(args.spaceId) || !/^[\w-]+$/.test(args.parentId)) {
        return '⛔ spaceId / parentId 只允许字母、数字、下划线、连字符。'
      }
      const result = await apiCall(
        ready.cli, ready.auth, 'get',
        `/v7/wiki/spaces/${args.spaceId}/files/${args.parentId}/children`,
        { query: { page_size: args.pageSize, page_token: args.pageToken }, signal: exec.signal },
      )
      return result.ok ? formatNodes(result.json) : result.text
    },
  })

  register({
    name: 'cnbm_wiki_node_meta',
    description: '读取知识库单个节点的元信息（名称、类型、大小、创建/修改人、时间等）。',
    parameters: {
      type: 'object',
      properties: {
        spaceId: { type: 'string', description: '知识库 ID' },
        fileId: { type: 'string', description: '节点 ID' },
      },
      required: ['spaceId', 'fileId'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const ready = await preflight({ signal: exec.signal, scopes: SCOPE_WIKI })
      if (!ready.ok) return ready.text
      if (!/^[\w-]+$/.test(args.spaceId) || !/^[\w-]+$/.test(args.fileId)) {
        return '⛔ spaceId / fileId 只允许字母、数字、下划线、连字符。'
      }
      const result = await apiCall(
        ready.cli, ready.auth, 'get',
        `/v7/wiki/spaces/${args.spaceId}/files/${args.fileId}/meta`,
        { signal: exec.signal },
      )
      return result.ok ? truncate(JSON.stringify(result.json, null, 2), config.maxOutputChars) : result.text
    },
  })

  register({
    name: 'cnbm_wiki_search',
    description:
      '在知识库中按关键字搜索文档。返回命中文件与正文高亮片段——片段可直接用于回答内容性问题，即使没有文档正文读取权限。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键字' },
        spaceIds: { type: 'string', description: '知识库 ID，多个用逗号分隔；至少一个' },
        pageSize: { type: 'number', description: '分页大小' },
        pageToken: { type: 'string', description: '分页标记' },
      },
      required: ['keyword', 'spaceIds'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const ready = await preflight({ signal: exec.signal, scopes: SCOPE_WIKI })
      if (!ready.ok) return ready.text
      const spaceIds = String(args.spaceIds).split(',').map((s) => s.trim()).filter(Boolean)
      if (!spaceIds.length) return '⛔ spaceIds 至少需要一个知识库 ID。'
      const result = await apiCall(ready.cli, ready.auth, 'post', '/v7/wiki/search', {
        // 该接口的 page_size 为必填，缺省会返回 400408021
        data: { keyword: args.keyword, space_ids: spaceIds, page_size: args.pageSize || 20, page_token: args.pageToken },
        signal: exec.signal,
      })
      return result.ok ? formatSearch(result.json) : result.text
    },
  })

  register({
    name: 'cnbm_wiki_read',
    description:
      '读取知识库中一篇文档的完整正文（Markdown）。自动把知识库节点 ID 解析为真实文件 ID，无需提前知道 drive-id。需要 kso.file.read。',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: '知识库节点 ID（来自 cnbm_wiki_nodes / cnbm_wiki_search）' },
        format: { type: 'string', description: '内容格式：markdown（默认）/ plain / html' },
      },
      required: ['fileId'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const ready = await preflight({ signal: exec.signal, scopes: SCOPE_DOCS })
      if (!ready.ok) return ready.text
      if (!/^[\w-]+$/.test(args.fileId)) return '⛔ fileId 只允许字母、数字、下划线、连字符。'
      const identity = await resolveFileIdentity(ready.cli, ready.auth, args.fileId, exec.signal)
      if (!identity.ok) return identity.text
      const body = await readDocumentBody(ready.cli, ready.auth, identity.driveId, identity.fileId, {
        signal: exec.signal,
        format: args.format || 'markdown',
      })
      return body.ok ? body.text : body.text
    },
  })

  // ── 云文档（drive）：需要 drive/file scope ─────────────────────
  register({
    name: 'cnbm_docs_drives',
    description: '列出当前账号可访问的 WPS 云盘。需要 kso.drive.readwrite 等 drive 权限。',
    parameters: {
      type: 'object',
      properties: {
        pageSize: { type: 'number', description: '分页大小，默认 50' },
        pageToken: { type: 'string', description: '分页标记' },
        alloteeType: { type: 'string', description: '盘归属身份类型：user / group / app，默认 user' },
      },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const ready = await preflight({ signal: exec.signal, scopes: SCOPE_DOCS })
      if (!ready.ok) return ready.text
      const cmd = ['drive', 'list', '--allotee-type', args.alloteeType || 'user', '--page-size', String(args.pageSize ?? 50)]
      if (args.pageToken) cmd.push('--page-token', args.pageToken)
      return execRead(ready.cli, ready.auth, cmd, { signal: exec.signal })
    },
  })

  register({
    name: 'cnbm_docs_search',
    description: '在当前账号有权限的范围内搜索 WPS 云文档。需要 drive/file scope。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键字' },
        pageSize: { type: 'number', description: '分页大小，默认 20' },
        pageToken: { type: 'string', description: '分页标记' },
        fileType: { type: 'string', description: '按文件类型过滤' },
        driveIds: { type: 'string', description: '限定盘 ID，多个用逗号分隔' },
      },
      required: ['keyword'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const ready = await preflight({ signal: exec.signal, scopes: SCOPE_DOCS })
      if (!ready.ok) return ready.text
      const cmd = ['drive', 'file', 'search', '--keyword', args.keyword, '--type', 'all', '--page-size', String(args.pageSize ?? 20)]
      if (args.pageToken) cmd.push('--page-token', args.pageToken)
      if (args.fileType) cmd.push('--file-type', args.fileType)
      if (args.driveIds) cmd.push('--drive-ids', args.driveIds)
      return execRead(ready.cli, ready.auth, cmd, { signal: exec.signal })
    },
  })

  register({
    name: 'cnbm_docs_list',
    description: '列出指定云盘目录下的文件与文件夹。parent-id 用 0 表示根目录。需要 drive/file scope。',
    parameters: {
      type: 'object',
      properties: {
        driveId: { type: 'string', description: '盘 ID' },
        parentId: { type: 'string', description: '父目录 ID，根目录用 0' },
        pageSize: { type: 'number', description: '分页大小，默认 50' },
        pageToken: { type: 'string', description: '分页标记' },
        filterType: { type: 'string', description: '按类型过滤' },
      },
      required: ['driveId', 'parentId'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const ready = await preflight({ signal: exec.signal, scopes: SCOPE_DOCS })
      if (!ready.ok) return ready.text
      const cmd = ['drive', 'file', 'list', args.driveId, String(args.parentId), '--page-size', String(args.pageSize ?? 50)]
      if (args.pageToken) cmd.push('--page-token', args.pageToken)
      if (args.filterType) cmd.push('--filter-type', args.filterType)
      return execRead(ready.cli, ready.auth, cmd, { signal: exec.signal })
    },
  })

  register({
    name: 'cnbm_docs_read',
    description: '抽取 WPS 云文档的正文内容。需要 kso.file.read 或 kso.file.readwrite。',
    parameters: {
      type: 'object',
      properties: {
        driveId: { type: 'string', description: '盘 ID' },
        fileId: { type: 'string', description: '文件 ID' },
        format: { type: 'string', description: '内容格式（可选）' },
      },
      required: ['driveId', 'fileId'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const ready = await preflight({ signal: exec.signal, scopes: SCOPE_DOCS })
      if (!ready.ok) return ready.text
      const body = await readDocumentBody(ready.cli, ready.auth, args.driveId, args.fileId, {
        signal: exec.signal,
        format: args.format || 'markdown',
      })
      return body.text
    },
  })

  register({
    name: 'cnbm_docs_download',
    description: '获取 WPS 文件的下载地址与参数（返回的是地址，不是文件本体）。需要 drive/file scope。',
    parameters: {
      type: 'object',
      properties: {
        driveId: { type: 'string', description: '盘 ID' },
        fileId: { type: 'string', description: '文件 ID' },
      },
      required: ['driveId', 'fileId'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const ready = await preflight({ signal: exec.signal, scopes: SCOPE_DOCS })
      if (!ready.ok) return ready.text
      return execRead(ready.cli, ready.auth, ['drive', 'file', 'download', args.driveId, args.fileId], { signal: exec.signal })
    },
  })

  // ── 兜底 ───────────────────────────────────────────────────────
  register({
    name: 'cnbm_api',
    description:
      '直接调用 cnbm知识库（WPS 365）开放平台端点，用于精装命令未覆盖的能力。默认只允许 GET/HEAD；写方法需要显式开启写模式。',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', description: 'HTTP 方法：get / head / post / put / patch / delete，默认 get' },
        path: { type: 'string', description: 'API 路径，例如 /v7/users/current' },
        data: { type: 'string', description: '请求体 JSON 字符串（写方法使用）' },
      },
      required: ['path'],
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const ready = await preflight({ signal: exec.signal })
      if (!ready.ok) return ready.text
      const method = String(args.method || 'get').toLowerCase()
      const write = method !== 'get' && method !== 'head'
      if (write && (config.readOnly || !config.allowWrite)) {
        return '⛔ 当前为只读模式，已拒绝写请求。需要时开启 config.readOnly=false 与 config.allowWrite=true。'
      }
      const cmd = ['api', method, args.path]
      if (args.data) cmd.push('--data', args.data)
      return execRead(ready.cli, ready.auth, cmd, { signal: exec.signal })
    },
  })

  // ── 同源 Web 控制台（通过 ctx.webServer 注册） ──────────────────
  async function uiPreflight() {
    const ready = await preflight({ scopes: SCOPE_WIKI })
    return ready.ok ? ready : { ok: false, error: ready.text }
  }

  const uiOps = {
    status: () => statusPayload(),

    async spaces() {
      const ready = await uiPreflight()
      if (!ready.ok) return { ok: false, error: ready.error }
      const result = await apiCall(ready.cli, ready.auth, 'get', '/v7/wiki/spaces', {})
      return result.ok
        ? { ok: true, data: (result.json?.items ?? []).map((s) => ({ id: s.id, name: s.name, desc: s.desc || '' })) }
        : { ok: false, error: result.text }
    },

    async nodes({ spaceId, parentId, pageSize, pageToken } = {}) {
      if (!/^[\w-]+$/.test(String(spaceId || '')) || !/^[\w-]+$/.test(String(parentId || ''))) {
        return { ok: false, error: 'spaceId / parentId 不合法' }
      }
      const ready = await uiPreflight()
      if (!ready.ok) return { ok: false, error: ready.error }
      const result = await apiCall(
        ready.cli, ready.auth, 'get',
        `/v7/wiki/spaces/${spaceId}/files/${parentId}/children`,
        { query: { page_size: pageSize, page_token: pageToken } },
      )
      return result.ok
        ? { ok: true, data: (result.json?.items ?? []).map((n) => ({
            id: n.id, name: n.name, type: n.type, size: n.size, mtime: n.mtime,
          })) }
        : { ok: false, error: result.text }
    },

    async search({ keyword, spaceIds, pageSize } = {}) {
      const ids = String(spaceIds || '').split(',').map((x) => x.trim()).filter(Boolean)
      if (!keyword) return { ok: false, error: '缺少 keyword' }
      if (!ids.length) return { ok: false, error: '缺少 spaceIds' }
      const ready = await uiPreflight()
      if (!ready.ok) return { ok: false, error: ready.error }
      const result = await apiCall(ready.cli, ready.auth, 'post', '/v7/wiki/search', {
        // 该接口的 page_size 为必填，缺省会返回 400408021
        data: { keyword, space_ids: ids, page_size: pageSize || 20 },
      })
      return result.ok ? { ok: true, data: result.json?.items ?? [] } : { ok: false, error: result.text }
    },

    async read({ fileId } = {}) {
      if (!/^[\w-]+$/.test(String(fileId || ''))) return { ok: false, error: 'fileId 不合法' }
      const ready = await preflight({ scopes: SCOPE_DOCS })
      if (!ready.ok) return { ok: false, error: ready.text }
      const identity = await resolveFileIdentity(ready.cli, ready.auth, fileId)
      if (!identity.ok) return { ok: false, error: identity.text }
      const body = await readDocumentBody(ready.cli, ready.auth, identity.driveId, identity.fileId, {})
      return body.ok ? { ok: true, text: body.text } : { ok: false, error: body.text }
    },

    async login({ scopes } = {}) {
      const result = await ensureRelogin(scopes)
      if (result.error === 'cli-missing') return { ok: false, error: '未安装 wps365-cli' }
      if (result.disabled) return { ok: false, error: '自动重登已禁用（config.autoRelogin=false）' }
      const prompt = result.prompt || {}
      const qr = await makeQr(prompt.url || '')
      return { ok: true, url: prompt.url || '', userCode: prompt.userCode || '', qr, reused: Boolean(result.reused) }
    },

    async bindApp({ clientId, clientSecret, apiBase } = {}) {
      if (!clientId || !clientSecret) return { ok: false, error: '缺少 App ID 或 App Secret' }
      const cli = resolveCliPath(config)
      if (!cli) return { ok: false, error: '未安装 wps365-cli' }
      const args = ['auth', 'setup', '--client-id', String(clientId), '--client-secret', String(clientSecret)]
      if (apiBase) args.push('--api-base', String(apiBase))
      const res = await runCli(cli, args, config)
      return res.ok ? { ok: true } : { ok: false, error: (res.stderr || res.stdout || '绑定失败').slice(0, 300) }
    },
  }

  // webServer 可能晚于本插件激活，必须先等它出现再注册路由，
  // 否则 registerWebUi 会静默返回 null（dsh-knowledge 用的是同一写法）。
  // 整个注册过程兜底 catch：Web 控制台失败不能连带回滚已注册的 15 个工具。
  const mountUi = (runtime) => {
    try {
      const dispose = registerWebUi(runtime, { ops: uiOps })
      if (typeof dispose === 'function' && typeof runtime.effect === 'function') {
        runtime.effect(() => dispose)
      }
      if (dispose === null) {
        const logger = ctx.logger ?? runtime?.logger
        logger?.warn?.('cnbm-knowledge: webServer 不可用，Web 控制台未启用（Agent 工具不受影响）')
      }
    } catch (error) {
      const logger = ctx.logger ?? runtime?.logger
      logger?.warn?.('cnbm-knowledge: Web 控制台注册失败：' + String((error && error.message) || error))
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], mountUi)
  } else if (ctx.webServer !== undefined) {
    mountUi(ctx)
  } else {
    ctx.logger?.warn?.('cnbm-knowledge: webServer 不可用，Web 控制台未启用（Agent 工具不受影响）')
  }
}
