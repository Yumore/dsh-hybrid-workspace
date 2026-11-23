import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { agent, firePre, makeCtx, sleep, tempHome } from './fake-ctx.mjs';
import { buildTimeline } from '../lib/timeline.js';
import { normalizePolicy, contextCfgFor } from '../lib/policy.js';
import { toMarkdown, parsePortable } from '../lib/portable.js';

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
};

// ── 纯函数：策略归一、预算合并、时间线、Markdown 往返 ──
const p = normalizePolicy({ contextMaxChars: 400, memoryInject: 99, autoSwitch: false });
ok('策略夹取到合法范围', p.contextMaxChars === 600 && p.memoryInject === 20 && p.autoSwitch === false, JSON.stringify(p));
const c = contextCfgFor({ policy: { contextMaxChars: 900, memoryInject: 2 } }, { contextMaxChars: 2400, memoryInject: 8, contextMinChars: 800 });
ok('策略覆盖全局预算', c.contextMaxChars === 900 && c.memoryInject === 2 && c.contextMinChars === 800, JSON.stringify(c));
const t0 = Date.now();
const chain = buildTimeline({ memories: [
  { id: 'm_old', text: '旧口径：库存 10', type: 'decision', status: 'superseded', supersededBy: 'm_new', turn: 1, at: t0 - 1000 },
  { id: 'm_new', text: '新口径：库存 20', type: 'decision', status: 'active', turn: 2, at: t0 },
] });
ok('时间线串起旧结论到新结论', chain.chains.length === 1 && chain.chains[0].nodes.length === 2 && chain.chains[0].nodes[0].id === 'm_old', JSON.stringify(chain));
const chain3 = buildTimeline({ memories: [
  { id: 'm_a', text: '最初口径 A', type: 'decision', status: 'superseded', supersededBy: 'm_b', turn: 1, at: t0 - 3000 },
  { id: 'm_b', text: '中间口径 B', type: 'decision', status: 'superseded', supersededBy: 'm_c', turn: 2, at: t0 - 2000 },
  { id: 'm_c', text: '最新口径 C', type: 'decision', status: 'active', turn: 3, at: t0 },
] });
ok('时间线不重复生成子链', chain3.chains.length === 1 && chain3.chains[0].nodes.length === 3 && chain3.chains[0].nodes[0].id === 'm_a', JSON.stringify(chain3));
const md = toMarkdown([{ id: 'ws_md', name: '导出样例', description: '边界', keywords: ['断线'], summary: '', rounds: 1, turns: [{ role: 'user', text: '收银机断线', turn: 1, at: t0 }], memories: [{ id: 'm_md', type: 'fact', text: '断线先查 net.log', keys: ['断线'], status: 'active', tier: 'durable', scope: 'workspace', turn: 1, at: t0 }] }]);
const parsed = parsePortable(md);
ok('Markdown 导出可回读', parsed.workspaces.length === 1 && parsed.workspaces[0].turns[0].text.includes('收银机') && parsed.workspaces[0].memories[0].text.includes('net.log'), JSON.stringify(parsed.error || parsed.workspaces.length));

// ── 插件：策略锁定、费用桥接、时间线、迁移排除、导出/导入 ──
process.env.DSH_HOME = tempHome();
const { apply } = await import('../lib/index.js');
const ctx = makeCtx({ webServer: true });
ctx.costMeter = {
  async getSessionCost (sid) {
    if (sid !== 's1') return { found: false };
    return { found: true, own: { cost: 0.0123, apiCost: 0.02, calls: 2, input: 100, output: 50, cacheRead: 10, cacheWrite: 0, reasoning: 0 } };
  },
};
const inst = apply(ctx, { debug: false, disableProcessHook: true, llmJudge: false, multiTopic: true });
const a = agent('s1');
const first = await firePre(ctx, a, '示范门店收银机断线，先查 net.log', 1);
await sleep(100);
await inst.flush();
let st = inst.state;
const wsId = st.sessions.s1.workspaceId;
ok('首条消息建立当前区', Boolean(wsId) && st.workspaces.length === 1, wsId);

