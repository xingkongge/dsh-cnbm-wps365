/**
 * 通过 DSH 的 ctx.webServer 注册一个同源控制台。
 *
 * 这是生态内的通行做法（dsh-knowledge 的管理台同样基于 ctx.webServer.register），
 * 优点是不依赖 slot / Host Remote 这类需要运行时检查的内部 API，
 * 且页面与 GUI 同源，直接访问 http://127.0.0.1:<port>/cnbm 即可。
 */
import { PAGE_HTML } from './ui-page.js'

const HTML = Buffer.from(PAGE_HTML, 'utf8')

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** 只接受回环地址访问，避免被外部页面借浏览器发起请求。 */
function isLoopbackRequest(req) {
  const host = String(req.headers.host || '')
  const name = host.replace(/:\d+$/, '')
  if (!LOOPBACK_HOSTS.has(name)) return false
  const origin = req.headers.origin
  if (origin) {
    try {
      const originHost = new URL(origin).host.replace(/:\d+$/, '')
      if (!LOOPBACK_HOSTS.has(originHost)) return false
    } catch {
      return false
    }
  }
  return true
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 1_000_000) req.destroy() })
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * @param ctx Cordis 上下文
 * @param {{ basePath?: string, ops: Record<string, Function> }} options
 * @returns {Function|null} 注销函数；没有 webServer 服务时返回 null
 */
export function registerWebUi(ctx, { basePath = '/cnbm', ops } = {}) {
  // 可选服务必须走 ctx.get；直接读 ctx.webServer 在服务不可解析时会抛
  // "cannot get property \"webServer\" without inject"，把整个插件一起带崩。
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer
  if (!webServer || typeof webServer.register !== 'function') return null

  const apiPrefix = `${basePath}/api/`
  // 同源页面/面板的 API 额外要求一个自定义请求头，挡住跨站页面与裸 GET。
  const API_HEADER = 'x-dsh-cnbm'

  async function handleApi(req, res, url) {
    const route = url.pathname.slice(apiPrefix.length)
    const q = url.searchParams
    try {
      if (route === 'status') return sendJson(res, 200, await ops.status())
      if (route === 'spaces') return sendJson(res, 200, await ops.spaces())
      if (route === 'nodes') {
        return sendJson(res, 200, await ops.nodes({
          spaceId: q.get('spaceId') || '',
          parentId: q.get('parentId') || '0',
          pageSize: q.get('pageSize') || undefined,
          pageToken: q.get('pageToken') || undefined,
        }))
      }
      if (route === 'search') {
        return sendJson(res, 200, await ops.search({
          keyword: q.get('keyword') || '',
          spaceIds: q.get('spaceIds') || '',
          pageSize: q.get('pageSize') || undefined,
        }))
      }
      if (route === 'read') {
        return sendJson(res, 200, await ops.read({ fileId: q.get('fileId') || '' }))
      }
      if (route === 'login') {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' }).end()
          return
        }
        return sendJson(res, 200, await ops.login({ scopes: q.get('scopes') || undefined }))
      }
      if (route === 'bind-app') {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' }).end()
          return
        }
        const body = await readJsonBody(req)
        return sendJson(res, 200, await ops.bindApp(body))
      }
      return sendJson(res, 404, { ok: false, error: `unknown api route: ${route}` })
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
    }
  }

  const dispose = webServer.register({
    kind: 'prefix',
    path: basePath,
    handler: (req, res) => {
      if (!isLoopbackRequest(req)) {
        res.writeHead(403).end('forbidden')
        return
      }
      let url
      try {
        url = new URL(req.url, 'http://127.0.0.1')
      } catch {
        res.writeHead(400).end('bad request')
        return
      }
      if (url.pathname.startsWith(apiPrefix)) {
        if (req.headers[API_HEADER] !== '1') {
          res.writeHead(403).end('forbidden')
          return
        }
        return handleApi(req, res, url)
      }
      if (url.pathname === basePath || url.pathname === `${basePath}/`) return sendHtml(res, 200, HTML)
      res.writeHead(404).end('not found')
    },
  })

  return dispose
}
