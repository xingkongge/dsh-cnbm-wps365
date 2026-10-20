/**
 * cnbm知识库页面（自包含 HTML，无构建步骤、无外部资源）。
 * 由 lib/ui.js 通过 ctx.webServer 注册在 /wps365。
 */
export const PAGE_HTML = String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>cnbm知识库</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfbfa; --panel: #ffffff; --border: #e3e3e0; --fg: #1f2328; --muted: #6b7280;
    --accent: #ff6a00; --ok: #17803d; --warn: #b45309; --err: #b42318; --chip: #f1f1ef;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #161614; --panel: #1d1d1b; --border: #34342f; --fg: #ececea; --muted: #9a9a93;
            --chip: #262622; --ok: #4ade80; --warn: #fbbf24; --err: #f87171; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
         font: 14px/1.55 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
  header { padding: 18px 22px 12px; border-bottom: 1px solid var(--border); }
  h1 { margin: 0 0 4px; font-size: 17px; font-weight: 650; letter-spacing: .2px; }
  .sub { color: var(--muted); font-size: 12px; }
  main { padding: 16px 22px 40px; max-width: 1080px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .badge.ok { color: var(--ok); border: 1px solid currentColor; }
  .badge.warn { color: var(--warn); border: 1px solid currentColor; }
  .badge.err { color: var(--err); border: 1px solid currentColor; }
  .k { color: var(--muted); font-size: 12px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .chip { background: var(--chip); border-radius: 6px; padding: 2px 8px; font-size: 12px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .tabs { display: flex; gap: 4px; margin-bottom: 12px; }
  .tab { padding: 7px 14px; border-radius: 8px; border: 1px solid transparent; cursor: pointer;
         background: transparent; color: var(--muted); font-size: 13px; }
  .tab[aria-selected="true"] { background: var(--panel); border-color: var(--border); color: var(--fg); font-weight: 600; }
  button.act { padding: 6px 12px; border-radius: 7px; border: 1px solid var(--border);
               background: var(--panel); color: var(--fg); cursor: pointer; font-size: 13px; }
  button.act:hover { border-color: var(--accent); }
  button.act[disabled] { opacity: .5; cursor: default; }
  input[type=text] { padding: 7px 10px; border-radius: 7px; border: 1px solid var(--border);
                     background: var(--panel); color: var(--fg); font-size: 13px; min-width: 240px; }
  ul.list { list-style: none; margin: 0; padding: 0; }
  ul.list li { padding: 9px 10px; border-radius: 8px; cursor: pointer; display: flex;
               justify-content: space-between; gap: 12px; align-items: baseline; }
  ul.list li:hover { background: var(--chip); }
  .name { font-weight: 520; }
  .meta { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .crumb { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
  .crumb a { color: var(--accent); text-decoration: none; cursor: pointer; }
  pre.body { white-space: pre-wrap; word-break: break-word; background: var(--bg); border: 1px solid var(--border);
             border-radius: 8px; padding: 12px; max-height: 460px; overflow: auto; font-size: 13px; margin: 0; }
  mark { background: rgba(255,106,0,.22); color: inherit; border-radius: 3px; }
  .empty { color: var(--muted); padding: 18px 4px; }
  .err { color: var(--err); }
  .hint { font-size: 12px; color: var(--muted); margin-top: 6px; }
</style>
</head>
<body>
<header>
  <h1>cnbm知识库</h1>
  <div class="sub">以当前登录人身份访问；可见范围完全由 WPS 后台授权决定</div>
</header>
<main>
  <section class="card" id="statusCard">
    <div class="row" style="justify-content:space-between">
      <div class="row"><span class="k">状态</span><span id="stateBadge" class="badge warn">检查中…</span>
        <span class="k" id="cliVersion"></span></div>
      <div class="row">
        <button class="act" id="loginBtn" hidden>登录 WPS</button>
        <button class="act" id="refreshBtn">刷新</button>
      </div>
    </div>
    <div class="chips" id="scopeChips"></div>
    <div class="hint" id="statusHint"></div>
  </section>

  <div class="tabs" role="tablist">
    <button class="tab" role="tab" data-tab="wiki" aria-selected="true">知识库</button>
    <button class="tab" role="tab" data-tab="search" aria-selected="false">搜索</button>
  </div>

  <section id="panel-wiki" class="card">
    <div class="crumb" id="crumb">根目录</div>
    <ul class="list" id="wikiList"><li class="empty">加载中…</li></ul>
  </section>

  <section id="panel-search" class="card" hidden>
    <div class="row">
      <input type="text" id="kw" placeholder="输入关键字，例如：安全监管" />
      <button class="act" id="searchBtn">搜索</button>
      <span class="hint" id="searchHint"></span>
    </div>
    <div id="searchResults" style="margin-top:10px"></div>
  </section>

  <section id="panel-read" class="card" hidden>
    <div class="row" style="justify-content:space-between;margin-bottom:8px">
      <strong id="readTitle">正文</strong>
      <button class="act" id="closeRead">关闭</button>
    </div>
    <pre class="body" id="readBody"></pre>
  </section>
</main>
<script>
(function () {
  var state = { spaceId: null, spaceName: '', parentId: '0', stack: [] };

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function api(path) {
    return fetch('/wps365/api/' + path, { headers: { accept: 'application/json', 'x-dsh-wps365': '1' } })
      .then(function (r) { return r.json(); });
  }
  function humanSize(n) {
    if (!n) return '';
    if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  var STATE_LABEL = {
    'logged-in': ['已登录', 'ok'],
    'logged-in-but-scopeless': ['已登录但无权限', 'warn'],
    'not-logged-in': ['未登录', 'warn'],
    'credentials-missing': ['未配置应用凭证', 'err'],
    'spec-unavailable': ['命令集未加载', 'err'],
    'cli-missing': ['未安装 CLI', 'err']
  };

  function renderStatus(s) {
    var badge = el('stateBadge');
    if (!s.ok) {
      badge.textContent = '无法连接'; badge.className = 'badge err';
      el('statusHint').textContent = s.error || '';
      return;
    }
    var hit = STATE_LABEL[s.state] || [s.state || '未知', 'warn'];
    badge.textContent = hit[0];
    badge.className = 'badge ' + hit[1];
    el('cliVersion').textContent = s.cliVersion ? 'CLI ' + s.cliVersion : '';
    var chips = (s.grantedScopes || []).map(function (x) {
      return '<span class="chip">' + esc(x) + '</span>';
    }).join('');
    el('scopeChips').innerHTML = chips || '<span class="hint">未授予任何 scope</span>';
    el('loginBtn').hidden = (s.state === 'logged-in');
    if (s.state === 'cli-missing') {
      el('statusHint').innerHTML = '安装：<code>curl -fsSL https://open-docs.wpscdn.cn/cli/install.sh | bash</code>';
    } else if (s.state === 'credentials-missing') {
      el('statusHint').textContent = '下一步：终端执行 wps365-cli auth setup --client-id … --client-secret …';
    } else if (s.state === 'not-logged-in' || s.state === 'logged-in-but-scopeless') {
      el('statusHint').textContent = '下一步：点「登录 WPS」，用企业账号完成设备码授权。';
    } else {
      el('statusHint').textContent = s.configDir ? '配置目录：' + s.configDir : '';
    }
  }

  function loadStatus() {
    api('status').then(renderStatus).catch(function (e) {
      el('stateBadge').textContent = '无法连接';
      el('stateBadge').className = 'badge err';
      el('statusHint').textContent = String(e);
    });
  }

  function renderSpaces(res) {
    var box = el('wikiList');
    if (!res.ok) { box.innerHTML = '<li class="err">' + esc(res.error) + '</li>'; return; }
    var items = res.data || [];
    if (!items.length) { box.innerHTML = '<li class="empty">没有可访问的知识库</li>'; return; }
    box.innerHTML = items.map(function (s) {
      return '<li data-kind="space" data-id="' + esc(s.id) + '" data-name="' + esc(s.name) + '">' +
        '<span class="name">' + esc(s.name) + '</span><span class="meta">知识库</span></li>';
    }).join('');
  }

  function renderNodes(res) {
    var box = el('wikiList');
    if (!res.ok) { box.innerHTML = '<li class="err">' + esc(res.error) + '</li>'; return; }
    var items = res.data || [];
    var rows = items.map(function (n) {
      var isFile = n.type === 'file';
      return '<li data-kind="' + (isFile ? 'file' : 'dir') + '" data-id="' + esc(n.id) + '" data-name="' + esc(n.name) + '">' +
        '<span class="name">' + (isFile ? '📄 ' : '📁 ') + esc(n.name) + '</span>' +
        '<span class="meta">' + (isFile ? humanSize(n.size) : '文件夹') + '</span></li>';
    });
    if (state.stack.length) {
      rows.unshift('<li data-kind="up"><span class="name">↩︎ 返回上级</span></li>');
    }
    box.innerHTML = rows.join('') || '<li class="empty">该目录为空</li>';
  }

  function setCrumb() {
    var parts = ['<a data-crumb="root">' + esc(state.spaceName || '根目录') + '</a>'];
    state.stack.forEach(function (n, i) {
      parts.push('<a data-crumb="' + i + '">' + esc(n.name) + '</a>');
    });
    el('crumb').innerHTML = parts.join(' / ');
  }

  function loadSpaces() {
    state = { spaceId: null, spaceName: '', parentId: '0', stack: [] };
    setCrumb();
    api('spaces').then(renderSpaces);
  }

  function loadNodes() {
    if (!state.spaceId) return loadSpaces();
    setCrumb();
    api('nodes?spaceId=' + encodeURIComponent(state.spaceId) +
        '&parentId=' + encodeURIComponent(state.parentId)).then(renderNodes);
  }

  function openFile(id, name) {
    el('panel-read').hidden = false;
    el('readTitle').textContent = name;
    el('readBody').textContent = '读取中…';
    api('read?fileId=' + encodeURIComponent(id)).then(function (r) {
      el('readBody').textContent = r.ok ? r.text : (r.error || '读取失败');
    });
    el('panel-read').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  el('wikiList').addEventListener('click', function (ev) {
    var li = ev.target.closest('li');
    if (!li) return;
    var kind = li.getAttribute('data-kind');
    if (kind === 'space') {
      state.spaceId = li.getAttribute('data-id');
      state.spaceName = li.getAttribute('data-name');
      state.parentId = '0'; state.stack = [];
      loadNodes();
    } else if (kind === 'dir') {
      state.stack.push({ id: state.parentId, name: state.spaceName });
      state.parentId = li.getAttribute('data-id');
      loadNodes();
    } else if (kind === 'up') {
      var prev = state.stack.pop();
      if (prev) { state.parentId = prev.id; loadNodes(); }
    } else if (kind === 'file') {
      openFile(li.getAttribute('data-id'), li.getAttribute('data-name'));
    }
  });

  el('crumb').addEventListener('click', function (ev) {
    var a = ev.target.closest('a[data-crumb]');
    if (!a) return;
    var v = a.getAttribute('data-crumb');
    if (v === 'root') { loadSpaces(); return; }
    var idx = parseInt(v, 10);
    var target = state.stack[idx];
    state.stack = state.stack.slice(0, idx);
    state.parentId = target.id;
    loadNodes();
  });

  el('closeRead').addEventListener('click', function () { el('panel-read').hidden = true; });

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', 'false'); });
      tab.setAttribute('aria-selected', 'true');
      var name = tab.getAttribute('data-tab');
      el('panel-wiki').hidden = name !== 'wiki';
      el('panel-search').hidden = name !== 'search';
    });
  });

  el('searchBtn').addEventListener('click', function () {
    var kw = el('kw').value.trim();
    if (!kw) return;
    el('searchResults').innerHTML = '<div class="empty">搜索中…</div>';
    var spaces = state.spaceId;
    if (!spaces) {
      api('spaces').then(function (r) {
        spaces = (r.data || []).map(function (s) { return s.id; }).join(',');
        doSearch(kw, spaces);
      });
    } else {
      doSearch(kw, spaces);
    }
  });

  function doSearch(kw, spaceIds) {
    if (!spaceIds) { el('searchResults').innerHTML = '<div class="empty">没有可搜索的知识库</div>'; return; }
    api('search?keyword=' + encodeURIComponent(kw) + '&spaceIds=' + encodeURIComponent(spaceIds))
      .then(function (r) {
        if (!r.ok) { el('searchResults').innerHTML = '<div class="err">' + esc(r.error) + '</div>'; return; }
        var items = r.data || [];
        el('searchHint').textContent = items.length + ' 条结果';
        el('searchResults').innerHTML = items.map(function (hit, i) {
          var f = hit.file || {};
          var snips = (hit.highlights || []).filter(function (h) { return h.values && h.values.length; })
            .map(function (h) {
              return '<div class="hint">' + esc(h.key) + '：' + h.values.join(' … ') + '</div>';
            }).join('');
          return '<div class="card" style="margin:10px 0"><div class="row" style="justify-content:space-between">' +
            '<strong>' + (i + 1) + '. ' + esc(f.name || '(未命名)') + '</strong>' +
            '<button class="act" data-open="' + esc(f.id) + '" data-name="' + esc(f.name) + '">读正文</button>' +
            '</div>' + snips + '</div>';
        }).join('') || '<div class="empty">没有匹配结果</div>';
      });
  }

  el('searchResults').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-open]');
    if (!btn) return;
    openFile(btn.getAttribute('data-open'), btn.getAttribute('data-name'));
  });

  el('refreshBtn').addEventListener('click', function () { loadStatus(); loadNodes(); });

  el('loginBtn').addEventListener('click', function () {
    var btn = el('loginBtn');
    btn.disabled = true;
    btn.textContent = '发起中…';
    fetch('/wps365/api/login', { method: 'POST', headers: { 'x-dsh-wps365': '1' } }).then(function (r) { return r.json(); }).then(function (r) {
      btn.disabled = false;
      btn.textContent = '登录 WPS';
      if (!r.ok) { el('statusHint').textContent = r.error || '发起失败'; return; }
      el('statusHint').innerHTML = '请在企业浏览器完成授权：<br><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' +
        esc(r.url) + '</a><br>用户码：<strong>' + esc(r.userCode || '(见终端输出)') + '</strong>';
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = '登录 WPS';
      el('statusHint').textContent = String(e);
    });
  });

  loadStatus();
  loadSpaces();
})();
</script>
</body>
</html>`
