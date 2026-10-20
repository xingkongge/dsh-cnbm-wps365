/**
 * Web 控制台路由测试：用假 ctx.webServer 捕获路由注册，再模拟请求。
 * 不依赖真实 DSH 运行环境。
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { apply } from '../index.js'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const LOCAL_CLI = path.join(HERE, '..', '.tools', 'wps365-cli')

function makeCtx() {
  const registered = []
  const toolMap = new Map()
  const ctx = {
    tools: {
      register(definition) {
        toolMap.set(definition.name, definition)
        return () => toolMap.delete(definition.name)
      },
    },
    effect(callback) {
      return callback()
    },
    // 真实 Harness 里 webServer 可能晚于插件就绪；镜像这个时序
    inject(services, callback) {
      if (services.includes('webServer') && this.webServer) callback(this)
    },
    webServer: {
      register(spec) {
        registered.push(spec)
        return () => {
          const index = registered.indexOf(spec)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
    registered,
    toolMap,
  }
  return ctx
}

function makeReq(url, { method = 'GET', host = '127.0.0.1:19387', origin, api = true } = {}) {
  return {
    url,
    method,
    headers: { host, ...(api ? { 'x-dsh-wps365': '1' } : {}), ...(origin ? { origin } : {}) },
  }
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(code, headers) {
      this.statusCode = code
      Object.assign(this.headers, headers || {})
      return this
    },
    end(chunk) {
      if (chunk) this.body += String(chunk)
      return this
    },
  }
}

describe('Web 控制台', () => {
  let ctx
  let handler

  before(async () => {
    ctx = makeCtx()
    apply(ctx, { cliPath: LOCAL_CLI })
    const spec = ctx.registered.find((entry) => entry.path === '/wps365')
    assert.ok(spec, '应当注册 /wps365 路由')
    handler = spec.handler
  })

  after(() => {
    ctx.registered.length = 0
  })

  async function call(url, options) {
    const res = makeRes()
    await handler(makeReq(url, options), res)
    return res
  }

  it('注册了 prefix 路由', () => {
    const spec = ctx.registered.find((entry) => entry.path === '/wps365')
    assert.equal(spec.kind, 'prefix')
  })

  it('根路径返回自包含 HTML 页面', async () => {
    const res = await call('/wps365')
    assert.equal(res.statusCode, 200)
    assert.match(res.headers['content-type'], /text\/html/)
    assert.match(res.body, /cnbm知识库/)
    // 自包含：不应引用任何外部脚本/样式
    assert.ok(!/<script[^>]+src=/.test(res.body), '不应有外部脚本')
    assert.ok(!/<link[^>]+href=/.test(res.body), '不应有外部样式')
  })

  it('结尾斜杠也返回页面', async () => {
    const res = await call('/wps365/')
    assert.equal(res.statusCode, 200)
    assert.match(res.body, /cnbm知识库/)
  })

  it('api/status 返回结构化状态', async () => {
    const res = await call('/wps365/api/status')
    assert.equal(res.statusCode, 200)
    const payload = JSON.parse(res.body)
    assert.equal(payload.ok, true)
    assert.ok(typeof payload.state === 'string' && payload.state.length > 0)
    assert.ok('grantedScopes' in payload)
  })

  it('api/spaces 走真实链路（未登录时返回可读错误而不是崩溃）', async () => {
    const res = await call('/wps365/api/spaces')
    assert.equal(res.statusCode, 200)
    const payload = JSON.parse(res.body)
    assert.ok(typeof payload.ok === 'boolean')
    if (!payload.ok) assert.ok(payload.error && payload.error.length > 0)
    else assert.ok(Array.isArray(payload.data))
  })

  it('api/nodes 拒绝非法 ID', async () => {
    const res = await call('/wps365/api/nodes?spaceId=..%2F..&parentId=0')
    const payload = JSON.parse(res.body)
    assert.equal(payload.ok, false)
    assert.match(payload.error, /不合法/)
  })

  it('api/read 拒绝非法 ID', async () => {
    const res = await call('/wps365/api/read?fileId=a%2Fb')
    const payload = JSON.parse(res.body)
    assert.equal(payload.ok, false)
    assert.match(payload.error, /不合法/)
  })

  it('未知 api 路由返回 404', async () => {
    const res = await call('/wps365/api/nope')
    assert.equal(res.statusCode, 404)
    assert.equal(JSON.parse(res.body).ok, false)
  })

  it('非回环 Host 被拒绝', async () => {
    const res = await call('/wps365/api/status', { host: 'evil.example.com' })
    assert.equal(res.statusCode, 403)
  })

  it('跨站 Origin 被拒绝', async () => {
    const res = await call('/wps365/api/status', { origin: 'https://evil.example.com' })
    assert.equal(res.statusCode, 403)
  })

  it('API 缺少自定义请求头被拒绝', async () => {
    const res = await call('/wps365/api/status', { api: false })
    assert.equal(res.statusCode, 403)
  })

  it('页面本身不需要自定义请求头', async () => {
    const res = await call('/wps365', { api: false })
    assert.equal(res.statusCode, 200)
  })

  it('login 只接受 POST', async () => {
    const res = await call('/wps365/api/login')
    assert.equal(res.statusCode, 405)
  })
})