const route = ctx.routes[0];
const server = createServer((req, res) => route.handler(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port + '/hybrid-workspace';
async function post (body) {
  const r = await fetch(base + '/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

try {
  const setPolicy = await post({ op: 'policy', id: wsId, policy: { contextMaxChars: 900, memoryInject: 1, autoSwitch: false } });
  ok('策略 API 返回 ok', setPolicy.status === 200 && setPolicy.json.policy?.autoSwitch === false, JSON.stringify(setPolicy.json));
  const section = await firePre(ctx, a, '会员积分接口改异步队列\n\n供应商对账差两毛三分', 2);
  await sleep(100);
  await inst.flush();
  st = inst.state;
  ok('locked 策略不拆出多个区', st.workspaces.length === 1, String(st.workspaces.length));
  ok('locked 策略整条留在当前区', st.sessions.s1.workspaceId === wsId && st.workspaces[0].rounds === 2, String(st.workspaces[0].rounds));
  ok('locked 策略清空多话题分段', st.sessions.s1.lastSegments.length === 0 && st.sessions.s1.multiQuery === '');
  ok('locked 策略仍注入当前区', section.includes('收银机') || section.includes('net.log'), section.slice(0, 60));

  const snap = await inst.snapshot();
  const card = snap.workspaces.find(w => w.id === wsId);
  ok('snapshot 暴露工作区策略', card?.policy?.autoSwitch === false && card.policy.contextMaxChars === 900 && card.policy.memoryInject === 1, JSON.stringify(card?.policy));
  ok('cost-meter 服务被桥接', snap.cost?.available === true && snap.cost.total.cost > 0, JSON.stringify(snap.cost));
  ok('会话行带费用', snap.sessions.some(s => s.sessionId === 's1' && s.cost?.found === true));

  st = inst.state;
  st.workspaces.find(w => w.id === wsId).memories.push(
    { id: 'm_old', text: '旧口径：库存 10', type: 'decision', status: 'superseded', supersededBy: 'm_new', turn: 1, at: t0 - 1000, tier: 'durable', scope: 'workspace' },
    { id: 'm_new', text: '新口径：库存 20', type: 'decision', status: 'active', turn: 2, at: t0, tier: 'durable', scope: 'workspace' },
  );
  await inst.flush();
  const snap2 = await inst.snapshot();
  const timeline = snap2.workspaces.find(w => w.id === wsId).timeline;
  ok('snapshot 暴露结论演变', timeline?.chains?.length === 1 && timeline.chains[0].nodes.length === 2, JSON.stringify(timeline));

  // 迁移预览逐条排除一条记忆
  st = inst.state;
  st.workspaces.push({
    id: 'ws_src3', name: '收银与积分杂项', description: '混合', keywords: ['收银机', '积分'], summary: '',
    turns: [
      { role: 'user', text: '收银机断线先查 net.log', turn: 1, at: t0 - 5000 },
      { role: 'assistant', text: '结论：4G 心跳超时', turn: 1, at: t0 - 4000 },
      { role: 'user', text: '会员积分改异步', turn: 2, at: t0 - 3000 },
      { role: 'assistant', text: '结论：先落队列', turn: 2, at: t0 - 2000 },
    ],
    memories: [
      { id: 'm_src_disc', text: '收银机断线根因是 4G 心跳超时', keys: ['断线'], type: 'decision', turn: 1, status: 'active', tier: 'durable', scope: 'workspace' },
      { id: 'm_src_int', text: '积分接口改为异步写入', keys: ['积分'], type: 'decision', turn: 2, status: 'active', tier: 'durable', scope: 'workspace' },
    ],
    exemplars: [], rounds: 2, hits: 0, createdAt: t0, updatedAt: t0,
  });
  st.workspaces.push({ id: 'ws_tgt3', name: '收银专项', description: '', keywords: ['收银机'], summary: '', turns: [], memories: [], exemplars: [], rounds: 0, hits: 0, createdAt: t0, updatedAt: t0 });
  await inst.flush();
  const dry = await post({ op: 'migrate', sourceIds: ['ws_src3'], into: 'ws_tgt3', mode: 'all', dryRun: true });
  const items = dry.json.plans?.[0]?.items || [];
  ok('迁移预览返回逐条 items', items.length === 6 && items.every(x => x.key && x.kind), String(items.length));
  const excludeKey = items.find(x => x.kind === 'memory' && x.text.includes('积分'))?.key;
  const moved = await post({ op: 'migrate', sourceIds: ['ws_src3'], into: 'ws_tgt3', mode: 'all', exclude: [excludeKey], dryRun: false, archiveMode: 'auto' });
  ok('排除一条记忆后仍迁移', moved.status === 200 && moved.json.moved?.turns === 4 && moved.json.moved?.memories === 1, JSON.stringify(moved.json));
  const src = inst.state.workspaces.find(w => w.id === 'ws_src3');
  const tgt = inst.state.workspaces.find(w => w.id === 'ws_tgt3');
  ok('被排除的记忆留在来源区', src?.memories?.length === 1 && src.memories[0].id === 'm_src_int', JSON.stringify(src?.memories));
  ok('未搬空的来源不归档', (moved.json.archived || []).length === 0);
  ok('目标收到四条对话一条记忆', tgt?.turns?.length === 4 && tgt?.memories?.length === 1);

  const exp = await post({ op: 'export', all: true, format: 'json' });
  const exported = JSON.parse(exp.json.content || '{}');
  ok('导出 JSON 含全部工作区', exp.status === 200 && exp.json.format === 'json' && exported.workspaces.length === inst.state.workspaces.length, String(exported.workspaces?.length));
  const imp = await post({ op: 'import', content: exp.json.content });
  ok('导入 JSON 建立工作区', imp.status === 200 && (imp.json.imported || []).length === exported.workspaces.length, JSON.stringify(imp.json.error || imp.json.imported?.length));
  ok('导入的工作区分到新 id', (imp.json.imported || []).every(x => !exported.workspaces.some(w => w.id === x.id)));

  const html = await (await fetch(base + '/')).text();
  ok('页面版本 v2.3', html.includes('v2.3'));
  ok('页面含导出/导入', html.includes('id="export"') && html.includes('id="import"') && html.includes('data-key'));
  ok('页面含策略与时间线', html.includes('data-op="policy"') && html.includes('结论演变'));
  ok('页面 trace 含命中词', html.includes('命中词') && html.includes('问句词'));
  ok('页面含迁移逐条预览', html.includes('openMigratePreview') && html.includes('取消勾选的会留在来源区'));
} finally {
  server.close();
}

// 没有 costMeter 服务时完全隐藏
process.env.DSH_HOME = tempHome();
const inst2 = apply(makeCtx({ webServer: false }), { debug: false, disableProcessHook: true, llmJudge: false });
const snap3 = await inst2.snapshot();
ok('无 cost-meter 时费用隐藏', snap3.cost?.available === false, JSON.stringify(snap3.cost));

await sleep(30);
console.log(fails ? 'V23 FAIL ' + fails : 'V23 PASS');
if (fails) process.exitCode = 1;
