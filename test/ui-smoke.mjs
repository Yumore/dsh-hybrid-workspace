import { createServer } from 'node:http';
import { tempHome, makeCtx, agent, firePre, fireAssistant, sleep } from './fake-ctx.mjs';

process.env.DSH_HOME = tempHome();
const { apply } = await import('../lib/index.js');

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
};

const ctx = makeCtx({ webServer: true });
const inst = apply(ctx, { debug: false, llmJudge: false });
const a = agent('s1');
await firePre(ctx, a, '示范门店收银机每天下午四点断线，先查 net.log 的 reconnect 记录', 1, 1);
await fireAssistant(ctx, a, '结论：示范门店收银机断线是 4G 链路心跳超时导致，下一步要把 reconnect 间隔改成 30 秒。');
await sleep(80);
ok('面板路由已注册', ctx.routes.length === 1, String(ctx.routes.length));

const route = ctx.routes[0];
const server = createServer((req, res) => route.handler(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port + '/hybrid-workspace';

async function req (path, opts) {
  const r = await fetch(base + path, opts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
}

try {
  const page = await req('');
  ok('面板 200', page.status === 200, String(page.status));
  ok('页面标题 v2', page.text.includes('混合工作区') && page.text.includes('v2'));
  ok('页面含记忆区块', page.text.includes('相关记忆') && page.text.includes('代表性问法'));
  ok('页面含路由 trace', page.text.includes('最近路由判定'));
  ok('页面含合并按钮', page.text.includes('data-op="merge"'));
  ok('页面自包含无外链', !page.text.includes('https://') && !page.text.includes('http://'));
  ok('页面体积正常', page.text.length > 7000, String(page.text.length));

  const api = await req('/api');
  ok('API 200 JSON', api.status === 200 && api.json && Array.isArray(api.json.workspaces), String(api.status));
  const ws = api.json.workspaces[0];
  ok('API 返回工作区', api.json.workspaces.length === 1 && ws.name.includes('示范门店'), ws?.name);
  ok('API 返回结构化记忆', (ws.memories ?? []).length >= 1 && ws.memoryStats, JSON.stringify(ws.memoryStats));
  ok('API 返回会话绑定', (api.json.sessions ?? []).length === 1);

  const renamed = await req('/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'rename', id: ws.id, name: '示范门店终端掉线' }) });
  ok('重命名返回 ok', renamed.status === 200 && renamed.json?.ok, String(renamed.status) + ' ' + renamed.text.slice(0, 80));
  const afterRename = await req('/api');
  ok('重命名已生效', afterRename.json.workspaces[0].name === '示范门店终端掉线', afterRename.json.workspaces[0].name);

  const described = await req('/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'describe', id: ws.id, description: '收银终端 4G 链路与 net.log 排查' }) });
  ok('改范围返回 ok', described.status === 200 && described.json?.ok);
  const afterDescribe = await req('/api');
  ok('改范围已生效', afterDescribe.json.workspaces[0].description.includes('4G'));

  const unknown = await req('/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'nope' }) });
  ok('未知操作 400', unknown.status === 400 && unknown.json?.error, String(unknown.status));

  const bad = await fetch(base + '/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  ok('坏 JSON 400', bad.status === 400, String(bad.status));

  const missing = await req('/nope');
  ok('未知路径 404', missing.status === 404, String(missing.status));

  const method = await fetch(base + '/api', { method: 'PUT' });
  ok('不支持方法 405', method.status === 405, String(method.status));

  await inst.flush();
  await sleep(50);
  // 落盘由 core/migration 覆盖，这里只确认 dispose 不抛错。
  for (const h of ctx.handlers['dispose'] ?? []) h();
  ok('dispose 不抛错', true);
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(fails ? 'UI FAIL ' + fails : 'UI PASS');
process.exit(fails ? 1 : 0);
