/**
 * 不依赖 DSH 的插件自测：用假 ctx 收集工具声明，再对本地 wps365-cli 副本真实执行。
 *
 * 运行：node --test test/
 */
import assert from 'node:assert/strict'
import { chmod, copyFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import {
  DEFAULTS,
  authNeedsLogin,
  classifyFailure,
  extractDevicePrompt,
  isWriteCommand,
  checkScope,
  probeBusinessCommands,
  readAuthStatus,
  resolveCliPath,
  runCli,
  truncate,
} from '../lib/runner.js'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const PLUGIN_DIR = path.resolve(HERE, '..')
const LOCAL_CLI = path.join(PLUGIN_DIR, '.tools', 'wps365-cli')
const SPEC_CACHE = path.join(PLUGIN_DIR, '.wpscfg')

const hasCli = await runCli(LOCAL_CLI, ['--version'], {}, { timeoutMs: 10_000 })

/** 收集工具注册的假 ctx。 */
function createFakeCtx() {
  const tools = new Map()
  const disposers = []
  return {
    tools: {
      register(definition) {
        if (tools.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`)
        tools.set(definition.name, definition)
        const dispose = () => tools.delete(definition.name)
        disposers.push(dispose)
        return dispose
      },
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    inspect: () => tools,
    disposeAll: () => disposers.splice(0).forEach((fn) => fn()),
  }
}

/** 复制一份可用的 spec 缓存，避免测试反复走网络。 */
async function makeConfigDir({ writable = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cnbm-test-'))
  if (writable) {
    await mkdir(path.join(dir, 'spec'), { recursive: true })
    for (const name of ['api.yaml', 'curated.yaml']) {
      try {
        await copyFile(path.join(SPEC_CACHE, 'spec', name), path.join(dir, 'spec', name))
      } catch {
        // 没有缓存就让 CLI 自己下载
      }
    }
  } else {
    await chmod(dir, 0o500)
  }
  return dir
}

describe('CLI 定位', () => {
  it('显式配置的路径优先', () => {
    assert.equal(resolveCliPath({ cliPath: LOCAL_CLI }), LOCAL_CLI)
  })

  it('PATH 为空时仍从 ~/.local/bin 兜底找到', () => {
    const saved = process.env.WPS365_CLI
    const savedPath = process.env.PATH
    delete process.env.WPS365_CLI
    process.env.PATH = '/nonexistent-dir'
    try {
      const found = resolveCliPath({})
      if (found !== null) assert.match(found, /wps365-cli$/)
    } finally {
      process.env.PATH = savedPath
      if (saved !== undefined) process.env.WPS365_CLI = saved
    }
  })
})

describe('命令探测（实测坑 A）', () => {
  it('配置目录可写时业务命令齐全', async () => {
    if (hasCli.missing) return
    const dir = await makeConfigDir()
    const probe = await probeBusinessCommands(LOCAL_CLI, { configDir: dir })
    assert.equal(probe.available, true, `missing: ${probe.missing.join(',')} / ${probe.output}`)
    await rm(dir, { recursive: true, force: true })
  })

  it('配置目录不可写时识别为 spec-unavailable 而不是未登录', async () => {
    if (hasCli.missing) return
    const dir = await makeConfigDir({ writable: false })
    const probe = await probeBusinessCommands(LOCAL_CLI, { configDir: dir })
    assert.equal(probe.available, false)
    assert.ok(['spec-unavailable', 'commands-missing'].includes(probe.reason), probe.reason)
    await chmod(dir, 0o700)
    await rm(dir, { recursive: true, force: true })
  })
})

describe('认证状态', () => {
  it('能解析出结构化认证状态（字段类型正确）', async () => {
    if (hasCli.missing) return
    const dir = await makeConfigDir()
    const status = await readAuthStatus(LOCAL_CLI, { configDir: dir })
    assert.equal(status.ok, true)
    // 凭证可能来自系统钥匙串（全局），因此不假设"空目录=未配置"
    assert.equal(typeof status.clientIdConfigured, 'boolean')
    assert.equal(typeof status.clientSecretConfigured, 'boolean')
    assert.equal(typeof status.delegated.available, 'boolean')
    assert.ok(status.grantedScopes === null || Array.isArray(status.grantedScopes))
    assert.equal(path.resolve(status.configDir), path.resolve(dir))
    await rm(dir, { recursive: true, force: true })
  })
})

describe('错误分类', () => {
  const cases = [
    [{ missing: true, stderr: '', stdout: '' }, 'cli-missing'],
    [{ stderr: 'Warning: save curated spec failed: create directory', stdout: '' }, 'spec-unavailable'],
    [{ stderr: 'ErrPrivileges: interface_company_doc not granted', stdout: '' }, 'entitlement-missing'],
    [{ stderr: 'insufficient_scope: kso.file.read', stdout: '' }, 'scope-missing'],
    [{ stderr: '账号不在应用可用范围内', stdout: '' }, 'out-of-range'],
    [{ stderr: 'app credentials not configured', stdout: '' }, 'credentials-missing'],
    [{ stderr: 'no delegated token available, please login', stdout: '' }, 'not-logged-in'],
    [{ stderr: 'HTTP 429 too many requests', stdout: '' }, 'rate-limited'],
    [{ stderr: 'token endpoint returned error 401 Unauthorized: {"code":40100009,"msg":"invalid_grant","debug":{"desc":"The refresh token has not been found: not_found"}}', stdout: '' }, 'auth-expired'],
  ]
  for (const [result, expected] of cases) {
    it(`映射 ${expected}`, () => {
      assert.equal(classifyFailure(result).code, expected)
    })
  }

  it('套餐权益不足与 scope 未开通必须区分', () => {
    const entitlement = classifyFailure({ stderr: '403000001 ErrPrivileges' })
    const scope = classifyFailure({ stderr: 'insufficient_scope' })
    assert.notEqual(entitlement.code, scope.code)
    assert.match(entitlement.hint, /套餐/)
  })
})

describe('自动重登配置', () => {
  it('只有 status=valid 才算可用；expired 视同未登录', () => {
    assert.equal(authNeedsLogin({ delegated: { available: true, status: 'valid' } }), false)
    assert.equal(authNeedsLogin({ delegated: { available: true, status: 'expired' } }), true)
    assert.equal(authNeedsLogin({ delegated: { available: false, status: 'unknown' } }), true)
    assert.equal(authNeedsLogin(null), true)
  })

  it('默认开启 autoRelogin，且 loginScopes 留空（沿用已授予 scope）', () => {
    assert.equal(DEFAULTS.autoRelogin, true)
    assert.equal(DEFAULTS.loginScopes, '')
  })
})

describe('工具函数', () => {
  it('设备码提示提取', () => {
    const prompt = extractDevicePrompt('请在浏览器打开 https://open.wps.cn/device 输入代码 ABCD-1234')
    assert.equal(prompt.url, 'https://open.wps.cn/device')
    assert.equal(prompt.userCode, 'ABCD-1234')
  })

  it('截断标注原文长度', () => {
    const out = truncate('x'.repeat(100), 10)
    assert.match(out, /已截断/)
    assert.match(out, /100/)
  })

  it('checkScope 命中已授予 scope 时不拦截', () => {
    assert.equal(checkScope({ grantedScopes: ['kso.wiki.readwrite'] }, ['kso.wiki.readwrite']), null)
  })

  it('checkScope 在缺 scope 时给出精确提示并列出已授予项', () => {
    const missing = checkScope({ grantedScopes: ['kso.wiki.readwrite'] }, ['kso.file.read', 'kso.file.readwrite'])
    assert.ok(missing)
    assert.match(missing.hint, /kso\.file\.read/)
    assert.match(missing.hint, /已授予：kso\.wiki\.readwrite/)
  })

  it('checkScope 在 scope 未知（null）时不拦截，交给服务端判定', () => {
    assert.equal(checkScope({ grantedScopes: null }, ['kso.file.read']), null)
  })

  it('写命令识别', () => {
    assert.equal(isWriteCommand(['drive', 'file', 'create']), true)
    assert.equal(isWriteCommand(['drive', 'file', 'search']), false)
  })
})

describe('插件装配', () => {
  let ctx
  before(async () => {
    const { apply } = await import('../index.js')
    ctx = createFakeCtx()
    apply(ctx, { cliPath: LOCAL_CLI, configDir: await makeConfigDir() })
  })
  after(() => ctx.disposeAll())

  it('注册了全部预期的工具且结构合法', () => {
    const names = [...ctx.inspect().keys()].sort()
    assert.deepEqual(names, [
      'cnbm_api', 'cnbm_docs_download', 'cnbm_docs_drives', 'cnbm_docs_list',
      'cnbm_docs_read', 'cnbm_docs_search', 'cnbm_login', 'cnbm_logout',
      'cnbm_me', 'cnbm_status',
      'cnbm_wiki_node_meta', 'cnbm_wiki_nodes', 'cnbm_wiki_read', 'cnbm_wiki_search',
      'cnbm_wiki_spaces',
    ])
    for (const [name, def] of ctx.inspect()) {
      assert.equal(def.name, name)
      assert.equal(typeof def.description, 'string')
      assert.ok(def.description.length > 10, `${name} 描述过短`)
      assert.equal(typeof def.output?.render, 'function', `${name} 缺少 output.render`)
      assert.equal(typeof def.execute, 'function', `${name} 缺少 execute`)
      assert.equal(def.parameters?.type, 'object', `${name} parameters 必须是 object`)
    }
  })

  it('cnbm_status 端到端跑真实 CLI', async () => {
    const def = ctx.inspect().get('cnbm_status')
    const text = await def.execute({}, { signal: new AbortController().signal })
    assert.match(text, /版本：wps365-cli version/)
    assert.match(text, /版本兼容（要求/)
    // 状态取决于本机实际登录情况，只断言"落在已知状态之一"
    assert.match(text, /状态：(cli-missing|spec-unavailable|auth-status-unreadable|credentials-missing|not-logged-in|logged-in-but-scopeless|logged-in)/)
  })

  it('cnbm_me 要么返回用户信息，要么给出可执行指引——绝不抛错', async () => {
    const def = ctx.inspect().get('cnbm_me')
    const text = String(await def.execute({}, { signal: new AbortController().signal }))
    assert.ok(text.length > 0)
    // 认证状态来自系统钥匙串（全局），因此这里只要求二者之一成立
    const isData = /"code"\s*:\s*0/.test(text)
    const isGuidance = /未配置应用凭证|尚未登录|无法执行|未授予所需权限/.test(text)
    assert.ok(isData || isGuidance, `既不是数据也不是指引：${text.slice(0, 200)}`)
  })

  it('未登录时写 API 在鉴权阶段就被拦下', async () => {
    const def = ctx.inspect().get('cnbm_api')
    const text = await def.execute({ method: 'post', path: '/v7/x' }, { signal: new AbortController().signal })
    assert.match(text, /尚未登录|未配置应用凭证|只读模式|未授予所需权限/)
  })
})

describe('知识库（真实链路，未登录自动跳过）', () => {
  it('cnbm_wiki_spaces 能返回知识库列表', async () => {
    const { apply } = await import('../index.js')
    const liveCtx = createFakeCtx()
    apply(liveCtx, { cliPath: LOCAL_CLI })
    try {
      const def = liveCtx.inspect().get('cnbm_wiki_spaces')
      const text = await def.execute({}, { signal: new AbortController().signal })
      if (/尚未登录|登录已过期|invalid_grant|未授予|未配置|无法读取|operation not permitted|EPERM/.test(text)) {
        console.log(`  # 跳过：${text.split('\n')[0]}`)
        return
      }
      assert.match(text, /space-id:/)
    } finally {
      liveCtx.disposeAll()
    }
  })

  it('cnbm_wiki_read 能读出清洗后的正文', async () => {
    const { apply } = await import('../index.js')
    const liveCtx = createFakeCtx()
    apply(liveCtx, { cliPath: LOCAL_CLI })
    try {
      const tools = liveCtx.inspect()
      const spacesText = await tools.get('cnbm_wiki_spaces').execute({}, { signal: new AbortController().signal })
      const spaceId = spacesText.match(/space-id: (\S+)/)?.[1]
      if (!spaceId) { console.log('  # 跳过：没有可用知识库'); return }
      const nodesText = await tools.get('cnbm_wiki_nodes').execute(
        { spaceId, parentId: '0' }, { signal: new AbortController().signal })
      const fileId = nodesText.match(/id: ([\w-]+)/)?.[1]
      if (!fileId) { console.log('  # 跳过：没有文档节点'); return }
      const body = String(await tools.get('cnbm_wiki_read').execute(
        { fileId }, { signal: new AbortController().signal }))
      if (/登录已过期|invalid_grant|未授予|尚未登录|没有返回正文|operation not permitted|EPERM/.test(body)) { console.log(`  # 跳过：${body.split('\n')[0]}`); return }
      assert.ok(body.length > 200, '正文过短')
      assert.ok(!/HYPERLINK|PAGEREF/.test(body), '残留 Word 目录域代码')
      assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(body), '残留控制字符')
    } finally {
      liveCtx.disposeAll()
    }
  })
})
