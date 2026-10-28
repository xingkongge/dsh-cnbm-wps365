/**
 * wps365-cli 的唯一执行出口。
 *
 * 设计红线（见 PLAN.md 第 4 节）：
 *   1. 本模块只负责"调用 + 映射"，不解析、不缓存、不打印任何 token。
 *   2. 凭证与 token 全部留在 wps365-cli 的系统钥匙串里，插件进程从不接触。
 *   3. 永远用参数数组调用（execFile），不做 shell 字符串拼接，避免注入。
 */
import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const DEFAULTS = {
  cliPath: '',
  configDir: '',
  timeoutMs: 30_000,
  maxOutputChars: 20_000,
  readOnly: true,
  allowWrite: false,
  loginTimeoutMs: 300_000,
  autoRelogin: true,
  loginScopes: '',
  clientId: '',
  clientSecret: '',
  apiBase: '',
  updateRepos: { cnbm: 'xingkongge/dsh-cnbm-wps365', presales: 'xingkongge/dsh-presales' },
  githubToken: '',
}

/** 业务域命令名。缺任意一个都说明 spec 没加载出来。 */
const BUSINESS_COMMANDS = ['drive', 'user', 'calendar', 'im', 'mail', 'airpage', 'airsheet', 'dbsheet', 'meeting']

/**
 * 按 WPS365_CLI → 显式配置 → ~/.local/bin → PATH 的顺序定位 CLI。
 * @returns {string|null} 可执行文件绝对路径，找不到返回 null
 */
export function resolveCliPath(config = {}) {
  const candidates = []
  if (config.cliPath) candidates.push(config.cliPath)
  if (process.env.WPS365_CLI) candidates.push(process.env.WPS365_CLI)
  candidates.push(path.join(homedir(), '.local', 'bin', 'wps365-cli'))
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'wps365-cli'))
  }
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) continue
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // 继续探测下一个候选
    }
  }
  return null
}

function buildEnv(config) {
  const env = { ...process.env }
  // 只有显式配置时才覆盖。默认交给 CLI 自己的按用户目录，
  // 这样与用户在终端里手工用 CLI 共享同一套凭证。
  if (config.configDir) env.WPS365_CONFIG_DIR = config.configDir
  // 应用凭证可直接由插件配置注入（不需要同事先跑 config init）。
  if (config.clientId) env.WPS365_CLIENT_ID = String(config.clientId)
  if (config.clientSecret) env.WPS365_CLIENT_SECRET = String(config.clientSecret)
  if (config.apiBase) env.WPS365_API_BASE = String(config.apiBase)
  return env
}

function normalizeResult(error, stdout, stderr) {
  const killed = Boolean(error && error.killed)
  const timedOut = killed && error.signal === 'SIGTERM'
  const exitCode = error ? (typeof error.code === 'number' ? error.code : null) : 0
  const missing = Boolean(error && error.code === 'ENOENT')
  return {
    ok: !error,
    exitCode,
    timedOut,
    missing,
    rawError: error || null,
    stdout: String(stdout ?? ''),
    stderr: String(stderr ?? ''),
  }
}

/** 执行一次 CLI 调用。永不 reject —— 失败以结构化结果返回。 */
export function runCli(cli, args, config = {}, { timeoutMs, signal } = {}) {
  return new Promise((resolve) => {
    if (!cli) {
      resolve({
        ok: false, exitCode: null, timedOut: false, missing: true, rawError: null,
        stdout: '', stderr: 'wps365-cli not found',
      })
      return
    }
    execFile(
      cli,
      args,
      {
        env: buildEnv(config),
        timeout: timeoutMs ?? config.timeoutMs ?? DEFAULTS.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        signal,
        windowsHide: true,
      },
      (error, stdout, stderr) => resolve(normalizeResult(error, stdout, stderr)),
    )
  })
}

/** 执行并尝试按 JSON 解析 stdout。 */
export async function runCliJson(cli, args, config, options) {
  const result = await runCli(cli, args, config, options)
  let json
  if (result.ok && result.stdout.trim()) {
    try {
      json = JSON.parse(result.stdout)
    } catch {
      json = undefined
    }
  }
  return { ...result, json }
}

/**
 * 探测业务命令是否可用。
 *
 * 这是实测坑 A 的检测手段：CLI 首次运行要把 spec 缓存写进配置目录，
 * 写不进去时只剩 8 个基础命令，`--help` 里 drive/user 等全部消失，
 * 而唯一的报错只有一行 Warning，极易被误判成"未登录"。
 */
