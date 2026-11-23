import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { agent, firePre, makeCtx, sleep, tempHome } from './fake-ctx.mjs';
import { classifyLifecycle } from '../lib/lifecycle.js';
import { planMigration } from '../lib/migrate.js';
import { toMarkdown, parsePortable, toJson } from '../lib/portable.js';

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
};

// 1. 规则分类：裸词不能把普通表述误升为全局或临时。
ok('“我是说”不升级全局档案', classifyLifecycle('我是说这个接口要改', { role: 'user' }).tier === 'durable');
ok('“我是这样理解”不升级全局档案', classifyLifecycle('我是这样理解这个需求的', { role: 'user' }).tier === 'durable');
ok('“我是一名研发经理”升级全局档案', classifyLifecycle('我是一名研发经理', { role: 'user' }).tier === 'profile');
ok('“最新版本”不判临时', classifyLifecycle('最新版本是 2.4.0', { role: 'user' }).tier === 'durable');
ok('“实时同步”不判临时', classifyLifecycle('实时同步失败要重试', { role: 'user' }).tier === 'durable');
ok('“设备温度阈值”不判临时', classifyLifecycle('设备温度阈值设成 80 度', { role: 'user' }).tier === 'durable');
ok('“今天天气”仍判临时', classifyLifecycle('今天天气怎么样', { role: 'user' }).tier === 'scratch');

// 2. 迁移 key 不能含 NUL，否则 HTML data-key 会损坏。
const plan = planMigration({
  turns: [
    { role: 'user', text: '收银机断线', turn: 1, at: 1000 },
    { role: 'assistant', text: '先查 net.log', turn: 1, at: 1001 },
  ],
  memories: [{ id: 'm_x', type: 'decision', text: '断线根因是心跳超时', turn: 1, at: 1000, status: 'active' }],
}, { query: '断线', mode: 'all' });
ok('迁移逐条 key 不含 NUL', plan.items.length === 3 && plan.items.every(x => !x.key.includes('\u0000')), JSON.stringify(plan.items.map(x => x.key)));

// 3. Markdown 全局档案可回读。
const md = toMarkdown([{
  name: '档案示例', description: '', keywords: [], summary: '', rounds: 0, turns: [],
  memories: [], exemplars: [],
}], { profile: [{ id: 'p1', text: '回答先给结论', type: 'fact', tier: 'profile', scope: 'global', status: 'active', pinned: true, turn: 0, at: Date.now() }] });
const parsedMd = parsePortable(md);
ok('Markdown 全局档案可回读', parsedMd.profile.length === 1 && parsedMd.profile[0].text.includes('先给结论'), parsedMd.error || parsedMd.profile.length);

