// 工作区面板：宿主 webServer 直出 HTML + JSON API，零前端依赖。
// 页面只做展示与人工纠错（改范围/重命名/合并/清空/删除/恢复归档）。

const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>混合工作区 v2</title>
<style>
  :root { color-scheme: dark; --bg:#0b0e14; --card:#141925; --line:#232a3a; --text:#e8edf7; --mute:#8b96ab; --accent:#5aa8ff; --good:#51d18b; --warn:#ffb454; --bad:#ff6b7a; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  header { position:sticky; top:0; z-index:2; background:rgba(11,14,20,.94); backdrop-filter:blur(8px); border-bottom:1px solid var(--line); padding:14px 22px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  h1 { font-size:17px; margin:0; font-weight:650; letter-spacing:.2px; }
  .sub { color:var(--mute); font-size:12px; }
  .spacer { flex:1; }
  input, button { font:inherit; color:var(--text); background:#1b2231; border:1px solid var(--line); border-radius:8px; padding:7px 10px; }
  input { min-width:220px; }
  button { cursor:pointer; }
  button:hover { border-color:#3a4a66; background:#202a3d; }
  button.primary { background:#1d3a63; border-color:#2c5a9a; }
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
  .empty { color:var(--mute); padding:30px 0; }
  .sect { margin:26px 0 10px; font-size:14px; color:#c7d2e5; font-weight:650; }
  table { width:100%; border-collapse:collapse; font-size:12px; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:6px 9px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--mute); font-weight:500; background:#121826; }
  tr:last-child td { border-bottom:0; }
  .ok { color:var(--good); } .warn { color:var(--warn); } .bad { color:var(--bad); }
  .foot { color:var(--mute); font-size:11.5px; margin-top:14px; }
  @media (max-width:560px) { header { padding:12px; } main { padding:14px 12px 30px; } .grid { grid-template-columns:1fr; } input { flex:1; } .topic { flex-direction:column; } }
</style>
</head>
<body>
<header>
  <h1>混合工作区 <span class="sub">v2</span></h1>
  <span id="sub" class="sub"></span>
  <span class="spacer"></span>
  <input id="q" placeholder="过滤：名字 / 范围 / 记忆">
  <button id="refresh">刷新</button>
</header>
<main>
  <div id="stats" class="stats"></div>
  <div id="app" class="grid"></div>
  <div id="trace"></div>
  <div id="archives"></div>
  <div class="foot">人工纠错优先于自动路由：改范围、合并过度拆分的工作区，通常比反复重命名更有效。面板仅绑定本机回环地址。</div>
</main>
<script>
const API = location.pathname.replace(/\/$/, '') + '/api';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let DATA = { workspaces: [], archives: [], trace: [], stats: {} };
let FILTER = '';

async function get () {
  const r = await fetch(API, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  DATA = await r.json();
  render();
}
async function post (payload) {
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
  await get();
}
const fmt = (ts) => { if (!ts) return ''; const d = new Date(ts); return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); };
const fmtK = (n) => { n = Math.max(0, Number(n) || 0); return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n); };
const tag = (t) => '<span class="tag ' + esc(t) + '">' + esc({ decision: '决策', fact: '事实', todo: '待办', question: '问题', episode: '早期' }[t] || '记忆') + '</span>';

function render () {
  const st = DATA.stats || {};
  const totalChars = st.contextChars ?? (DATA.workspaces || []).reduce((n, w) => n + (w.contextChars || 0), 0);
  const totalTokens = st.contextTokens ?? (DATA.workspaces || []).reduce((n, w) => n + (w.contextTokens || 0), 0);
  document.getElementById('sub').textContent = (DATA.workspaces || []).length + ' 个工作区 · ' + (DATA.sessions || []).length + ' 个会话绑定 · 上下文 ' + fmtK(totalChars) + ' 字符';
  document.getElementById('stats').innerHTML = [
    ['工作区', st.workspaces ?? (DATA.workspaces || []).length, ''],
    ['记忆', st.memories ?? 0, ''],
    ['活跃会话', st.sessions ?? (DATA.sessions || []).length, ''],
    ['上下文合计', fmtK(totalChars), '≈' + fmtK(totalTokens) + ' tokens · 每区上限 ' + fmtK(st.contextMaxChars || 2400)],
    ['LLM 判定', st.llmCalls ?? 0, ''],
    ['归档', (DATA.archives || []).length, ''],
  ].map(([k, v, note]) => '<div class="stat"><b>' + esc(v) + '</b><span>' + esc(k) + (note ? ' · ' + esc(note) : '') + '</span></div>').join('');

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
}

function card (w) {
  const mems = (w.memories || []).slice().sort((a, b) => (b.status === 'active') - (a.status === 'active') || (b.turn - a.turn)).slice(0, 12);
  const memHtml = mems.map(m => '<div class="mem ' + (m.status === 'superseded' ? 'superseded' : '') + '" title="' + esc((m.keys || []).join('、')) + '">' +
    tag(m.type) + esc(m.text) + (m.status === 'superseded' ? ' <span class="keys">（已被新结论取代）</span>' : '') + '</div>').join('') || '<div class="mem keys">暂无结构化记忆</div>';
  const ex = (w.exemplars || []).map(e => '<div class="mem keys">· ' + esc(e.text || e) + '</div>').join('') || '<div class="mem keys">暂无</div>';
  const turns = (w.turns || []).slice(-6).map(t => '<div class="mem"><b>' + (t.role === 'assistant' ? '助手' : '用户') + '：</b>' + esc(t.text) + '</div>').join('') || '<div class="mem keys">暂无</div>';
  const counts = w.memoryStats || {};
  const pct = Math.max(0, Math.min(100, Number(w.contextPct) || 0));
  return '<article class="card" data-id="' + esc(w.id) + '">' +
    '<div class="topic"><h2>话题：' + esc(w.name) + '</h2>' +
    '<div class="topic-actions"><button data-op="archive">归档</button><button data-op="delete" class="danger">删除</button></div></div>' +
    '<div class="usage"><span>占用上下文 <b>' + fmtK(w.contextChars) + '</b> 字符 · ≈' + fmtK(w.contextTokens) + ' tokens · 预算 ' + pct + '%</span><span>上限 ' + fmtK(w.contextMaxChars || 2400) + '</span></div>' +
    '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
    '<div class="meta"><span>' + (w.rounds || 0) + ' 轮</span><span>命中 ' + (w.hits || 0) + '</span><span>' + esc(fmt(w.updatedAt)) + '</span><span>' + (w.sessions || 0) + ' 会话</span></div>' +
    '<div class="scope">' + esc(w.description || '（未填写范围）') + '</div>' +
    '<div class="chips">' + (w.keywords || []).map(k => '<span class="chip">' + esc(k) + '</span>').join('') + '</div>' +
    '<div class="meta"><span>记忆 ' + ((counts.decision || 0) + (counts.fact || 0) + (counts.todo || 0) + (counts.question || 0) + (counts.episode || 0)) + '</span><span>决策 ' + (counts.decision || 0) + '</span><span>待办 ' + (counts.todo || 0) + '</span></div>' +
    '<details open><summary>相关记忆（' + (w.memories || []).length + '）</summary>' + memHtml + '</details>' +
    '<details><summary>代表性问法（' + (w.exemplars || []).length + '）</summary>' + ex + '</details>' +
    '<details><summary>最近对话</summary>' + turns + '</details>' +
    '<div class="actions"><button data-op="rename">重命名</button><button data-op="describe">改范围</button><button data-op="merge">合并</button><button data-op="clear">清空</button></div>' +
    '</article>';
}

function renderTrace () {
  const rows = DATA.trace || [];
  document.getElementById('trace').innerHTML = '<div class="sect">最近路由判定</div>' + (rows.length ? '<table><thead><tr><th>时间</th><th>消息</th><th>选择</th><th>依据</th><th>候选分</th></tr></thead><tbody>' +
    rows.slice().reverse().map(t => '<tr><td>' + esc(fmt(t.at)) + '</td><td>' + esc(t.text) + '</td><td>' + esc(t.name || t.wsId || '新建') + '</td><td>' + esc(t.how || '') + (t.llm ? ' · LLM' : '') + '</td><td class="keys">' + esc((t.scores || []).map(s => (s.name || s.id) + ' ' + s.score).join(' / ')) + '</td></tr>').join('') +
    '</tbody></table>' : '<div class="empty">还没有判定记录。</div>');
}

function renderArchives () {
  const list = DATA.archives || [];
  if (!list.length) { document.getElementById('archives').innerHTML = ''; return; }
  document.getElementById('archives').innerHTML = '<div class="sect">已归档 · 手动归档或满额淘汰，可恢复</div><div class="grid">' + list.map(a =>
    '<article class="card"><h2>话题：' + esc(a.name) + '</h2><div class="meta"><span>' + esc(fmt(a.archivedAt)) + '</span><span>' + esc(a.reason || '') + '</span><span>' + (a.turns || []).length + ' 条快照</span><span>原占用 ' + fmtK(a.contextChars) + ' 字符</span></div><div class="scope">' + esc(a.description || '') + '</div><div class="actions"><button data-arch="restore" data-id="' + esc(a.id) + '">恢复</button><button data-arch="drop" data-id="' + esc(a.id) + '">彻底删除</button></div></article>').join('') + '</div>';
}

document.getElementById('q').addEventListener('input', e => { FILTER = e.target.value; render(); });
document.getElementById('refresh').addEventListener('click', () => get().catch(err => alert(err.message)));
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const id = b.closest('.card')?.dataset.id;
  const op = b.dataset.op;
  try {
    if (b.dataset.arch) {
      if (b.dataset.arch === 'restore') await post({ op: 'restore', id: b.dataset.id });
      if (b.dataset.arch === 'drop' && confirm('彻底删除这条归档？')) await post({ op: 'dropArchive', id: b.dataset.id });
      return;
    }
    if (!id || !op) return;
    if (op === 'rename') { const name = prompt('新名称'); if (name) await post({ op: 'rename', id, name }); }
    if (op === 'describe') { const description = prompt('这个工作区负责什么？写清范围与边界'); if (description !== null) await post({ op: 'describe', id, description }); }
    if (op === 'merge') { const target = prompt('要合并进哪个工作区？输入目标 id 或名称'); if (target) await post({ op: 'merge', id, into: target }); }
    if (op === 'clear' && confirm('清空这个工作区的记忆与最近对话？')) await post({ op: 'clear', id });
    if (op === 'archive' && confirm('归档这个话题？会从当前注入中移除，可在下方「已归档」恢复。')) await post({ op: 'archive', id });
    if (op === 'delete' && confirm('永久删除这个话题及其上下文？绑定会话会解绑，且不可恢复。')) await post({ op: 'delete', id });
  } catch (err) { alert(err.message); }
});
get().catch(err => { document.getElementById('app').innerHTML = '<div class="empty bad">加载失败：' + esc(err.message) + '</div>'; });
</script>
</body>
</html>`;

function sendJson (res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody (req, limit = 1024 * 1024) {
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
  ctx.webServer.register({
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
          if (req.method === 'GET') { sendJson(res, 200, await snapshot()); return; }
          if (req.method === 'POST') {
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
}

export { PAGE };