export async function probeBusinessCommands(cli, config) {
  const result = await runCli(cli, ['--help'], config, { timeoutMs: 15_000 })
  if (result.missing) return { available: false, reason: 'cli-missing', missing: [], output: result.stderr }
  if (!result.ok && !result.stdout) {
    return { available: false, reason: 'help-failed', missing: BUSINESS_COMMANDS, output: result.stderr }
  }
  const text = `${result.stdout}\n${result.stderr}`
  const missing = BUSINESS_COMMANDS.filter((name) => !new RegExp(`^\\s{2,}${name}\\b`, 'm').test(text))
  const specWarning = /spec failed|save .*spec/i.test(text)
  return {
    available: missing.length === 0,
    reason: missing.length === 0 ? 'ok' : specWarning ? 'spec-unavailable' : 'commands-missing',
    missing,
    specWarning,
    output: text.trim().split('\n').slice(-4).join('\n'),
  }
}

/** 读取结构化认证状态（`auth status -o json` 实测永远 exit 0）。 */
export async function readAuthStatus(cli, config) {
  const result = await runCliJson(cli, ['-o', 'json', 'auth', 'status'], config)
  if (result.missing) return { ok: false, reason: 'cli-missing', raw: result }
  if (!result.json) {
    return { ok: false, reason: 'unparsable', raw: result }
  }
  const s = result.json
  return {
    ok: true,
    raw: result,
    clientId: s.client_id || '',
    clientIdConfigured: Boolean(s.client_id_configured),
    clientSecretConfigured: Boolean(s.client_secret_configured),
    delegated: s.delegated || { available: false, status: 'unknown' },
    grantedScopes: Array.isArray(s.delegated?.granted_scopes) ? s.delegated.granted_scopes : null,
    app: s.app || { available: false, status: 'unknown' },
    configDir: s.config_dir || '',
    redirectUri: s.redirect_uri || '',
    redirectUriConfigured: Boolean(s.redirect_uri_configured),
    credentialsSource: s.credentials_source || '',
    envAccessToken: Boolean(s.env_access_token),
  }
}

/** 授权是否已失效：refresh token 失效时 available 仍为 true，但 status !== 'valid'。 */
export function authNeedsLogin(authStatus) {
  return !authStatus?.delegated?.available || authStatus.delegated.status !== 'valid'
}

/**
 * 前置权限检查：令牌里没有需要的 scope 时直接给出可执行指引，
 * 而不是让调用打到服务端再返回 403。
 * grantedScopes 为 null（未知）时不拦截，交给服务端判定。
 */
export function checkScope(authStatus, anyOf) {
  const granted = authStatus?.grantedScopes
  if (!granted || granted.length === 0) return null
  if (anyOf.some((scope) => granted.includes(scope))) return null
  return {
    code: 'scope-missing',
    title: `当前令牌未授予所需权限`,
    hint: [
      `需要以下任一 scope：${anyOf.join(' / ')}`,
      `当前已授予：${granted.join(', ')}`,
      '下一步：在 open.wps.cn 应用 → 权限管理申请 scope 的【用户授权】类型，创建版本发布并由企业管理员审批，',
      '然后带 --scopes 重新登录（授权码/设备码登录均可）：cnbm_login scopes="..."',
    ].join('\n'),
  }
}

/**
 * 把 CLI / 服务端的错误翻译成"下一步该做什么"。
 *
 * 重点是区分两种完全不同的失败（见 PLAN.md 4.4 与 12.6）：
 *   - scope 未开通        → 找管理员批 scope
 *   - 企业套餐权益不足     → 找管理员买套餐
 * 提示错了会让管理员白忙一场。
 */
