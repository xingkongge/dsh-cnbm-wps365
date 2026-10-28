/**
 * cnbm知识库 Web 客户端：把插件面板注册进 Harness 的侧栏与中央面板槽位。
 *
 * - 侧栏图标：sidebar.panellist（id/order/label，图标组件拿 { size, active }）
 * - 中央面板：main（key 与侧栏 id 相同，点击侧栏图标即切换到这里）
 * - 数据：复用 Host 已注册的同源 JSON 接口 /cnbm/api/*
 *
 * 不引入构建步骤：组件用 React.createElement 手写，React 由 Harness 的模块表提供。
 * 样式只依赖 --dsw-alias-* 主题 token，深浅色由宿主切换。
 */
window.__ModuleLoader__.load({
  id: '@cnbm/dsh-wps365',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'cnbm-knowledge'
    const API_PREFIX = '/cnbm/api/'
    const REQUEST_HEADER = { 'x-dsh-cnbm': '1' }

    const STYLE_MARK = 'dsh-cnbm/panel.css'
    const STYLE = `
.cnbm-panel {
  box-sizing: border-box; height: 100%; overflow: auto; padding: 20px 24px 56px;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);
  font: 14px/1.55 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
}
.cnbm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.cnbm-title { font-size: 18px; font-weight: 650; letter-spacing: .2px; }
.cnbm-sub { margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.cnbm-actions { display: flex; gap: 8px; flex-shrink: 0; }
.cnbm-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
.cnbm-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.cnbm-row-between { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.cnbm-k { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.cnbm-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.cnbm-badge.ok { color: var(--dsw-alias-state-success-primary); border: 1px solid currentColor; }
.cnbm-badge.warn { color: var(--dsw-alias-state-warn-primary); border: 1px solid currentColor; }
.cnbm-badge.err { color: var(--dsw-alias-state-error-primary); border: 1px solid currentColor; }
.cnbm-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.cnbm-chip { background: var(--dsw-alias-bg-layer-2); border-radius: 6px; padding: 2px 8px; font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.cnbm-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 8px; }
.cnbm-hint code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.cnbm-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
.cnbm-tab { padding: 7px 14px; border-radius: 8px; border: 1px solid transparent; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.cnbm-tab[aria-selected="true"] { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary); font-weight: 600; }
.cnbm-btn { padding: 6px 12px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 13px; }
.cnbm-btn:hover { border-color: var(--dsw-alias-brand-primary); }
.cnbm-btn[disabled] { opacity: .5; cursor: default; }
.cnbm-btn:focus-visible, .cnbm-tab:focus-visible, .cnbm-input:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.cnbm-input { box-sizing: border-box; padding: 7px 10px; border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); font-size: 13px; min-width: 240px; }
.cnbm-crumb { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-bottom: 8px;
  display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.cnbm-crumb a { color: var(--dsw-alias-brand-primary); text-decoration: none; cursor: pointer; }
.cnbm-list { list-style: none; margin: 0; padding: 0; }
.cnbm-list li { padding: 9px 10px; border-radius: 8px; cursor: pointer;
  display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.cnbm-list li:hover { background: var(--dsw-alias-bg-layer-2); }
.cnbm-name { font-weight: 520; word-break: break-word; }
.cnbm-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: nowrap; }
.cnbm-empty { color: var(--dsw-alias-label-secondary); padding: 16px 4px; }
.cnbm-err { color: var(--dsw-alias-state-error-primary); }
.cnbm-reader-title { font-weight: 650; }
.cnbm-body { white-space: pre-wrap; word-break: break-word; background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 12px;
  max-height: 520px; overflow: auto; font-size: 13px; margin: 8px 0 0; }
.cnbm-result { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 10px 12px; margin-top: 10px; }
.cnbm-snippet { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 4px; word-break: break-word; }
.cnbm-link { color: var(--dsw-alias-brand-primary); text-decoration: none; word-break: break-all; }
`

    // ── 同源数据通道 ────────────────────────────────────────────
    function api(path, init) {
      const options = Object.assign({ headers: Object.assign({ accept: 'application/json' }, REQUEST_HEADER) }, init || {})
      if (options.body !== undefined && options.headers['content-type'] === undefined) {
        options.headers['content-type'] = 'application/json'
      }
      return fetch(API_PREFIX + path, options).then((response) => response.json())
    }

    function humanSize(size) {
      if (!size) return ''
      if (size > 1048576) return (size / 1048576).toFixed(1) + ' MB'
      return Math.max(1, Math.round(size / 1024)) + ' KB'
    }

    /** WPS 搜索片段带 <em> 高亮标签；面板按纯文本渲染，去掉标签即可。 */
    function plain(text) {
      return String(text == null ? '' : text).replace(/<\/?em>/gi, '')
    }

    /** auth status 仍显示“已登录”，但真正调用时 refresh token 已失效。 */
    function isExpiredText(text) {
      return /登录已过期|invalid_grant|401 Unauthorized|refresh token/i.test(String(text || ''))
    }

    /** 首次登录没有历史 scope 时使用团队默认申请集。 */
    const DEFAULT_SCOPES = ['kso.wiki.readwrite', 'kso.user_base.read', 'kso.file.read']

    const STATE_LABEL = {
      'logged-in': ['已登录', 'ok'],
      'logged-in-but-scopeless': ['已登录但无权限', 'warn'],
      'not-logged-in': ['未登录', 'warn'],
      'auth-expired': ['登录已过期', 'warn'],
      'credentials-missing': ['未配置应用凭证', 'err'],
      'spec-unavailable': ['命令集未加载', 'err'],
      'cli-missing': ['未安装 CLI', 'err'],
      'auth-status-unreadable': ['认证状态不可读', 'err'],
    }

    // ── 侧栏图标 ────────────────────────────────────────────────
    function WpsIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 24
      const active = !!(props && props.active)
      return h('svg', {
        viewBox: '0 0 64 64', width: size, height: size, role: 'img', 'aria-label': 'cnbm知识库',
        style: { display: 'block', opacity: active ? 1 : 0.9 },
      },
      h('rect', { x: 8, y: 14, width: 36, height: 42, rx: 5,
        fill: 'var(--dsw-alias-bg-layer-2, #f0f0f0)', stroke: 'currentColor', strokeWidth: 2 }),
      h('path', { d: 'M18 24h16M18 32h16M18 40h9', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' }),
      h('path', { d: 'M44 22a12 12 0 0 1 12 12v10H44z', fill: 'var(--dsw-alias-brand-primary, #ff6a00)' }),
      h('circle', { cx: 50, cy: 44, r: 3, fill: 'var(--dsw-alias-bg-base, #fff)' }))
    }

    // ── 面板本身 ────────────────────────────────────────────────
    function WpsPanel() {
      const [status, setStatus] = React.useState(null)
      const [statusError, setStatusError] = React.useState('')
      const [tab, setTab] = React.useState('wiki')
      const [spaces, setSpaces] = React.useState([])
      const [space, setSpace] = React.useState(null)
      const [path, setPath] = React.useState([])
      const [nodes, setNodes] = React.useState([])
      const [listLoading, setListLoading] = React.useState(false)
      const [listError, setListError] = React.useState('')
      const [reader, setReader] = React.useState(null)
      const [keyword, setKeyword] = React.useState('')
      const [search, setSearch] = React.useState(null)
      const [login, setLogin] = React.useState(null)
      const [updates, setUpdates] = React.useState(null)
      const [updating, setUpdating] = React.useState('')
      const [appForm, setAppForm] = React.useState({ clientId: '', clientSecret: '', apiBase: '' })
      const [binding, setBinding] = React.useState(false)
      const autoLoginRef = React.useRef(false)
      const [busy, setBusy] = React.useState(false)
      const [expired, setExpired] = React.useState(false)

      const loadStatus = React.useCallback(async () => {
        try {
          const next = await api('status')
          setStatus(next)
          setStatusError('')
          if (next && next.state !== 'logged-in') setExpired(false)
          // 服务端已自动发起重登：直接把验证地址/用户码显示到面板
          if (next && next.login && next.login.pending) {
            setLogin({ pending: true, url: next.login.url || '', userCode: next.login.userCode || '', qr: next.login.qr || '' })
          }
          return next
        } catch (error) {
          setStatusError(String((error && error.message) || error))
          return null
        }
      }, [])

      const loadSpaces = React.useCallback(async () => {
        try {
          const result = await api('spaces')
          if (result.ok) {
            setSpaces(result.data || [])
            setListError('')
            setExpired(false)
          } else {
            setListError(result.error || '读取知识库失败')
            if (isExpiredText(result.error)) setExpired(true)
          }
        } catch (error) {
          const message = String((error && error.message) || error)
          setListError(message)
          if (isExpiredText(message)) setExpired(true)
        }
      }, [])

      const loadNodes = React.useCallback(async (spaceId, parentId) => {
        setListLoading(true)
        try {
          const result = await api('nodes?spaceId=' + encodeURIComponent(spaceId) + '&parentId=' + encodeURIComponent(parentId))
          if (result.ok) {
            setNodes(result.data || [])
            setListError('')
            setExpired(false)
          } else {
            setNodes([])
            setListError(result.error || '读取目录失败')
            if (isExpiredText(result.error)) setExpired(true)
          }
        } catch (error) {
          const message = String((error && error.message) || error)
          setNodes([])
          setListError(message)
          if (isExpiredText(message)) setExpired(true)
        } finally {
          setListLoading(false)
        }
      }, [])

      React.useEffect(() => { void loadStatus() }, [loadStatus])

      // 登录后才拉知识库，避免未登录时把错误当噪声刷屏。
      const canBrowse = !!status && (status.state === 'logged-in' || status.state === 'logged-in-but-scopeless')
      React.useEffect(() => {
        if (canBrowse) void loadSpaces()
      }, [canBrowse, loadSpaces])

      // 发起登录后轮询：用一次真实读取判断授权是否完成。
      // 不能只看 status.state === 'logged-in'——过期令牌下 auth status 仍会这样报告。
      const loginPending = !!(login && login.pending)
      React.useEffect(() => {
        if (!loginPending) return undefined
        const timer = setInterval(async () => {
          const next = await loadStatus()
          if (next && next.state === 'logged-in') {
            setLogin(null)
            setExpired(false)
            autoLoginRef.current = false
            await loadSpaces()
            return
          }
          if (next && next.login && next.login.pending) {
            setLogin((prev) => (prev
              ? Object.assign({}, prev, { url: next.login.url || prev.url, userCode: next.login.userCode || prev.userCode, qr: next.login.qr || prev.qr })
              : prev))
          }
        }, 3000)
        const expiry = setTimeout(() => {
          setLogin((prev) => (prev ? Object.assign({}, prev, { pending: false, error: '授权超时，请重新发起登录。' }) : prev))
        }, 300000)
        return () => { clearInterval(timer); clearTimeout(expiry) }
      }, [loginPending, loadStatus, loadSpaces])

      // 登录过期时自动发起重登（只触发一次）
      React.useEffect(() => {
        if (!status || status.state !== 'auth-expired') return
        if (autoLoginRef.current) return
        autoLoginRef.current = true
        void startLogin()
      }, [status])

      async function startLogin() {
        setBusy(true)
        try {
          const scopes = (status && status.grantedScopes && status.grantedScopes.length)
            ? status.grantedScopes
            : DEFAULT_SCOPES
          const query = scopes.length ? '?scopes=' + encodeURIComponent(scopes.join(',')) : ''
          const result = await api('login' + query, { method: 'POST' })
          if (!result.ok) {
            setLogin({ pending: false, error: result.error || '发起登录失败' })
          } else {
            setLogin({ pending: true, url: result.url || '', userCode: result.userCode || '', qr: result.qr || '', raw: result.raw || '' })
          }
        } catch (error) {
          setLogin({ pending: false, error: String((error && error.message) || error) })
        } finally {
          setBusy(false)
        }
      }

      async function checkUpdates() {
        setBusy(true)
        try { const r = await api('update-check'); setUpdates(r.repos || []) } catch (e) { setLogin({ pending: false, error: String(e.message || e) }) } finally { setBusy(false) }
      }

      async function doUpdate(key) {
        setUpdating(key)
        try {
          const r = await api('update', { method: 'POST', body: JSON.stringify({ key }) })
          if (!r.ok) setLogin({ pending: false, error: r.error || '更新失败' })
          else { setLogin({ pending: false, error: '' }); await checkUpdates(); setBusy(true) }
        } catch (e) { setLogin({ pending: false, error: String(e.message || e) }) } finally { setUpdating('') }
      }

      function renderUpdates() {
        return h('section', { className: 'cnbm-card' },
          h('div', { className: 'cnbm-row-between' },
            h('div', { className: 'cnbm-muted', style: { fontSize: 12 } }, '插件更新（GitHub Releases）'),
            h('button', { className: 'cnbm-btn', type: 'button', disabled: busy, onClick: () => void checkUpdates() }, '检查更新')),
          updates ? h('div', null, updates.map((u) => h('div', { key: u.key, className: 'cnbm-row', style: { justifyContent: 'space-between', marginTop: 8 } },
            h('span', null, h('b', null, u.key === 'cnbm' ? 'cnbm知识库' : '数字售前'), ` 本地 ${u.local || '?'} · 最新 ${u.latest || '?'}`),
            u.error ? h('span', { className: 'cnbm-hint' }, u.error)
              : u.hasUpdate ? h('button', { className: 'cnbm-btn', type: 'button', disabled: Boolean(updating), onClick: () => void doUpdate(u.key) }, updating === u.key ? '更新中…' : '更新')
                : h('span', { className: 'cnbm-hint' }, '已是最新')))) : null,
          h('div', { className: 'cnbm-hint', style: { marginTop: 6 } }, '更新后需完全重启 DSH。'))
      }

      async function resetAuth() {
        setBusy(true)
        try {
          const r = await api('reset-auth', { method: 'POST' })
          if (!r.ok) setLogin({ pending: false, error: r.error || '清除令牌失败' })
          else setLogin({ pending: true, url: r.url || '', userCode: r.userCode || '', qr: r.qr || '' })
        } catch (e) {
          setLogin({ pending: false, error: String(e.message || e) })
        } finally { setBusy(false) }
      }

      async function bindApp() {
        if (!appForm.clientId.trim() || !appForm.clientSecret.trim()) {
          setLogin({ pending: false, error: '请填写 App ID 和 App Secret' })
          return
        }
        setBinding(true)
        try {
          const r = await api('bind-app', { method: 'POST', body: JSON.stringify(appForm) })
          if (!r.ok) setLogin({ pending: false, error: r.error || '绑定失败' })
          else { setLogin(null); await loadStatus(); await startLogin() }
        } catch (error) {
          setLogin({ pending: false, error: String((error && error.message) || error) })
        } finally { setBinding(false) }
      }

      function openSpace(item) {
        setSpace({ id: item.id, name: item.name })
        setPath([{ id: '0', name: item.name }])
        setNodes([])
        void loadNodes(item.id, '0')
      }

      function openDir(item) {
        if (!space) return
        setPath((prev) => prev.concat([{ id: item.id, name: item.name }]))
        void loadNodes(space.id, item.id)
      }

      function goTo(index) {
        if (!space) return
        const next = path.slice(0, index + 1)
        setPath(next)
        void loadNodes(space.id, next[next.length - 1].id)
      }

      function goRoot() {
        setSpace(null)
        setPath([])
        setNodes([])
        void loadSpaces()
      }

      async function openFile(id, name) {
        setReader({ title: name || '正文', text: '读取中…', error: '' })
        try {
          const result = await api('read?fileId=' + encodeURIComponent(id))
          const failure = result.ok ? '' : (result.error || '读取失败')
          setReader({ title: name || '正文', text: result.ok ? result.text : '', error: failure })
          if (isExpiredText(failure)) setExpired(true)
        } catch (error) {
          const message = String((error && error.message) || error)
          setReader({ title: name || '正文', text: '', error: message })
          if (isExpiredText(message)) setExpired(true)
        }
      }

      async function doSearch() {
        const query = keyword.trim()
        if (!query) return
        setSearch({ loading: true, items: [], error: '' })
        try {
          let ids = space ? space.id : spaces.map((item) => item.id).join(',')
          if (!ids) {
            const result = await api('spaces')
            ids = (result.data || []).map((item) => item.id).join(',')
          }
          if (!ids) {
            setSearch({ loading: false, items: [], error: '没有可搜索的知识库' })
            return
          }
          const result = await api('search?keyword=' + encodeURIComponent(query) + '&spaceIds=' + encodeURIComponent(ids))
          const failure = result.ok ? '' : (result.error || '搜索失败')
          setSearch({ loading: false, items: result.ok ? (result.data || []) : [], error: failure })
          if (isExpiredText(failure)) setExpired(true)
        } catch (error) {
          const message = String((error && error.message) || error)
          setSearch({ loading: false, items: [], error: message })
          if (isExpiredText(message)) setExpired(true)
        }
      }

      async function refresh() {
        const next = await loadStatus()
        if (space && (next ? next.state === 'logged-in' : true)) {
          void loadNodes(space.id, path.length ? path[path.length - 1].id : '0')
        } else if (!space) {
          void loadSpaces()
        }
      }

      // ── 状态卡 ──────────────────────────────────────────────
      function renderStatus() {
        if (statusError) {
          return h('section', { className: 'cnbm-card' },
            h('span', { className: 'cnbm-badge err' }, '无法连接'),
            h('div', { className: 'cnbm-hint' }, statusError))
        }
        if (!status) {
          return h('section', { className: 'cnbm-card' },
            h('span', { className: 'cnbm-badge warn' }, '检查中…'))
        }
        let hit = STATE_LABEL[status.state] || [status.state || '未知', 'warn']
        if (expired) hit = ['登录已过期', 'warn']
        const loggedIn = status.state === 'logged-in'
        const scopes = status.grantedScopes || []
        let hint = ''
        if (expired) {
          hint = h('div', { className: 'cnbm-hint' },
            '授权已过期，点「重新登录」用同一个企业账号重新授权；现有 scope 会一并带上。')
        } else if (status.state === 'cli-missing') {
          hint = h('div', { className: 'cnbm-hint' }, '安装：',
            h('code', null, 'curl -fsSL https://open-docs.wpscdn.cn/cli/install.sh | bash'))
        } else if (status.state === 'credentials-missing') {
          hint = h('div', null,
            h('div', { className: 'cnbm-hint' }, '首次使用：填入团队 WPS 应用的 App ID / App Secret（只保存到本机钥匙串）。'),
            h('div', { className: 'cnbm-row', style: { marginTop: 8 } },
              h('input', { className: 'cnbm-input', placeholder: 'App ID', value: appForm.clientId, onChange: (e) => setAppForm({ ...appForm, clientId: e.target.value }) }),
              h('input', { className: 'cnbm-input', placeholder: 'App Secret', type: 'password', value: appForm.clientSecret, onChange: (e) => setAppForm({ ...appForm, clientSecret: e.target.value }) }),
              h('button', { className: 'cnbm-btn', type: 'button', disabled: binding, onClick: () => void bindApp() }, binding ? '绑定中…' : '保存并登录')))
        } else if (status.state === 'not-logged-in' || status.state === 'logged-in-but-scopeless') {
          hint = h('div', { className: 'cnbm-hint' }, '下一步：点「登录 WPS」，用企业账号完成设备码授权。')
        } else if (status.configDir) {
          hint = h('div', { className: 'cnbm-hint' }, '配置目录：' + status.configDir)
        }
        return h('section', { className: 'cnbm-card' },
          h('div', { className: 'cnbm-row-between' },
            h('div', { className: 'cnbm-row' },
              h('span', { className: 'cnbm-k' }, '状态'),
              h('span', { className: 'cnbm-badge ' + hit[1] }, hit[0]),
              h('span', { className: 'cnbm-k' }, status.cliVersion ? 'CLI ' + status.cliVersion : ''),
              status.clientId ? h('span', { className: 'cnbm-k' }, 'App ' + status.clientId) : null),
            h('div', { className: 'cnbm-row' },
              status.state === 'cli-missing' || status.state === 'credentials-missing'
                ? null
                : h('button', { className: 'cnbm-btn', type: 'button', disabled: busy, onClick: startLogin },
                  busy ? '发起中…' : (loggedIn ? '重新登录' : '登录 WPS')),
              status.state === 'cli-missing' || status.state === 'credentials-missing'
                ? null
                : h('button', { className: 'cnbm-btn', type: 'button', disabled: busy, onClick: () => void resetAuth() }, '清除令牌重授'),
              h('button', { className: 'cnbm-btn', type: 'button', onClick: refresh }, '刷新'))),
          h('div', { className: 'cnbm-chips' },
            scopes.length
              ? scopes.map((scope) => h('span', { key: scope, className: 'cnbm-chip' }, scope))
              : h('span', { className: 'cnbm-hint' }, '未授予任何 scope')),
          status.loginScopes ? h('div', { className: 'cnbm-hint' }, '登录申请：' + status.loginScopes) : null,
          status.missingScopes && status.missingScopes.length
            ? h('div', { className: 'cnbm-hint' }, '缺少必需 scope：' + status.missingScopes.join('、') + '。点「重新登录」会一次性申请全部必需 scope；若仍缺少，需管理员在 WPS 应用后台为这些 scope 审批用户授权。')
            : null,
          hint,
          login && login.error ? h('div', { className: 'cnbm-hint cnbm-err' }, login.error) : null,
          login && login.pending
            ? h('div', { className: 'cnbm-hint' },
              login.qr ? h('img', { src: login.qr, alt: '登录二维码', width: 180, height: 180, style: { display: 'block', margin: '8px 0', borderRadius: 8 } }) : null,
              '扫码或打开链接完成授权：',
              login.url ? h('div', null, h('a', { className: 'cnbm-link', href: login.url, target: '_blank', rel: 'noopener' }, login.url)) : null,
              login.userCode ? h('div', null, '用户码：', h('strong', null, login.userCode)) : null,
              h('div', null, '授权完成后本面板会自动刷新。'))
            : null)
      }

      // ── 知识库浏览 ──────────────────────────────────────────
      function renderWiki() {
        const crumb = []
        if (space) {
          crumb.push(h('a', { key: 'root', onClick: () => goTo(0) }, space.name))
          path.slice(1).forEach((item, index) => {
            const target = index + 1
            crumb.push(h('span', { key: 'sep' + target }, '/'))
            crumb.push(h('a', { key: 'crumb' + target, onClick: () => goTo(target) }, item.name))
          })
        }
        let body
        if (listLoading) body = h('li', { className: 'cnbm-empty' }, '加载中…')
        else if (listError) body = h('li', { className: 'cnbm-err' }, listError)
        else if (!space) {
          body = spaces.length
            ? spaces.map((item) => h('li', { key: item.id, onClick: () => openSpace(item) },
              h('span', { className: 'cnbm-name' }, item.name),
              h('span', { className: 'cnbm-meta' }, '知识库')))
            : h('li', { className: 'cnbm-empty' }, canBrowse ? '没有可访问的知识库' : '登录后可浏览知识库')
        } else {
          const rows = []
          if (path.length > 1) rows.push(h('li', { key: 'up', onClick: () => goTo(path.length - 2) },
            h('span', { className: 'cnbm-name' }, '↩︎ 返回上级')))
          nodes.forEach((item) => {
            const isFile = item.type === 'file'
            rows.push(h('li', {
              key: item.id,
              onClick: () => (isFile ? openFile(item.id, item.name) : openDir(item)),
            },
            h('span', { className: 'cnbm-name' }, (isFile ? '📄 ' : '📁 ') + item.name),
            h('span', { className: 'cnbm-meta' }, isFile ? humanSize(item.size) : '文件夹')))
          })
          body = rows.length ? rows : h('li', { className: 'cnbm-empty' }, '该目录为空')
        }
        return h('section', { className: 'cnbm-card' },
          h('div', { className: 'cnbm-crumb' },
            space ? crumb : h('span', null, '全部知识库'),
            space ? h('button', { className: 'cnbm-btn', type: 'button', style: { marginLeft: 'auto' }, onClick: goRoot }, '返回知识库列表') : null),
          h('ul', { className: 'cnbm-list' }, body))
      }

      // ── 搜索 ────────────────────────────────────────────────
      function renderSearch() {
        let results = null
        if (search) {
          if (search.loading) results = h('div', { className: 'cnbm-empty' }, '搜索中…')
          else if (search.error) results = h('div', { className: 'cnbm-err' }, search.error)
          else if (!search.items.length) results = h('div', { className: 'cnbm-empty' }, '没有匹配结果')
          else {
            results = search.items.map((hit, index) => {
              const file = hit.file || {}
              const snippets = (hit.highlights || [])
                .filter((entry) => entry.values && entry.values.length)
                .map((entry, snippetIndex) => h('div', { key: 'snip' + index + '-' + snippetIndex, className: 'cnbm-snippet' },
                  entry.key + '：' + plain(entry.values.join(' … '))))
              return h('div', { key: file.id || index, className: 'cnbm-result' },
                h('div', { className: 'cnbm-row-between' },
                  h('strong', null, (index + 1) + '. ' + (file.name || '(未命名)')),
                  h('button', { className: 'cnbm-btn', type: 'button', onClick: () => openFile(file.id, file.name) }, '读正文')),
                snippets)
            })
          }
        }
        return h('section', { className: 'cnbm-card' },
          h('div', { className: 'cnbm-row' },
            h('input', {
              className: 'cnbm-input', type: 'text', placeholder: '输入关键字，例如：安全监管',
              value: keyword, onChange: (event) => setKeyword(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') void doSearch() },
            }),
            h('button', { className: 'cnbm-btn', type: 'button', onClick: () => void doSearch() }, '搜索'),
            h('span', { className: 'cnbm-hint' },
              search && !search.loading && !search.error ? (search.items.length + ' 条结果') : '')),
          results)
      }

      function renderReader() {
        if (!reader) return null
        return h('section', { className: 'cnbm-card' },
          h('div', { className: 'cnbm-row-between' },
            h('strong', { className: 'cnbm-reader-title' }, reader.title),
            h('button', { className: 'cnbm-btn', type: 'button', onClick: () => setReader(null) }, '关闭')),
          reader.error
            ? h('div', { className: 'cnbm-hint cnbm-err' }, reader.error)
            : h('pre', { className: 'cnbm-body' }, reader.text))
      }

      return h('div', { className: 'cnbm-panel' },
        h('header', { className: 'cnbm-head' },
          h('div', null,
            h('div', { className: 'cnbm-title' }, 'cnbm知识库'),
            h('div', { className: 'cnbm-sub' }, '以当前登录人身份读取知识库与云文档；可见范围完全由 WPS 后台授权决定')),
          h('div', { className: 'cnbm-actions' },
            h('button', { className: 'cnbm-btn', type: 'button', onClick: () => void refresh() }, '刷新'))),
        renderStatus(),
        renderUpdates(),
        h('div', { className: 'cnbm-tabs', role: 'tablist' },
          h('button', {
            key: 'wiki', className: 'cnbm-tab', type: 'button', role: 'tab',
            'aria-selected': tab === 'wiki', onClick: () => setTab('wiki'),
          }, '知识库'),
          h('button', {
            key: 'search', className: 'cnbm-tab', type: 'button', role: 'tab',
            'aria-selected': tab === 'search', onClick: () => setTab('search'),
          }, '搜索')),
        tab === 'wiki' ? renderWiki() : renderSearch(),
        renderReader())
    }

    /** 组件抛错时给出可读提示，而不是让整个槽位空白。 */
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      render() {
        if (this.state.error) {
          return h('div', { className: 'cnbm-panel' },
            h('section', { className: 'cnbm-card' },
              h('div', { className: 'cnbm-err' },
                'cnbm知识库面板加载失败：' + String((this.state.error && this.state.error.message) || this.state.error))))
        }
        return this.props.children
      }
    }

    function ensureStyles(ctx) {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + STYLE_MARK + '"]')) return
      const style = document.createElement('style')
      style.setAttribute('data-plugin-css', STYLE_MARK)
      style.textContent = STYLE
      document.head.appendChild(style)
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(() => () => { if (style.parentNode) style.parentNode.removeChild(style) })
      }
    }

    return {
      name: '@cnbm/dsh-wps365',
      inject: ['slots'],
      apply(ctx) {
        try {
          ensureStyles(ctx)
        } catch { /* 样式失败不影响注册 */ }
        const safe = (slot, register) => {
          try {
            ctx.slots.inject(slot, register)
          } catch (error) {
            try { ctx.logger?.warn?.(`[cnbm] 槽位 ${slot} 注册失败：${(error && error.message) || error}`) } catch { /* 忽略 */ }
          }
        }
        safe('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 50,
          label: () => 'cnbm知识库',
        }, (props) => h(WpsIcon, props || {})))
        safe('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, (props) => h(PanelBoundary, null, h(WpsPanel, props || {}))))
      },
    }
  },
})
