// 工作区面板：宿主 webServer 直出 HTML + JSON API，零前端依赖。
// 页面只做展示与人工纠错（改范围/重命名/合并/清空/删除/恢复归档）。

const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>混合工作区 v2.3</title>
<style>
  :root { color-scheme: dark; --bg:#0b0e14; --card:#141925; --line:#232a3a; --text:#e8edf7; --mute:#8b96ab; --accent:#5aa8ff; --good:#51d18b; --warn:#ffb454; --bad:#ff6b7a; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  header { position:sticky; top:0; z-index:2; background:rgba(11,14,20,.94); backdrop-filter:blur(8px); border-bottom:1px solid var(--line); padding:14px 22px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  h1 { font-size:17px; margin:0; font-weight:650; letter-spacing:.2px; }
  .sub { color:var(--mute); font-size:12px; }
  .spacer { flex:1; }
  input, button { font:inherit; color:var(--text); background:#1b2231; border:1px solid var(--line); border-radius:8px; padding:7px 10px; }
  input:not([type="checkbox"]):not([type="radio"]) { min-width:220px; }
  input[type="checkbox"], input[type="radio"] { min-width:0; width:15px; height:15px; flex:0 0 auto; }
  button { cursor:pointer; }
  button:hover { border-color:#3a4a66; background:#202a3d; }
  button.primary { background:#1d3a63; border-color:#2c5a9a; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  .pick { display:inline-flex; align-items:center; gap:3px; color:var(--mute); font-size:11.5px; }
  main { padding:18px 22px 40px; max-width:1240px; margin:0 auto; }
  .stats { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:9px 13px; min-width:112px; }
  .stat b { display:block; font-size:20px; line-height:1.2; }
  .stat span { color:var(--mute); font-size:12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 15px 12px; display:flex; flex-direction:column; gap:9px; }
  .card h2 { font-size:15px; margin:0; line-height:1.4; }
  .meta { color:var(--mute); font-size:12px; display:flex; gap:10px; flex-wrap:wrap; }
  .scope { color:#b9c6db; font-size:13px; }
  .chips { display:flex; gap:5px; flex-wrap:wrap; }
  .chip { border:1px solid #2a3550; background:#1a2336; color:#9fc2ff; border-radius:999px; padding:1px 8px; font-size:11px; }
  details { border-top:1px solid var(--line); padding-top:7px; }
  summary { cursor:pointer; color:#aab7cd; font-size:12.5px; }
  .mem { margin:6px 0; font-size:12.5px; color:#d4dceb; }
  .mem .tag { display:inline-block; min-width:34px; text-align:center; border-radius:5px; padding:0 5px; margin-right:6px; font-size:11px; background:#1d2b42; color:#9fc2ff; }
  .mem .tag.decision { background:#1f3b2c; color:#7ee2a8; }
  .mem .tag.todo { background:#3b3320; color:#ffce7a; }
  .mem .tag.question { background:#3a2433; color:#ff9bb8; }
  .mem .tag.episode { background:#2a2a35; color:#b9b9cc; }
  .mem.superseded { opacity:.45; text-decoration:line-through; }
  .mem.expired { opacity:.6; }
  .mem .tier { color:#8ea7c9; font-size:10.5px; border:1px solid #2b3854; border-radius:4px; padding:0 4px; margin-left:5px; }
  .mem .tools { margin-left:6px; display:inline-flex; gap:4px; vertical-align:1px; }
  .mem .tools button { padding:0 5px; font-size:10.5px; border-radius:5px; }
  .keys { color:var(--mute); font-size:11px; }
  .actions { display:flex; gap:6px; flex-wrap:wrap; margin-top:auto; padding-top:6px; }
  .actions button { padding:4px 8px; font-size:12px; }
  .topic { display:flex; align-items:flex-start; gap:10px; }
  .topic h2 { flex:1; min-width:0; }
  .topic-actions { display:flex; gap:6px; flex:0 0 auto; }
  .topic-actions button { padding:3px 7px; font-size:11.5px; }
  button.danger { color:#ffb3ba; border-color:#5a2a33; }
  .usage { color:var(--mute); font-size:11.5px; display:flex; gap:8px; flex-wrap:wrap; }
  .usage b { color:#cfe0ff; font-weight:600; }
  .bar { height:4px; background:#1b2231; border-radius:999px; overflow:hidden; }
  .bar i { display:block; height:100%; background:linear-gradient(90deg,#3f7fd6,#5aa8ff); }
  .comp { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin-bottom:16px; }
  .compbar { display:flex; height:10px; border-radius:999px; overflow:hidden; background:#1b2231; }
  .compbar i { display:block; height:100%; }
  .legend { display:flex; gap:12px; flex-wrap:wrap; margin-top:8px; color:var(--mute); font-size:12px; }
  .legend b.dot { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:5px; vertical-align:1px; }
  .empty { color:var(--mute); padding:30px 0; }
  .sect { margin:26px 0 10px; font-size:14px; color:#c7d2e5; font-weight:650; }
  table { width:100%; border-collapse:collapse; font-size:12px; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:6px 9px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--mute); font-weight:500; background:#121826; }
  tr:last-child td { border-bottom:0; }
  .ok { color:var(--good); } .warn { color:var(--warn); } .bad { color:var(--bad); }
  .foot { color:var(--mute); font-size:11.5px; margin-top:14px; }
  .timeline .chain { border-top:1px dashed #2a3550; padding:6px 0; font-size:12px; }
  .timeline .old { color:#8b96ab; text-decoration:line-through; }
  .timeline .arrow { color:#5aa8ff; margin:0 5px; }
  .timeline .new { color:#d9e6ff; }
  .inbox { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
  .inbox-compose { display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap; }
  .inbox-compose textarea { flex:1 1 420px; min-height:64px; resize:vertical; font:inherit; color:var(--text); background:#1b2231; border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
  .inbox-side { flex:1 1 300px; display:flex; flex-direction:column; gap:7px; min-width:260px; }
  .inbox-side select { width:100%; }
  .inbox-actions { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
  .inbox-actions button { padding:6px 9px; font-size:12.5px; }
  .inbox-list { display:flex; flex-direction:column; gap:7px; margin-top:10px; }
  .inbox-row { display:flex; gap:9px; align-items:flex-start; padding:8px 10px; border:1px solid var(--line); border-radius:9px; background:#111722; }
  .inbox-row .txt { flex:1; min-width:0; white-space:pre-wrap; word-break:break-word; font-size:12.5px; }
  .inbox-row .actions { margin:0; padding:0; flex:0 0 auto; }
  .inbox-row .actions button { padding:3px 7px; font-size:11.5px; }
  .badge { flex:0 0 auto; border-radius:999px; padding:1px 8px; font-size:11px; line-height:1.7; white-space:nowrap; }
  .badge.queued { background:#2a2f3a; color:#c3c9d6; }
  .badge.running { background:#1d3a63; color:#9fc2ff; }
  .badge.done { background:#1f3b2c; color:#7ee2a8; }
  .badge.failed { background:#3a2433; color:#ff9bb8; }
  .badge.cancelled { background:#2a2a35; color:#b9b9cc; }
  .inbox-note { color:var(--mute); font-size:11.5px; margin-top:8px; }
  .modal { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; padding:20px; z-index:20; }
  .modal-box { background:var(--card); border:1px solid #33415e; border-radius:14px; width:min(820px,100%); max-height:86vh; display:flex; flex-direction:column; box-shadow:0 18px 70px rgba(0,0,0,.55); }
  .modal-box h3 { margin:0; padding:14px 16px; border-bottom:1px solid var(--line); font-size:15px; }
  .modal-body { padding:12px 16px; overflow:auto; }
  .modal-foot { padding:12px 16px; border-top:1px solid var(--line); display:flex; gap:8px; justify-content:flex-end; }
  .plan { border:1px solid var(--line); border-radius:10px; padding:9px 11px; margin-bottom:10px; }
  .plan h4 { margin:0 0 4px; font-size:13px; }
  .round { margin:8px 0 2px; color:#9fb4d6; font-size:12px; font-weight:600; }
  .item { display:flex; gap:7px; align-items:flex-start; padding:3px 0; color:#d4dceb; font-size:12px; }
  .item input { margin-top:3px; }
  .item .role { color:var(--mute); flex:0 0 auto; }
  select { font:inherit; color:var(--text); background:#1b2231; border:1px solid var(--line); border-radius:8px; padding:7px 10px; }
  .modal-box.small { width:min(560px,100%); }
  .field { display:flex; flex-direction:column; gap:6px; margin:0 0 12px; }
  .field label { color:#aab7cd; font-size:12.5px; }
  .field input, .field textarea, .field select { width:100%; min-width:0; }
  .field textarea { min-height:84px; resize:vertical; }
  .dialog-note { color:#b9c6db; white-space:pre-line; }
  .toast { position:fixed; left:50%; bottom:22px; transform:translateX(-50%); z-index:40; max-width:min(760px,calc(100vw - 32px)); background:#1d2637; border:1px solid #33415e; border-radius:10px; padding:10px 14px; box-shadow:0 12px 40px rgba(0,0,0,.45); white-space:pre-line; font-size:13px; }
  .toast.err { border-color:#6b2d38; color:#ffb3ba; }
  @media (max-width:560px) { header { padding:12px; } main { padding:14px 12px 30px; } .grid { grid-template-columns:1fr; } input { flex:1; } .topic { flex-direction:column; } }
</style>
</head>
<body>
<header>
  <h1>混合工作区 <span class="sub">v2.3</span></h1>
  <span id="sub" class="sub"></span>
  <span class="spacer"></span>
  <span id="sel" class="sub"></span>
  <input id="q" placeholder="过滤：名字 / 范围 / 记忆">
  <input id="import-file" type="file" accept=".json,.md,.markdown,text/markdown,application/json" style="display:none">
  <button id="export">导出</button>
  <button id="import">导入</button>
  <button id="create-ws" class="primary">新建工作区</button>
  <button id="migrate" disabled>迁移选中</button>
  <button id="refresh">刷新</button>
  <button id="close-panel" title="关闭面板，回到 DSH">关闭面板</button>
</header>
<main>
  <div id="stats" class="stats"></div>
  <div id="inbox"></div>
  <div id="composition"></div>
  <div id="profile"></div>
  <div id="app" class="grid"></div>
  <div id="trace"></div>
  <div id="archives"></div>
  <div class="foot">人工纠错优先于自动路由：改范围、合并过度拆分的工作区，通常比反复重命名更有效。面板仅绑定本机回环地址。</div>
</main>
<script>
// 支持 /hybrid-workspace/ 和 /hybrid-workspace/index.html 两种入口。
const API = location.pathname.replace(/\/index\.html$/i, '').replace(/\/$/, '') + '/api';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let DATA = { workspaces: [], profile: [], archives: [], trace: [], inbox: [], stats: {}, fetchedAt: 0 };
let FILTER = '';
let DRAFT = { text: '', workspaceId: '' };
let inboxPoll = null;
const SELECTED = new Set();

async function get () {
  const r = await fetch(API, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  DATA = await r.json();
  DATA.fetchedAt = Date.now();
  render();
}
async function post (payload) {
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
  await get();
  return j;
}

function toast (message, isError) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.textContent = String(message ?? '');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), isError ? 7000 : 4200);
}

// DSH 的 WebView 禁用了 window.prompt/confirm/alert，所有交互都用页面内对话框。
function openDialog (title, body, submit) {
  return new Promise(resolve => {
    const root = document.createElement('div');
    root.className = 'modal';
    root.innerHTML = '<div class="modal-box small"><h3>' + esc(title) + '</h3>' +
      '<div class="modal-body">' + body + '</div>' +
      '<div class="modal-foot"><button data-dialog="cancel">取消</button><button data-dialog="ok" class="primary">确定</button></div></div>';
    document.body.appendChild(root);
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve(value);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && !e.isComposing) {
        e.preventDefault();
        root.querySelector('[data-dialog="ok"]').click();
      }
    };
    document.addEventListener('keydown', onKey, true);
    root.querySelector('[data-dialog="cancel"]').onclick = () => finish(null);
    root.querySelector('[data-dialog="ok"]').onclick = () => {
      const value = submit ? submit(root) : true;
      if (value === false) return;
      finish(value);
    };
    root.addEventListener('click', e => { if (e.target === root) finish(null); });
    const first = root.querySelector('input, textarea, select');
    if (first) setTimeout(() => first.focus(), 0);
  });
}

function askText (title, initial, allowEmpty) {
  const value = initial == null ? '' : String(initial);
  return openDialog(title,
    '<div class="field"><label>内容</label><input id="dialog-text" value="' + esc(value) + '" autocomplete="off"></div>',
    root => {
      const input = root.querySelector('#dialog-text');
      const text = input.value.trim();
      if (!text && !allowEmpty) { input.focus(); toast('不能为空', true); return false; }
      return text;
    });
}

async function askConfirm (title, detail) {
  const value = await openDialog(title, '<div class="dialog-note">' + esc(detail || '') + '</div>', () => true);
  return value === true;
}

function askWorkspaceForm (title, name, description) {
  return openDialog(title,
    '<div class="field"><label>名称</label><input id="ws-name" value="' + esc(name || '') + '" autocomplete="off"></div>' +
    '<div class="field"><label>范围与边界（可留空）</label><textarea id="ws-desc" placeholder="例如：imPOS 收银终端的线上运维；只讨论门店终端、版本、断线排查">' + esc(description || '') + '</textarea></div>',
    root => {
      const n = root.querySelector('#ws-name').value.trim();
      if (!n) { root.querySelector('#ws-name').focus(); toast('名称不能为空', true); return false; }
      return { name: n, description: root.querySelector('#ws-desc').value.trim() };
    });
}

function askPolicy (p) {
  const yes = p.autoSwitch === false ? 'no' : 'yes';
  return openDialog('工作区策略',
    '<div class="field"><label>上下文上限（600–12000 字符；留空继承全局）</label><input id="pol-max" type="number" min="600" max="12000" value="' + esc(p.contextMaxChars == null ? '' : p.contextMaxChars) + '"></div>' +
    '<div class="field"><label>注入记忆条数（0–20；留空继承全局）</label><input id="pol-mem" type="number" min="0" max="20" value="' + esc(p.memoryInject == null ? '' : p.memoryInject) + '"></div>' +
    '<div class="field"><label>允许自动切走</label><select id="pol-switch"><option value="yes"' + (yes === 'yes' ? ' selected' : '') + '>允许</option><option value="no"' + (yes === 'no' ? ' selected' : '') + '>禁止</option></select></div>',
    root => ({
      contextMaxChars: root.querySelector('#pol-max').value.trim() === '' ? null : Number(root.querySelector('#pol-max').value),
      memoryInject: root.querySelector('#pol-mem').value.trim() === '' ? null : Number(root.querySelector('#pol-mem').value),
      autoSwitch: root.querySelector('#pol-switch').value !== 'no',
    }));
}

const fmt = (ts) => { if (!ts) return ''; const d = new Date(ts); return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); };
const fmtK = (n) => { n = Math.max(0, Number(n) || 0); return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n); };
const tag = (t) => '<span class="tag ' + esc(t) + '">' + esc({ decision: '决策', fact: '事实', todo: '待办', question: '问题', episode: '早期' }[t] || '记忆') + '</span>';

function openSummaries () {
  return new Set([...document.querySelectorAll('details[open] > summary')].map(s => s.textContent));
}
function restoreOpen (open) {
  if (!open.size) return;
  document.querySelectorAll('details').forEach(d => {
    const s = d.querySelector(':scope > summary');
    if (s && open.has(s.textContent)) d.open = true;
  });
}

const INBOX_STATUS = { queued: '排队中', running: '运行中', done: '已出队', failed: '失败', cancelled: '已取消' };

function inboxRow (t) {
  const status = INBOX_STATUS[t.status] ? t.status : 'queued';
  const label = INBOX_STATUS[status];
  const ws = t.workspaceName || t.workspaceId || '未锁定';
  const times = fmt(t.createdAt) + (t.finishedAt ? ' · 结束 ' + fmt(t.finishedAt) : '');
  const tools = [];
  if (status === 'queued' || status === 'running') tools.push('<button data-inbox="cancel" data-id="' + esc(t.id) + '">取消</button>');
  if (status === 'failed' || status === 'cancelled') tools.push('<button data-inbox="retry" data-id="' + esc(t.id) + '">重试</button>');
  if (status !== 'running') tools.push('<button data-inbox="remove" data-id="' + esc(t.id) + '" class="danger">删除</button>');
  const err = t.error ? '<div class="bad">' + esc(t.error) + '</div>' : '';
  const result = t.result ? '<div class="keys">' + esc(t.result) + '</div>' : '';
  return '<div class="inbox-row"><span class="badge ' + esc(status) + '">' + esc(label) + '</span>' +
    '<div class="txt">' + esc(t.text) +
    '<div class="meta"><span>锁定：' + esc(ws) + '</span><span>' + esc(times) + '</span>' + (t.simulated ? '<span class="warn">模拟出队</span>' : '') + '</div>' +
    err + result + '</div><div class="actions">' + tools.join('') + '</div></div>';
}

function syncInboxButtons () {
  const text = document.getElementById('inbox-text');
  const sel = document.getElementById('inbox-ws');
  const add = document.getElementById('inbox-add');
  if (add) add.disabled = !String(text?.value ?? '').trim() || !String(sel?.value ?? '');
  const list = DATA.inbox || [];
  const queued = list.some(t => t.status === 'queued');
  const running = list.some(t => t.status === 'running');
  document.querySelectorAll('#inbox [data-inbox="run"], #inbox [data-inbox="run-all"]').forEach(b => { b.disabled = !queued || running; });
  const clear = document.querySelector('#inbox [data-inbox="clear"]');
  if (clear) clear.disabled = !list.some(t => t.status === 'done' || t.status === 'failed' || t.status === 'cancelled');
}

function scheduleInboxPoll () {
  if (inboxPoll) return;
  inboxPoll = setTimeout(async () => {
    inboxPoll = null;
    try { await get(); } catch (error) { /* 网络抖动保留上次渲染 */ }
  }, 900);
}

function renderInbox () {
  const box = document.getElementById('inbox');
  if (!box) return;
  if (!document.getElementById('inbox-text')) {
    box.innerHTML = '<div class="sect">统一收件箱 · P1 预览（未接执行器）</div>' +
      '<div class="inbox"><div class="inbox-compose">' +
      '<textarea id="inbox-text" placeholder="写一条要派给工作区的任务；先选工作区，再点加入队列。"></textarea>' +
      '<div class="inbox-side"><select id="inbox-ws"></select><div class="inbox-actions">' +
      '<button id="inbox-add" class="primary">加入队列</button>' +
      '<button data-inbox="run">运行下一个</button>' +
      '<button data-inbox="run-all">顺序执行</button>' +
      '<button data-inbox="clear">清空已结束</button>' +
      '</div><div id="inbox-counts" class="keys"></div></div></div>' +
      '<div class="inbox-list" id="inbox-list"></div>' +
      '<div class="inbox-note">P1 只验证交互：任务按顺序出队，不调用 DSH 执行器，也不改写工作区上下文；完成状态是模拟的。</div></div>';
  }
  const sel = document.getElementById('inbox-ws');
  const wsList = DATA.workspaces || [];
  if (DRAFT.workspaceId && !wsList.some(w => w.id === DRAFT.workspaceId)) DRAFT.workspaceId = '';
  if (sel) {
    const sig = wsList.map(w => w.id + ':' + w.name).join('|');
    if (sel.dataset.sig !== sig) {
      sel.innerHTML = '<option value="">选择工作区（手动锁定）</option>' +
        wsList.map(w => '<option value="' + esc(w.id) + '">' + esc(w.name) + '</option>').join('');
      sel.dataset.sig = sig;
    }
    if (sel.value !== DRAFT.workspaceId) sel.value = DRAFT.workspaceId;
  }
  const text = document.getElementById('inbox-text');
  if (text && document.activeElement !== text) text.value = DRAFT.text;
  const list = DATA.inbox || [];
  const listEl = document.getElementById('inbox-list');
  if (listEl) listEl.innerHTML = list.length
    ? list.slice().reverse().map(inboxRow).join('')
    : '<div class="empty">队列是空的。先选工作区，再写一条任务。</div>';
  const counts = document.getElementById('inbox-counts');
  if (counts) {
    const queued = list.filter(t => t.status === 'queued').length;
    const running = list.filter(t => t.status === 'running').length;
    counts.textContent = '排队 ' + queued + ' · 运行 ' + running + ' · 已结束 ' + (list.length - queued - running);
  }
  syncInboxButtons();
  if (list.some(t => t.status === 'running') && !document.hidden) scheduleInboxPoll();
}

function render () {
  const open = openSummaries();
  const st = DATA.stats || {};
  const totalChars = st.contextChars ?? (DATA.workspaces || []).reduce((n, w) => n + (w.contextChars || 0), 0);
  const totalTokens = st.contextTokens ?? (DATA.workspaces || []).reduce((n, w) => n + (w.contextTokens || 0), 0);
  const maxChars = st.contextMaxChars || 2400;
  document.getElementById('sub').textContent = (DATA.workspaces || []).length + ' 个工作区 · ' + (DATA.sessions || []).length + ' 个会话绑定 · 上下文 ' + fmtK(totalChars) + ' 字符';
  document.getElementById('stats').innerHTML = [
    ['工作区', st.workspaces ?? (DATA.workspaces || []).length, ''],
    ['记忆', st.memories ?? 0, ''],
    ['全局档案', st.profile ?? (DATA.profile || []).length, ''],
    ['过期', st.expired ?? 0, ''],
    ['活跃会话', st.sessions ?? (DATA.sessions || []).length, ''],
    ['上下文占用 · 所有区合计', fmtK(totalChars) + ' 字符', '≈' + fmtK(totalTokens) + ' tokens · 每区上限 ' + fmtK(maxChars) + ' 字符（≈' + fmtK(Math.round(maxChars / 1.5)) + ' tokens）'],
    ['LLM 判定', st.llmCalls ?? 0, ''],
    ['多话题', st.multiTurns ?? 0, ''],
    ['归档', (DATA.archives || []).length, ''],
    ...(DATA.cost?.available ? [['最近 12 会话合计', '¥' + (Number(DATA.cost.total?.cost) || 0).toFixed(4), fmtK(DATA.cost.total?.tokens) + ' tokens · ' + (DATA.cost.total?.calls || 0) + ' 次调用']] : []),
  ].map(([k, v, note]) => '<div class="stat"><b>' + esc(v) + '</b><span>' + esc(k) + (note ? ' · ' + esc(note) : '') + '</span></div>').join('');
  renderComposition(st);
  renderProfile();
  renderInbox();

  const q = FILTER.trim().toLowerCase();
  const list = (DATA.workspaces || []).filter(w => {
    if (!q) return true;
    return [w.name, w.description, w.summary, ...(w.memories || []).map(m => m.text), ...(w.keywords || [])].join(' ').toLowerCase().includes(q);
  });
  const app = document.getElementById('app');
  if (!list.length) app.innerHTML = '<div class="empty">' + (q ? '没有匹配的工作区' : '还没有工作区。正常聊天即可自动建立，或先在面板上等待首条消息。') + '</div>';
  else app.innerHTML = list.map(card).join('');
  renderTrace();
  renderArchives();
  syncSelection();
  restoreOpen(open);
}

function syncSelection () {
  const ids = new Set((DATA.workspaces || []).map(w => w.id));
  for (const id of [...SELECTED]) if (!ids.has(id)) SELECTED.delete(id);
  const sel = document.getElementById('sel');
  if (sel) sel.textContent = SELECTED.size ? '已选 ' + SELECTED.size + ' 个' : '';
  const btn = document.getElementById('migrate');
  if (btn) btn.disabled = SELECTED.size === 0;
  document.querySelectorAll('input[data-pick]').forEach(el => { el.checked = SELECTED.has(el.dataset.pick); });
}

function ttlLabel (m) {
  if (m.status === 'expired') return '已过期';
  if (m.scope === 'global' || m.tier === 'profile') return '永久';
  if (m.pinned) return '置顶';
  if (m.ttlLeftMs == null) return '';
  const left = Number(m.ttlLeftMs) - (Date.now() - (DATA.fetchedAt || Date.now()));
  if (left <= 0) return '已过期';
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const min = Math.floor((left % 3600000) / 60000);
  if (d > 0) return '剩 ' + d + '天' + (h ? h + '小时' : '');
  if (h > 0) return '剩 ' + h + '小时' + (min ? min + '分' : '');
  return '剩 ' + Math.max(1, min) + '分';
}

function memRow (m) {
  const tier = { profile: '全局', durable: '长期', episodic: '过程', scratch: '临时' }[m.tier] || '';
  const cls = 'mem' + (m.status === 'superseded' ? ' superseded' : '') + (m.status === 'expired' ? ' expired' : '');
  const ttl = ttlLabel(m);
  const meta = (tier ? '<span class="tier">' + esc(tier) + '</span>' : '') + (ttl ? ' <span class="keys">' + esc(ttl) + '</span>' : '');
  const tools = '<span class="tools">' +
    (m.pinned ? '<button data-mem="unpin" data-mem-id="' + esc(m.id) + '">取消置顶</button>' : '<button data-mem="pin" data-mem-id="' + esc(m.id) + '">置顶</button>') +
    (m.status === 'expired' ? '<button data-mem="restore" data-mem-id="' + esc(m.id) + '">恢复</button>' : '') +
    '</span>';
  const note = m.status === 'superseded' ? ' <span class="keys">（已被新结论取代）</span>'
    : (m.status === 'expired' ? ' <span class="keys">（已过期，不注入）</span>' : '');
  return '<div class="' + cls + '" title="' + esc((m.keys || []).join('、')) + '">' +
    tag(m.type) + esc(m.text) + meta + note + tools + '</div>';
}

function renderProfile () {
  const list = DATA.profile || [];
  const el = document.getElementById('profile');
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="sect">全局档案 · 跨工作区，默认置顶</div><div class="card">' +
    list.map(m => memRow(m)).join('') + '</div>';
}

function timelineHtml (w) {
  const t = w.timeline || {};
  const chains = t.chains || [];
  if (!chains.length) return '';
  const body = chains.map(c => '<div class="chain">' + (c.nodes || []).map((n, i) =>
    (i ? '<span class="arrow">→</span>' : '') +
    '<span class="' + (n.status === 'superseded' ? 'old' : 'new') + '" title="' + esc(fmt(n.at)) + '">' + esc(n.text) + '</span>'
  ).join('') + '</div>').join('');
  return '<details class="timeline"><summary>结论演变（' + chains.length + '）</summary>' + body + '</details>';
}

function card (w) {
  const mems = (w.memories || []).slice().sort((a, b) => (b.status === 'active') - (a.status === 'active') || (b.turn - a.turn)).slice(0, 12);
  const memHtml = mems.map(m => memRow(m)).join('') || '<div class="mem keys">暂无结构化记忆</div>';
  const ex = (w.exemplars || []).map(e => '<div class="mem keys">· ' + esc(e.text || e) + '</div>').join('') || '<div class="mem keys">暂无</div>';
  const turns = (w.turns || []).slice(-6).map(t => '<div class="mem"><b>' + (t.role === 'assistant' ? '助手' : '用户') + '：</b>' + esc(t.text) + '</div>').join('') || '<div class="mem keys">暂无</div>';
  const counts = w.memoryStats || {};
  const pct = Math.max(0, Math.min(100, Number(w.contextPct) || 0));
  const pol = w.policy || {};
  const policyText = '上下文 ' + (pol.contextMaxChars == null ? '继承' : pol.contextMaxChars) + ' · 记忆 ' + (pol.memoryInject == null ? '继承' : pol.memoryInject) + ' · 自动切走 ' + (pol.autoSwitch === false ? '关' : '开');
  return '<article class="card" data-id="' + esc(w.id) + '">' +
    '<div class="topic"><h2>话题：' + esc(w.name) + '</h2>' +
    '<div class="topic-actions"><label class="pick"><input type="checkbox" data-pick="' + esc(w.id) + '"' + (SELECTED.has(w.id) ? ' checked' : '') + '> 选</label><button data-op="archive">归档</button><button data-op="delete" class="danger">删除</button></div></div>' +
    '<div class="usage"><span>占用上下文 <b>' + fmtK(w.contextChars) + '</b> 字符 · ≈' + fmtK(w.contextTokens) + ' tokens · 预算 ' + pct + '%</span><span>上限 ' + fmtK(w.contextMaxChars || 2400) + '</span></div>' +
    '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
    '<div class="meta"><span>' + (w.rounds || 0) + ' 轮</span><span>命中 ' + (w.hits || 0) + '</span><span>' + esc(fmt(w.updatedAt)) + '</span><span>' + (w.sessions || 0) + ' 会话</span></div>' +
    '<div class="scope">' + esc(w.description || '（未填写范围）') + '</div>' +
    '<div class="chips">' + (w.keywords || []).map(k => '<span class="chip">' + esc(k) + '</span>').join('') + '</div>' +
    '<div class="meta"><span class="keys">策略：' + esc(policyText) + '</span></div>' +
    '<div class="meta"><span>记忆 ' + ((counts.decision || 0) + (counts.fact || 0) + (counts.todo || 0) + (counts.question || 0) + (counts.episode || 0)) + '</span><span>决策 ' + (counts.decision || 0) + '</span><span>待办 ' + (counts.todo || 0) + '</span></div>' +
    '<details open><summary>相关记忆（' + (w.memories || []).length + '）</summary>' + memHtml + '</details>' +
    '<details><summary>代表性问法（' + (w.exemplars || []).length + '）</summary>' + ex + '</details>' +
    '<details><summary>最近对话</summary>' + turns + '</details>' +
    timelineHtml(w) +
    '<div class="actions"><button data-op="rename">重命名</button><button data-op="describe">改范围</button><button data-op="policy">策略</button><button data-op="merge">合并</button><button data-op="clear">清空</button></div>' +
    '</article>';
}

function renderComposition (st) {
  const b = st.contextBreakdown || {};
  const total = Number(b.total || st.contextChars || 0);
  const el = document.getElementById('composition');
  if (!total) { el.innerHTML = ''; return; }
  const rows = [
    ['header', '工作区卡', '#5aa8ff'],
    ['global', '全局档案', '#ff7ab6'],
    ['memories', '相关记忆', '#51d18b'],
    ['open', '未决事项', '#ffb454'],
    ['recent', '最近对话', '#b58cff'],
    ['rules', '回答规则', '#6c7a93'],
  ];
  const segs = rows.map(([key, label, color]) => {
    const v = Number(b[key] || 0);
    return { label, color, v, pct: Math.round(v / total * 1000) / 10 };
  }).filter(x => x.v > 0);
  el.innerHTML = '<div class="sect">上下文构成 · 所有工作区</div><div class="comp">' +
    '<div class="compbar">' + segs.map(x => '<i style="width:' + x.pct + '%;background:' + x.color + '" title="' + esc(x.label) + ' ' + x.pct + '%"></i>').join('') + '</div>' +
    '<div class="legend">' + segs.map(x => '<span><b class="dot" style="background:' + x.color + '"></b>' + esc(x.label) + ' ' + fmtK(x.v) + ' 字符 · ' + x.pct + '%</span>').join('') + '</div>' +
    '</div>';
}

const HOW_LABEL = {
  bootstrap: '新建首个区', 'empty-query': '空消息', 'exact-name': '名称精确命中', match: '内容匹配',
  'no-signal': '没有信号', 'ambiguous-new': '多区接近，新建', 'weak-match': '弱匹配，新建',
  'same-topic': '就是当前话题', 'sticky-short': '短句粘住当前', 'weak-current-new': '弱于当前，新建',
  'sticky-weak': '弱于当前，粘住', 'sticky-margin': '分差不足，粘住', 'strong-signal': '强信号切区',
  'switch-pending': '待确认切区', 'pending-switch': '确认切区', locked: '策略锁定不切走',
  'segment-ref': '追问指定分区', 'llm-new': 'LLM 判定新建', 'llm-stay': 'LLM 判定留下',
  'llm-route': 'LLM 判定切区', 'llm-uncertain': 'LLM 不确定', 'llm-fail': 'LLM 失败',
  'auto-create-off': '关闭自动建区', 'multi-topic': '多话题',
};

function renderTrace () {
  const rows = DATA.trace || [];
  const body = rows.slice().reverse().map(t => {
    const ex = t.explain || {};
    const matched = (ex.matched || []).join('、');
    const terms = (t.queryTerms || []).join('、');
    const cand = (t.scores || []).map(s => esc(s.name || s.id) + ' ' + Number(s.score || 0).toFixed(2) +
      '（覆盖 ' + Math.round((Number(s.coverage) || 0) * 100) + '%）' +
      ((s.matched || []).length ? ' <span class="keys">' + esc(s.matched.join('、')) + '</span>' : '')).join('<br>') || '无候选';
    const margin = ex.margin == null ? '—' : Number(ex.margin).toFixed(2);
    const detail = '<details><summary>' + esc(matched || '—') + '</summary><div class="keys">问句词：' + esc(terms || '—') +
      '<br>首选分 ' + Number(ex.topScore || 0).toFixed(2) + ' · 当前分 ' + (t.currentScore == null ? '—' : Number(t.currentScore).toFixed(2)) +
      ' · 与第二名的分差 ' + margin + '<br>' + cand + '</div></details>';
    return '<tr><td>' + esc(fmt(t.at)) + '</td><td>' + esc(t.text) + '</td><td>' + esc(t.name || t.wsId || '新建') +
      (t.segmentCount > 1 ? ' <span class="keys">' + (Number(t.segmentIndex) + 1) + '/' + t.segmentCount + '</span>' : '') +
      '</td><td>' + esc(HOW_LABEL[t.how] || t.how || '') + '<div class="keys">' + esc(t.how || '') + (t.llm ? ' · LLM' : '') +
      '</div></td><td>' + detail + '</td></tr>';
  }).join('');
  document.getElementById('trace').innerHTML = '<div class="sect">最近路由判定 · 展开“命中词”看候选与分差</div>' +
    (rows.length ? '<table><thead><tr><th>时间</th><th>消息</th><th>选择</th><th>依据</th><th>命中词 / 为什么</th></tr></thead><tbody>' + body + '</tbody></table>' : '<div class="empty">还没有判定记录。</div>');
}

function renderArchives () {
  const list = DATA.archives || [];
  if (!list.length) { document.getElementById('archives').innerHTML = ''; return; }
  document.getElementById('archives').innerHTML = '<div class="sect">已归档 · 手动归档 / 满额淘汰 / 上下文迁移</div><div class="grid">' + list.map(a => {
    const migrated = a.restorable === false;
    const label = migrated ? '已迁移到 ' + (a.migratedTo?.name || '目标工作区') : (a.reason === 'migrated-leftover' ? '迁移后剩余' : (a.reason || '归档'));
    const snap = migrated ? '原文已搬走' : ((a.turns || []).length + ' 条快照');
    return '<article class="card"><h2>话题：' + esc(a.name) + '</h2><div class="meta"><span>' + esc(fmt(a.archivedAt)) + '</span><span>' + esc(label) + '</span><span>' + esc(snap) + '</span><span>原占用 ' + fmtK(a.contextChars) + ' 字符</span></div><div class="scope">' + esc(a.description || '') + '</div><div class="actions">' +
      (migrated ? '<button data-arch="drop" data-id="' + esc(a.id) + '">彻底删除</button>' : '<button data-arch="restore" data-id="' + esc(a.id) + '">恢复</button><button data-arch="drop" data-id="' + esc(a.id) + '">彻底删除</button>') +
      '</div></article>';
  }).join('') + '</div>';
}

document.getElementById('q').addEventListener('input', e => { FILTER = e.target.value; render(); });
document.getElementById('refresh').addEventListener('click', () => get().catch(err => toast(err.message, true)));
document.getElementById('close-panel').addEventListener('click', () => {
  // 只有通过 window.open(..., "hybrid-workspace-panel") 打开的独立小窗才直接 close。
  // 同窗退回时调用 window.close() 会把 DSH 主窗口一起关掉，所以改为回到 DSH 首页。
  const popup = window.name === 'hybrid-workspace-panel';
  if (popup) {
    try { window.close(); } catch (error) { /* 小窗被拦截时不要动主窗口 */ }
    setTimeout(() => {
      if (window.closed) return;
      try { window.opener?.focus(); } catch (error) { /* ignore */ }
      window.location.assign('/');
    }, 150);
    return;
  }
  window.location.assign('/');
});
document.getElementById('create-ws').addEventListener('click', async () => {
  const form = await askWorkspaceForm('新建工作区');
  if (!form) return;
  try {
    const j = await post({ op: 'create', name: form.name, description: form.description });
    toast('已创建：' + (j.name || form.name));
  } catch (err) { toast(err.message, true); }
});
function openMigratePreview (preview) {
  return new Promise(resolve => {
    const root = document.createElement('div');
    root.className = 'modal';
    const plans = preview.plans || [];
    let body = '<div class="keys">目标：' + esc(preview.target?.name || '新建工作区') +
      '。来源搬空才自动归档且不可恢复；还有未勾选内容则保留来源区。</div>';
    for (const p of plans) {
      body += '<div class="plan"><h4>' + esc(p.source?.name || '来源') + ' → ' + esc(preview.target?.name || '目标') + '</h4>' +
        '<div class="keys">已选对话 ' + p.turns + ' 条 / 记忆 ' + p.memories + ' 条；未选 ' + (p.remainingTurns + p.remainingMemories) + ' 条</div>';
      const groups = new Map();
      for (const it of (p.items || [])) {
        const round = Number(it.round) || 0;
        if (!groups.has(round)) groups.set(round, []);
        groups.get(round).push(it);
      }
      for (const [round, list] of groups) {
        body += '<div class="round"><label class="round-all"><input type="checkbox" class="round-all" data-round="' + esc(round) + '" checked> 第 ' + esc(round) + ' 轮</label></div>';
        for (const it of list) {
          const role = it.kind === 'memory' ? '记忆' : (it.role === 'assistant' ? '助手' : '用户');
          body += '<label class="item"><input type="checkbox" data-key="' + esc(it.key) + '" data-round="' + esc(round) + '" checked><span class="role">' + role + '</span><span>' + esc(it.text) + '</span></label>';
        }
      }
      const near = p.nearItems || [];
      if (near.length) {
        body += '<div class="round">低分候选 · 默认不搬，勾选可补进目标区</div>';
        for (const it of near) {
          const role = it.kind === 'memory' ? '记忆' : (it.role === 'assistant' ? '助手' : '用户');
          body += '<label class="item"><input type="checkbox" data-key="' + esc(it.key) + '" data-near="1" data-round="' + esc(Number(it.round) || 0) + '"><span class="role">' + role + '</span><span>' + esc(it.text) + '</span> <span class="keys">' + Number(it.score || 0).toFixed(2) + '</span></label>';
        }
      }
      if (!(p.items || []).length && !near.length) body += '<div class="keys">没有可预览条目。</div>';
      body += '</div>';
    }
    body += '<div class="keys" id="mig-count"></div>';
    root.innerHTML = '<div class="modal-box"><h3>迁移预览 · 勾选要搬走的内容</h3><div class="modal-body">' + body +
      '</div><div class="modal-foot"><button id="mig-cancel">取消</button><button id="mig-go" class="primary">确认迁移</button></div></div>';
    document.body.appendChild(root);
    const boxes = () => [...root.querySelectorAll('input[data-key]')];
    const go = root.querySelector('#mig-go');
    const count = () => {
      const picked = boxes().filter(b => b.checked);
      const nearPicked = picked.filter(b => b.dataset.near).length;
      const el = root.querySelector('#mig-count');
      if (el) el.textContent = '已选 ' + picked.length + ' 条' + (nearPicked ? '（低分补选 ' + nearPicked + ' 条）' : '') + '；取消勾选的会留在来源区';
      go.disabled = picked.length === 0;
      for (const rb of root.querySelectorAll('input.round-all[data-round]')) {
        const round = rb.dataset.round;
        const group = [...root.querySelectorAll('input[data-key][data-round="' + round + '"]')];
        const on = group.filter(b => b.checked).length;
        rb.checked = group.length > 0 && on === group.length;
        rb.indeterminate = on > 0 && on < group.length;
      }
    };
    root.querySelector('#mig-cancel').onclick = () => { root.remove(); resolve(null); };
    root.addEventListener('change', (e) => {
      const all = e.target.closest?.('input.round-all[data-round]');
      if (all) {
        for (const b of root.querySelectorAll('input[data-key][data-round="' + all.dataset.round + '"]')) b.checked = all.checked;
      }
      count();
    });
    go.onclick = () => {
      const exclude = boxes().filter(b => !b.checked && !b.dataset.near).map(b => b.dataset.key);
      const include = boxes().filter(b => b.checked && b.dataset.near).map(b => b.dataset.key);
      root.remove();
      resolve({ exclude, include });
    };
    count();
  });
}

function download (name, content) {
  const blob = new Blob([content], { type: /\.json$/i.test(name) ? 'application/json' : 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.getElementById('export').addEventListener('click', async () => {
  const ids = [...SELECTED];
  if (!ids.length) {
    const all = await askConfirm('导出全部工作区', '没有勾选工作区，导出全部 ' + (DATA.workspaces || []).length + ' 个？');
    if (!all) return;
  }
  const raw = await askText('导出格式（markdown 或 json）', 'markdown');
  if (raw === null) return;
  const format = raw.trim().toLowerCase() === 'json' ? 'json' : 'markdown';
  try {
    const j = await post({ op: 'export', format, ...(ids.length ? { ids } : { all: true }) });
    download(j.filename, j.content);
    if (j.profile) toast('已导出 ' + (j.count || 0) + ' 个工作区、' + j.profile + ' 条全局档案。');
  } catch (err) { toast(err.message, true); }
});
document.getElementById('import').addEventListener('click', () => document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { toast('文件超过 8MB，请拆分后再导入。', true); return; }
  try {
    const j = await post({ op: 'import', content: await file.text() });
    toast('已导入 ' + (j.imported || []).length + ' 个工作区、' + (j.importedProfile || 0) + ' 条全局档案：\n' + (j.imported || []).map(x => x.name + '（' + x.turns + ' 轮 / ' + x.memories + ' 记忆）').join('\n'));
  } catch (err) { toast(err.message, true); }
});
document.getElementById('migrate').addEventListener('click', async () => {
  const sourceIds = [...SELECTED];
  if (!sourceIds.length) { toast('先在卡片右上角勾选要迁移的工作区。', true); return; }
  try {
    let into = await askText('迁移到哪个工作区？输入 id 或名称；留空则新建一个', '', true);
    if (into === null) return;
    into = into.trim();
    if (!into) {
      const form = await askWorkspaceForm('新建目标工作区');
      if (!form) return;
      const created = await post({ op: 'create', name: form.name, description: form.description });
      into = created.id;
    }
    const query = await askText('按关键词挑选要迁移的对话/记忆；留空表示全部迁移', '', true);
    if (query === null) return;
    const mode = query.trim() ? 'match' : 'all';
    const base = { op: 'migrate', sourceIds, into, query: query.trim(), mode, archiveMode: 'auto', rebindSessions: true };
    const preview = await post({ ...base, dryRun: true });
    if (!preview.totals || preview.totals.turns + preview.totals.memories + (preview.totals.near || 0) === 0) { toast('没有命中任何内容。', true); return; }
    const picked = await openMigratePreview(preview);
    if (!picked) return;
    const { exclude, include } = picked;
    if (!exclude.length && !include.length) {
      const empty = (preview.plans || []).every(p => (p.items || []).length === 0 && (p.nearItems || []).length === 0);
      if (empty) { toast('没有可迁移的条目。', true); return; }
    }
    const res = await post({ ...base, exclude, include, dryRun: false });
    SELECTED.clear();
    syncSelection();
    toast('已迁移：对话 ' + res.moved.turns + ' 条 / 记忆 ' + res.moved.memories + ' 条；归档 ' + res.archived.length + ' 个来源区。当前会话已重绑到目标区。');
  } catch (err) { toast(err.message, true); }
});
document.addEventListener('change', e => {
  const id = e.target?.dataset?.pick;
  if (!id) return;
  if (e.target.checked) SELECTED.add(id); else SELECTED.delete(id);
  syncSelection();
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const id = b.closest('.card')?.dataset.id;
  const op = b.dataset.op;
  try {
    if (b.dataset.arch) {
      if (b.dataset.arch === 'restore') await post({ op: 'restore', id: b.dataset.id });
      if (b.dataset.arch === 'drop' && await askConfirm('彻底删除归档', '彻底删除这条归档？')) await post({ op: 'dropArchive', id: b.dataset.id });
      return;
    }
    if (b.dataset.mem) {
      const memId = b.dataset.memId;
      if (b.dataset.mem === 'pin') await post({ op: 'pin', id: memId, pinned: true });
      if (b.dataset.mem === 'unpin') await post({ op: 'pin', id: memId, pinned: false });
      if (b.dataset.mem === 'restore') await post({ op: 'restoreMemory', id: memId });
      return;
    }
    if (!id || !op) return;
    if (op === 'rename') { const name = await askText('新名称'); if (name !== null) await post({ op: 'rename', id, name }); }
    if (op === 'describe') { const description = await askText('这个工作区负责什么？写清范围与边界', '', true); if (description !== null) await post({ op: 'describe', id, description }); }
    if (op === 'policy') {
      const cur = (DATA.workspaces || []).find(w => w.id === id);
      const policy = await askPolicy(cur?.policy || {});
      if (policy) await post({ op: 'policy', id, policy });
    }
    if (op === 'merge') {
      const target = await askText('要合并进哪个工作区？输入目标 id 或名称');
      if (target && await askConfirm('合并工作区', '合并后来源会被完整归档（可在归档区找回），确认合并到 ' + target + '？')) await post({ op: 'merge', id, into: target });
    }
    if (op === 'clear' && await askConfirm('清空工作区', '清空这个工作区的记忆与最近对话？')) await post({ op: 'clear', id });
    if (op === 'archive' && await askConfirm('归档话题', '归档这个话题？会从当前注入中移除，可在下方「已归档」恢复。')) await post({ op: 'archive', id });
    if (op === 'delete' && await askConfirm('永久删除', '永久删除这个话题及其上下文？绑定会话会解绑，且不可恢复。')) await post({ op: 'delete', id });
  } catch (err) { toast(err.message, true); }
});
document.getElementById('inbox').addEventListener('input', e => {
  if (e.target?.id === 'inbox-text') { DRAFT.text = e.target.value; syncInboxButtons(); }
});
document.getElementById('inbox').addEventListener('change', e => {
  if (e.target?.id === 'inbox-ws') { DRAFT.workspaceId = e.target.value; syncInboxButtons(); }
});
document.getElementById('inbox').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  try {
    if (b.id === 'inbox-add') {
      const text = DRAFT.text.trim();
      if (!text) { toast('先写任务内容', true); return; }
      if (!DRAFT.workspaceId) { toast('先选择工作区（手动锁定）', true); return; }
      await post({ op: 'inboxAdd', text, workspaceId: DRAFT.workspaceId });
      DRAFT.text = '';
      const ta = document.getElementById('inbox-text');
      if (ta) ta.value = '';
      toast('已加入队列');
      return;
    }
    const act = b.dataset.inbox;
    if (!act) return;
    if (act === 'run' || act === 'run-all') {
      const j = await post({ op: 'inboxRun', ...(act === 'run-all' ? { all: true } : {}) });
      if (j.busy) toast('已有任务在运行，等它结束', true);
      else if (j.empty) toast('队列里没有排队任务', true);
      else toast(act === 'run-all' ? '已开始顺序执行（P1 预览）' : '已开始下一个（P1 预览）');
      return;
    }
    if (act === 'cancel') { await post({ op: 'inboxCancel', id: b.dataset.id }); toast('已取消'); return; }
    if (act === 'retry') { await post({ op: 'inboxRetry', id: b.dataset.id }); toast('已重新排队'); return; }
    if (act === 'remove') { await post({ op: 'inboxRemove', id: b.dataset.id }); toast('已删除'); return; }
    if (act === 'clear') { const j = await post({ op: 'inboxClear' }); toast('已清空 ' + (j.removed || 0) + ' 条结束任务'); return; }
  } catch (err) { toast(err.message, true); }
});
get().catch(err => { document.getElementById('app').innerHTML = '<div class="empty bad">加载失败：' + esc(err.message) + '</div>'; });
// 后台标签页不刷新；刷新时保留展开的记忆/结论演变，并重新取数据，TTL 才不会锚在旧 fetchedAt。
setInterval(() => {
  if (document.hidden) return;
  get().catch(() => { /* 网络抖动保留上次渲染 */ });
}, 30000);
</script>
</body>
</html>`;

function sendJson (res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function isLoopback (addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}
function isLoopbackHost (host) {
  const raw = String(host ?? '').toLowerCase();
  if (!raw) return false;
  const name = raw.startsWith('[') ? raw.slice(1, raw.indexOf(']')) : raw.split(':')[0];
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}
function sameOrigin (req) {
  // 只接受本机回环客户端 + 回环 Host，挡住 DNS rebinding 和局域网直连。
  if (!isLoopback(req.socket?.remoteAddress)) return false;
  if (!isLoopbackHost(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (!origin) return true; // 同源表单/本地脚本通常不带 Origin；浏览器跨站请求必带。
  try {
    const u = new URL(origin);
    return u.host === req.headers.host && isLoopbackHost(u.host);
  } catch { return false; }
}

function readBody (req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function mountRoutes (ctx, { prefix = '/hybrid-workspace', snapshot, mutate } = {}) {
  const base = String(prefix || '/hybrid-workspace').replace(/\/+$/, '') || '/hybrid-workspace';
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: base,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const path = url.pathname.replace(/\/+$/, '') || '/';
        if (path === base || path === base + '/index.html') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(PAGE);
          return;
        }
        if (path === base + '/api') {
          // 读取同样要校验回环 Host/remoteAddress；否则 DNS rebinding 可以读走全部记忆。
          if (!sameOrigin(req)) { sendJson(res, 403, { error: '跨站请求被拒绝' }); return; }
          if (req.method === 'GET') { sendJson(res, 200, await snapshot({ sweep: false })); return; }
          if (req.method === 'POST') {
            if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) { sendJson(res, 400, { error: '只接受 application/json' }); return; }
            let payload;
            try { payload = JSON.parse(await readBody(req)); } catch (error) { sendJson(res, 400, { error: 'bad json: ' + error.message }); return; }
            const out = await mutate(payload);
            sendJson(res, out?.error ? 400 : 200, out);
            return;
          }
          sendJson(res, 405, { error: 'method not allowed' });
          return;
        }
        sendJson(res, 404, { error: 'not found' });
      } catch (error) {
        sendJson(res, 500, { error: String(error?.message ?? error) });
      }
    },
  });
  return dispose;
}

export { PAGE };