// 4. 插件 API：CSRF、归档深度、导入上限、合并归档。
process.env.DSH_HOME = tempHome();
const { apply } = await import('../lib/index.js');
const ctx = makeCtx({ webServer: true });
const inst = apply(ctx, { debug: false, disableProcessHook: true, llmJudge: false, multiTopic: true, sweepIntervalMs: 0 });
const a = agent('reg-session');
await firePre(ctx, a, '示范门店收银机断线，先查 net.log', 1);
await sleep(100);
const route = ctx.routes[0];
const server = createServer((req, res) => route.handler(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port + '/hybrid-workspace';
const origin = new URL(base).origin;
async function send (path, opts) {
  const r = await fetch(base + path, opts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
}
async function post (body, headers = {}) {
  return send('/api', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

try {
  const badType = await send('/api', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  ok('非 JSON POST 被拒绝', badType.status === 400, String(badType.status));
  const badOrigin = await post({ op: 'list' }, { origin: 'http://evil.example' });
  ok('跨站 Origin 被拒绝', badOrigin.status === 403, String(badOrigin.status));
  const goodOrigin = await post({ op: 'list' }, { origin });
  ok('同源 Origin 放行', goodOrigin.status === 200 && goodOrigin.json?.ok === true, String(goodOrigin.status));

  const live = inst.state.workspaces[0];
  const wsId = live.id;
  live.policy = { contextMaxChars: 900, memoryInject: 2, autoSwitch: false };
  for (let i = 1; i <= 30; i++) live.turns.push({ role: i % 2 ? 'user' : 'assistant', text: '归档深度对话 ' + i, turn: i, round: i, at: Date.now() + i });
  for (let i = 1; i <= 80; i++) live.memories.push({ id: 'm_deep_' + i, type: 'fact', text: '归档深度记忆 ' + i, keys: ['归档'], turn: i, at: Date.now() + i, status: 'active', tier: 'durable', scope: 'workspace' });
  live.memories.push({ id: 'm_deep_sup', type: 'decision', text: '旧口径：库存 10', status: 'superseded', supersededBy: 'm_deep_new', tier: 'durable', scope: 'workspace', turn: 31, at: Date.now() });
  live.memories.push({ id: 'm_deep_exp', type: 'fact', text: '过期记忆', status: 'expired', tier: 'durable', scope: 'workspace', turn: 32, at: Date.now() });
  await inst.flush();
  const beforeTurns = live.turns.length;
  const beforeMems = live.memories.length;

  const archived = await post({ op: 'archive', id: wsId });
  ok('归档成功', archived.status === 200 && archived.json?.archived === true, JSON.stringify(archived.json));
  const entry = inst.state.archives.find(x => x.id === wsId);
  ok('归档保留全量对话', entry?.turns?.length === beforeTurns, JSON.stringify({ got: entry?.turns?.length, want: beforeTurns }));
  ok('归档保留全量记忆', entry?.memories?.length === beforeMems, JSON.stringify({ got: entry?.memories?.length, want: beforeMems }));
  ok('归档保留策略', entry?.policy?.contextMaxChars === 900 && entry.policy.autoSwitch === false, JSON.stringify(entry?.policy));

  const restored = await post({ op: 'restore', id: entry.id });
  ok('归档可恢复', restored.status === 200 && restored.json?.id, JSON.stringify(restored.json));
  const back = inst.state.workspaces.find(w => w.id === restored.json.id);
  ok('恢复保留全量对话', back?.turns?.length === beforeTurns, String(back?.turns?.length));
  ok('恢复保留全量记忆与状态', back?.memories?.length === beforeMems && back.memories.some(m => m.status === 'superseded') && back.memories.some(m => m.status === 'expired'), JSON.stringify(back?.memories?.filter(m => m.status !== 'active').map(m => m.status)));
  ok('恢复保留策略', back?.policy?.contextMaxChars === 900 && back.policy.autoSwitch === false, JSON.stringify(back?.policy));

  const many = Array.from({ length: 17 }, (_, i) => ({
    name: '批量导入 ' + String(i).padStart(2, '0'),
    turns: [{ role: 'user', text: '批量话题 ' + i, turn: 1, at: Date.now() }],
    memories: i === 0
      ? Array.from({ length: 600 }, (_, j) => ({ id: 'bulk_' + j, type: 'fact', text: '第 ' + j + ' 条记忆', turn: 1, status: 'active', tier: 'durable', scope: 'workspace' }))
      : [{ id: 'one_' + i, type: 'fact', text: '普通记忆 ' + i, turn: 1, status: 'active', tier: 'durable', scope: 'workspace' }],
  }));
  const payload = {
    format: 'dsh-hybrid-workspace', version: 1,
    profile: [{ id: 'import_p1', text: '导入的全局偏好', type: 'fact', tier: 'profile', scope: 'global', status: 'active', pinned: true, turn: 0, at: Date.now() }],
    workspaces: many,
  };
  const imp = await post({ op: 'import', content: JSON.stringify(payload) });
  ok('导入 17 个工作区不被截成 5 个', imp.status === 200 && imp.json?.imported?.length === 17, JSON.stringify(imp.json?.imported?.length));
  ok('导入全局档案计数', imp.json?.importedProfile === 1, String(imp.json?.importedProfile));
  const bulk = inst.state.workspaces.find(w => w.name === '批量导入 00');
  ok('导入保留最新 500 条记忆', bulk?.memories?.length === 500 && bulk.memories[0].text.includes('第 100 条'), JSON.stringify({ n: bulk?.memories?.length, first: bulk?.memories?.[0]?.text }));
  ok('导入全部工作区都在内存', inst.state.workspaces.filter(w => w.name.startsWith('批量导入')).length === 17);

  const src = await post({ op: 'create', name: '合并来源', description: '来源范围' });
  const tgt = await post({ op: 'create', name: '合并目标', description: '目标范围' });
  const srcWs = inst.state.workspaces.find(w => w.id === src.json.id);
  srcWs.turns = [{ role: 'user', text: '来源对话', turn: 1, at: Date.now() }];
  srcWs.memories = [{ id: 'm_merge_src', type: 'decision', text: '来源结论', turn: 1, status: 'active', tier: 'durable', scope: 'workspace' }];
  srcWs.rounds = 1;
  await inst.flush();
  const merged = await post({ op: 'merge', id: src.json.id, into: tgt.json.id });
  ok('合并返回归档标记', merged.status === 200 && merged.json?.archived === true, JSON.stringify(merged.json));
  ok('合并来源移出工作区', !inst.state.workspaces.some(w => w.id === src.json.id));
  const mergeArch = inst.state.archives.find(x => x.id === src.json.id);
  ok('合并来源完整归档', mergeArch?.reason === 'merged' && mergeArch.turns.length === 1 && mergeArch.memories.length === 1, JSON.stringify({ reason: mergeArch?.reason, turns: mergeArch?.turns?.length }));
  const tgtWs = inst.state.workspaces.find(w => w.id === tgt.json.id);
  ok('合并目标包含来源内容', tgtWs?.turns?.some(t => t.text === '来源对话') && tgtWs?.memories?.some(m => m.text === '来源结论'));

  const exp = await post({ op: 'export', all: true, format: 'json' });
  const exported = JSON.parse(exp.json.content || '{}');
  ok('导出包含全局档案', (exported.profile || []).length >= 1 && exp.json.profile >= 1, JSON.stringify({ profile: exported.profile?.length }));
  const html = await (await fetch(base + '/')).text();
  ok('迁移预览含按轮次全选', html.includes('round-all') && html.includes('data-round'));
  ok('费用标签说明最近 12 会话', html.includes('最近 12 会话合计') || html.includes('会话费用'));
} finally {
  server.close();
}

await sleep(30);
console.log(fails ? 'REGRESSIONS FAIL ' + fails : 'REGRESSIONS PASS');
if (fails) process.exitCode = 1;