export function classifyFailure(result, authStatus) {
  const text = `${result.stderr || ''}\n${result.stdout || ''}`

  if (result.missing) {
    return {
      code: 'cli-missing',
      title: '未安装 wps365-cli',
      hint: '执行：curl -fsSL https://open-docs.wpscdn.cn/cli/install.sh | bash',
    }
  }
  if (result.timedOut) {
    return { code: 'timeout', title: 'CLI 调用超时', hint: '可用 config.timeoutMs 调大，或检查网络。' }
  }
  if (/spec failed|save .*spec/i.test(text)) {
    return {
      code: 'spec-unavailable',
      title: '命令集未加载（业务命令缺失）',
      hint: '配置目录不可写，CLI 无法缓存 spec。设置 cordis.patch.yml 的 configDir 指向可写目录后重试。',
    }
  }
  if (/403000001|ErrPrivileges|interface_company_doc|interface_/i.test(text)) {
    return {
      code: 'entitlement-missing',
      title: '企业套餐权益不足（不是 scope 问题）',
      hint: '需企业管理员开通【商业高级版】/【商业旗舰版】；且要读取文档的成员账号也需对应套餐。这不是 OAuth 权限，申请 scope 解决不了。',
    }
  }
  if (/insufficient[_\s-]?scope|scope .*(missing|not granted)|permission denied/i.test(text)) {
    return {
      code: 'scope-missing',
      title: '应用未开通所需权限',
      hint: '在 open.wps.cn 应用 → 权限管理申请 scope，创建版本提交发布，由企业管理员在 work.wps.cn 审批。',
    }
  }
  if (/可用范围|not in .*(scope|range)|outside .*available/i.test(text)) {
    return {
      code: 'out-of-range',
      title: '账号不在应用可用范围内',
      hint: '请应用管理员在开放平台把该成员纳入「可用范围」。',
    }
  }
  if (/app credentials not configured|client_id cannot be empty|client[_\s-]?secret/i.test(text)) {
    return {
      code: 'credentials-missing',
      title: '未配置应用凭证',
      hint: '执行：wps365-cli auth setup --client-id <AppID> --client-secret <向管理员获取>',
    }
  }
  if (/no .*token available|not logged in|not_found.*delegated|run .*auth login/i.test(text)) {
    return {
      code: 'not-logged-in',
      title: '尚未登录 WPS',
      hint: '调用 cnbm_login 发起设备码登录，用企业账号完成授权。',
    }
  }
  if (/429|too many requests|rate limit/i.test(text)) {
    return { code: 'rate-limited', title: '请求过于频繁', hint: '稍后重试，或降低分页大小。' }
  }
  if (/401|token.*expired|refresh token/i.test(text)) {
    return { code: 'auth-expired', title: '登录已过期', hint: '重新调用 cnbm_login 授权。' }
  }
  if (authStatus && authStatus.ok && !authStatus.delegated.available) {
    return {
      code: 'not-logged-in',
      title: '尚未登录 WPS',
      hint: '调用 cnbm_login 发起设备码登录。',
    }
  }
  return {
    code: 'cli-error',
    title: 'CLI 调用失败',
    hint: '查看下方原始输出定位原因。',
  }
}

/** 按字符预算截断，并在尾部标注，避免大结果灌爆上下文。 */
export function truncate(text, limit = DEFAULTS.maxOutputChars) {
  const value = String(text ?? '')
  if (value.length <= limit) return value
  const head = value.slice(0, limit)
  return `${head}\n\n…（已截断：原文 ${value.length} 字符，上限 ${limit}。请用分页参数或缩小范围后重试）`
}

/** 把 CLI 的 JSON 结果整理成稳定、可读的文本。 */
export function formatJson(payload, limit) {
  if (payload === undefined) return ''
  return truncate(JSON.stringify(payload, null, 2), limit)
}

/** 判断命令是否属于写操作（readOnly 默认拦截）。 */
const WRITE_VERBS = new Set(['create', 'update', 'delete', 'rename', 'move', 'copy', 'batch-copy', 'batch-move', 'send', 'upload', 'import', 'append'])
export function isWriteCommand(args) {
  return args.some((a) => WRITE_VERBS.has(String(a)))
}

/**
 * 设备码登录：后台拉起 CLI，收集前几秒输出后立即返回。
 * 不等登录完成——授权是异步的人机动作，不能阻塞工具调用。
 */
export function startDeviceLogin(cli, config, { scopes, signal } = {}) {
  const args = ['auth', 'login', '--device']
  if (scopes) args.push('--scopes', scopes)

  const state = {
    child: null,
    output: '',
    startedAt: Date.now(),
    settled: false,
    exitCode: null,
    error: null,
  }

  const child = spawn(cli, args, {
    env: buildEnv(config),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  state.child = child

  const append = (chunk) => {
    state.output += chunk.toString()
    if (state.output.length > 20_000) state.output = state.output.slice(-20_000)
  }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  child.on('error', (error) => { state.error = error; state.settled = true })
  child.on('close', (code) => { state.exitCode = code; state.settled = true })

  const timer = setTimeout(() => { state.settled = true }, config.loginTimeoutMs ?? DEFAULTS.loginTimeoutMs)
  child.on('close', () => clearTimeout(timer))
  if (signal) signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true })

  return state
}

/** 从 CLI 输出里尽力提取验证 URL 与 user_code；提取不到就原样返回。 */
export function extractDevicePrompt(output) {
  const text = String(output || '')
  const urlMatch = text.match(/https?:\/\/[^\s"'<>）)]+/)
  const codeMatch = text.match(/\b[A-Z0-9]{4,}(?:[-_][A-Z0-9]{4,})+\b/)
  return {
    url: urlMatch ? urlMatch[0] : '',
    userCode: codeMatch ? codeMatch[0] : '',
  }
}
