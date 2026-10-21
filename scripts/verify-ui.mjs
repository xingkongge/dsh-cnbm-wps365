/**
 * 手工验证脚本：把插件的 Web 控制台挂到一个真实 HTTP 服务上，逐个端点打一遍。
 * 需要完整磁盘权限（CLI 刷新令牌要写锁文件）。
 *
 *   node scripts/verify-ui.mjs
 */
import http from 'node:http'
import { apply } from '../index.js'

const registered = []
const ctx = {
  tools: { register: () => () => {} },
  effect: (fn) => fn(),
  webServer: {
    register(spec) {
      registered.push(spec)
      return () => {}
    },
  },
}

apply(ctx, {})

const spec = registered.find((entry) => entry.path === '/cnbm')
if (!spec) {
  console.error('未注册 /cnbm 路由')
  process.exit(1)
}

const server = http.createServer((req, res) => spec.handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const base = `http://127.0.0.1:${port}`
console.log(`控制台: ${base}/cnbm\n`)

const API_HEADERS = { 'x-dsh-cnbm': '1' }

async function hit(pathname, label) {
  const started = Date.now()
  const res = await fetch(base + pathname, { headers: API_HEADERS })
  const text = await res.text()
  console.log(`── ${label} ── ${res.status} ${Date.now() - started}ms  ${res.headers.get('content-type')}`)
  console.log(text.slice(0, 420).replace(/\n{3,}/g, '\n\n'))
  console.log()
  return { status: res.status, text }
}

const html = await hit('/cnbm', '页面')
console.log(`页面大小: ${html.text.length} 字符，外部资源引用: ${/<script[^>]+src=|<link[^>]+href=/.test(html.text) ? '有' : '无'}\n`)

const status = await hit('/cnbm/api/status', '状态')
const statusJson = JSON.parse(status.text)
console.log(`状态=${statusJson.state}  CLI=${statusJson.cliVersion}  scopes=${JSON.stringify(statusJson.grantedScopes)}\n`)

await hit('/cnbm/api/spaces', '知识库列表')

const spaces = await (await fetch(base + '/cnbm/api/spaces', { headers: API_HEADERS })).json()
let picked = null
for (const space of spaces.data || []) {
  const nodes = await (await fetch(`${base}/cnbm/api/nodes?spaceId=${space.id}&parentId=0`, { headers: API_HEADERS })).json()
  const files = (nodes.data || []).filter((n) => n.type === 'file')
  if (files.length) { picked = { space, files }; break }
}
if (!picked) {
  console.log('没有含文档的知识库，跳过搜索/读正文验证')
} else {
  const { space, files } = picked
  await hit(`/cnbm/api/nodes?spaceId=${space.id}&parentId=0`, `节点树（${space.name}）`)
  await hit(`/cnbm/api/search?keyword=${encodeURIComponent('方案')}&spaceIds=${space.id}`, '搜索')
  const read = await hit(`/cnbm/api/read?fileId=${files[0].id}`, `读正文（${files[0].name.slice(0, 24)}…）`)
  let payload = null
  try { payload = JSON.parse(read.text) } catch { /* 已被 hit() 截断显示 */ }
  if (payload) console.log(`正文: ${payload.ok ? payload.text.length + ' 字符' : '失败 ' + payload.error}\n`)
}

await hit('/cnbm/api/status?host=evil', '同源防护（应 200，路由内校验 Host 头）')
server.close()
