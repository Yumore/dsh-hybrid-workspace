import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrMigrate } from '../lib/store.js';
import { consolidate, rememberText } from '../lib/memory.js';
import { pinMemory, restoreMemory } from '../lib/lifecycle.js';
import { mergeWorkspace } from '../lib/router.js';
import { buildMultiContext } from '../lib/context.js';
import { makeCtx, sleep, tempHome } from './fake-ctx.mjs';

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
};
const now = Date.now();

// ── 1. 损坏的 v2 不能被旧 v1 覆盖 ──
const home1 = mkdtempSync(join(tmpdir(), 'hw-v2-review-'));
const v2dir = join(home1, 'hybrid-workspace-v2');
const v1dir = join(home1, 'hybrid-workspace');
mkdirSync(v2dir, { recursive: true });
mkdirSync(v1dir, { recursive: true });
writeFileSync(join(v2dir, 'state.json'), '{ broken', 'utf8');
writeFileSync(join(v1dir, 'state.json'), JSON.stringify({ workspaces: [{ id: 'v1old', name: '旧 v1 工作区', turns: [] }] }), 'utf8');
const loaded = await loadOrMigrate({ dshHome: home1, log: () => {} });
ok('损坏 v2 回退空状态并标记 corrupt', loaded.state.workspaces.length === 0 && loaded.corrupt === true, String(loaded.state.workspaces.length));
ok('损坏 v2 不迁移旧 v1', readFileSync(join(v2dir, 'state.json'), 'utf8').includes('旧 v1 工作区') === false);
ok('损坏 v2 已备份', readdirSync(v2dir).some(f => f.startsWith('state.json.corrupt-')));

// ── 2. 高相似但内容不同的新结论必须 supersede；复述才 noop ──
const ws = { memories: [] };
const base = { type: 'fact', keys: ['库存'], importance: 2, turn: 1, at: now, status: 'active', tier: 'durable', scope: 'workspace' };
consolidate(ws, { ...base, id: 'm_old', text: '库存 10 台' }, { memoryKeep: 20 });
const changed = consolidate(ws, { ...base, id: 'm_new', text: '库存 20 台', turn: 2, at: now + 1 }, { memoryKeep: 20 });
ok('高相似新事实取代旧事实', changed.op === 'supersede' && ws.memories.find(m => m.id === 'm_old').status === 'superseded', changed.op);
const restated = consolidate(ws, { ...base, id: 'm_same', text: '库存 20 台。', turn: 3, at: now + 2 }, { memoryKeep: 20 });
ok('同结论复述不重复入库', restated.op === 'noop', restated.op);

// 实体保护：不同门店/订单不能互相取代；同一实体换结论仍要取代。
const wsEntity = { id: 'ws_entity', memories: [] };
const entA = consolidate(wsEntity, { ...base, id: 'm_ent_a', text: '门店A的库存是10', turn: 1, at: now }, { memoryKeep: 20 });
const entB = consolidate(wsEntity, { ...base, id: 'm_ent_b', text: '门店B的库存是20', turn: 2, at: now + 1 }, { memoryKeep: 20 });
ok('不同门店的事实不互相取代', entB.op === 'add' && wsEntity.memories.find(m => m.id === entA.memory.id).status === 'active', entB.op);
const entA2 = consolidate(wsEntity, { ...base, id: 'm_ent_a2', text: '门店A的库存是20', turn: 3, at: now + 2 }, { memoryKeep: 20 });
ok('同一门店换库存仍取代', entA2.op === 'supersede', entA2.op);
const wsPartial = { id: 'ws_partial', memories: [] };
consolidate(wsPartial, { ...base, id: 'm_two', text: '门店A和门店B的库存分别是10和20', turn: 1, at: now }, { memoryKeep: 20 });
const partial = consolidate(wsPartial, { ...base, id: 'm_one', text: '门店A的库存是30', turn: 2, at: now + 1 }, { memoryKeep: 20 });
ok('实体集合不同不取代，避免丢掉另一个实体', partial.op === 'add' && wsPartial.memories.find(m => m.id === 'm_two').status === 'active', partial.op);
const wsSubject = { id: 'ws_subject', memories: [] };
consolidate(wsSubject, { ...base, id: 'm_sub1', text: '接口超时是网络问题', turn: 1, at: now }, { memoryKeep: 20 });
const sub2 = consolidate(wsSubject, { ...base, id: 'm_sub2', text: '接口超时是数据库连接池耗尽', turn: 2, at: now + 1 }, { memoryKeep: 20 });
ok('同一主语换根因仍取代', sub2.op === 'supersede', sub2.op);

// 编号带字母/多位数、序数带不同名词，都不能被当成同一实体。
const wsIds = { id: 'ws_ids', memories: [] };
const idA1 = consolidate(wsIds, { ...base, id: 'm_id_a1', text: '门店A1的库存是10', turn: 1, at: now }, { memoryKeep: 20 });
const idA2 = consolidate(wsIds, { ...base, id: 'm_id_a2', text: '门店A2的库存是20', turn: 2, at: now + 1 }, { memoryKeep: 20 });
ok('门店A1/A2 不互相取代', idA2.op === 'add' && wsIds.memories.find(m => m.id === idA1.memory.id).status === 'active', idA2.op);
const wsIds2 = { id: 'ws_ids2', memories: [] };
consolidate(wsIds2, { ...base, id: 'm_id_n1b', text: '门店 1234 的库存是5', turn: 1, at: now }, { memoryKeep: 20 });
const idN2 = consolidate(wsIds2, { ...base, id: 'm_id_n2', text: '门店 1235 的库存是8', turn: 2, at: now + 1 }, { memoryKeep: 20 });
ok('门店 1234/1235 不互相取代', idN2.op === 'add' && wsIds2.memories.find(m => m.id === 'm_id_n1b').status === 'active', idN2.op);
const wsOrd = { id: 'ws_ord', memories: [] };
consolidate(wsOrd, { ...base, id: 'm_ord1', text: '3号店的库存是10', turn: 1, at: now }, { memoryKeep: 20 });
const ord2 = consolidate(wsOrd, { ...base, id: 'm_ord2', text: '3号机的库存是20', turn: 2, at: now + 1 }, { memoryKeep: 20 });
ok('3号店/3号机不互相取代', ord2.op === 'add' && wsOrd.memories.find(m => m.id === 'm_ord1').status === 'active', ord2.op);

// 命名门店和超长同前缀不同主题也不能靠词面相似取代。
const wsName = { id: 'ws_name', memories: [] };
consolidate(wsName, { ...base, id: 'm_name_bj', text: '北京门店的库存是10', turn: 1, at: now }, { memoryKeep: 20 });
const nameSh = consolidate(wsName, { ...base, id: 'm_name_sh', text: '上海门店的库存是20', turn: 2, at: now + 1 }, { memoryKeep: 20 });
ok('北京门店/上海门店不互相取代', nameSh.op === 'add' && wsName.memories.find(m => m.id === 'm_name_bj').status === 'active', nameSh.op);
// 没有“是/库存”分隔词时，名称同样要参与实体判断。
const wsNameNoSep = { id: 'ws_name_nosep', memories: [] };
consolidate(wsNameNoSep, { ...base, id: 'm_name_bj2', text: '北京门店库存10', turn: 1, at: now }, { memoryKeep: 20 });
const nameNoSep = consolidate(wsNameNoSep, { ...base, id: 'm_name_sh2', text: '上海门店库存20', turn: 2, at: now + 1 }, { memoryKeep: 20 });
ok('无分隔词时北京门店/上海门店仍不互相取代', nameNoSep.op === 'add' && wsNameNoSep.memories.find(m => m.id === 'm_name_bj2').status === 'active', nameNoSep.op);
const wsNameSame = { id: 'ws_name_same', memories: [] };
consolidate(wsNameSame, { ...base, id: 'm_name_bj3', text: '北京门店库存10', turn: 1, at: now }, { memoryKeep: 20 });
const nameSame = consolidate(wsNameSame, { ...base, id: 'm_name_bj4', text: '北京门店库存20', turn: 2, at: now + 1 }, { memoryKeep: 20 });
ok('无分隔词时同一北京门店换库存仍取代', nameSame.op === 'supersede' && wsNameSame.memories.find(m => m.id === 'm_name_bj3').status === 'superseded', nameSame.op);
const wsLong = { id: 'ws_long', memories: [] };
consolidate(wsLong, { ...base, id: 'm_long_a', text: '华润万象生活深圳万象城店今日上午收银机出现大面积掉线现象', turn: 1, at: now }, { memoryKeep: 20 });
const longB = consolidate(wsLong, { ...base, id: 'm_long_b', text: '华润万象生活深圳万象城店今日上午会员积分活动正式上线开始', turn: 2, at: now + 1 }, { memoryKeep: 20 });
ok('相同前缀但不同主题不互相取代', longB.op === 'add' && wsLong.memories.find(m => m.id === 'm_long_a').status === 'active', longB.op);

// 最高分候选是另一个实体时，要跳过它继续找同实体候选。
const wsChain = { id: 'ws_chain', memories: [] };
consolidate(wsChain, { ...base, id: 'm_chain_a', text: '门店A的库存是10', turn: 1, at: now }, { memoryKeep: 20 });
consolidate(wsChain, { ...base, id: 'm_chain_b', text: '门店B的库存是20', turn: 2, at: now + 1 }, { memoryKeep: 20 });
const chainC = consolidate(wsChain, { ...base, id: 'm_chain_c', text: '门店B的库存是30', turn: 3, at: now + 2 }, { memoryKeep: 20 });
ok('跳过冲突候选后仍取代同实体旧结论', chainC.op === 'supersede' && wsChain.memories.find(m => m.id === 'm_chain_b').status === 'superseded' && wsChain.memories.find(m => m.id === 'm_chain_a').status === 'active', JSON.stringify(wsChain.memories.map(m => [m.id, m.status])));

// ── 3. 超限时不硬删决策 ──
const wsTrim = { memories: [] };
for (let i = 0; i < 5; i++) {
  wsTrim.memories.push({ id: 'd' + i, type: 'decision', text: '决策 ' + i + ' 独立内容 ' + i, keys: ['决策', 'd' + i], importance: 4, turn: i, at: now + i, status: 'active', tier: 'durable', scope: 'workspace' });
}
consolidate(wsTrim, { ...base, id: 'm_extra', text: '库存 99 台', turn: 9, at: now + 9 }, { memoryKeep: 2 });
ok('trim 后决策仍保留在列表', wsTrim.memories.filter(m => m.type === 'decision').length === 5, String(wsTrim.memories.filter(m => m.type === 'decision').length));
ok('trim 只把超限决策标 archived', wsTrim.memories.some(m => m.type === 'decision' && m.status === 'archived'));
const wsMemA = { id: 'ws_a', memories: [] };
const wsMemB = { id: 'ws_b', memories: [] };
const shared = { type: 'fact', text: '同一句事实在不同区出现', keys: ['事实'], turn: 7, at: now, status: 'active', tier: 'durable', scope: 'workspace' };
const mA = consolidate(wsMemA, { ...shared }).memory;
const mB = consolidate(wsMemB, { ...shared }).memory;
ok('不同工作区同文记忆 id 不冲突', mA.id !== mB.id, JSON.stringify([mA.id, mB.id]));

// ── 4. 全局档案没有容器时跳过，不写进工作区 ──
const wsGlobal = { memories: [] };
const ops = rememberText(wsGlobal, '以后都记住：我的偏好是回答先给结论', { role: 'user', turn: 1, now, profile: null });
ok('无全局容器时跳过 global 记忆', ops.some(o => o.op === 'skipped' && o.reason === 'no-profile') && (wsGlobal.memories ?? []).length === 0);

// 全局档案默认置顶不淘汰；取消置顶后受 profileKeep 软上限约束。
const profileCap = [
  { id: 'p_cap1', text: '我的名字是左源', type: 'fact', tier: 'profile', scope: 'global', status: 'active', pinned: false, turn: 1, at: now - 3, updatedAt: now - 3, keys: ['名字'] },
  { id: 'p_cap2', text: '我的邮箱是 zuoyuan@example.com', type: 'fact', tier: 'profile', scope: 'global', status: 'active', pinned: false, turn: 2, at: now - 2, updatedAt: now - 2, keys: ['邮箱'] },
  { id: 'p_cap3', text: '回答先给结论', type: 'fact', tier: 'profile', scope: 'global', status: 'active', pinned: false, turn: 3, at: now - 1, updatedAt: now - 1, keys: ['结论'] },
];
rememberText({ memories: [] }, '记住：我的工位在 18 楼', { role: 'user', turn: 4, now, profile: profileCap, cfg: { profileKeep: 2 } });
ok(
  'profileKeep 只归档未置顶档案',
  profileCap.filter(m => m.status === 'active' && m.pinned !== true).length === 2
    && profileCap.some(m => m.status === 'archived' && m.archiveReason === 'profile-cap'),
  JSON.stringify(profileCap.map(m => [m.id, m.status])),
);

// ── 5. superseded 不能置顶/恢复 ──
const superseded = { id: 'm_sup', status: 'superseded', pinned: false, tier: 'durable', type: 'fact' };
ok('superseded 置顶返回 null', pinMemory([superseded], 'm_sup', true, now) === null);
ok('superseded 恢复返回 null', restoreMemory([superseded], 'm_sup', now) === null);

// ── 6. 合并去重、轮次偏移、摘要合并 ──
const from = {
  name: '来源', description: '来源范围', summary: '来源摘要', keywords: ['来源'], rounds: 2, hits: 1,
  turns: [{ role: 'user', text: '第一条', turn: 1 }, { role: 'assistant', text: '回答一', turn: 2 }],
  memories: [{ id: 'm_dup', text: '重复记忆', keys: ['重复'], type: 'fact', turn: 1, status: 'active' }],
  exemplars: [{ text: '来源例子' }],
};
const into = {
  name: '目标', description: '', summary: '目标摘要', keywords: ['目标'], rounds: 3, hits: 2,
  turns: [{ role: 'user', text: '第一条', turn: 4 }],
  memories: [{ id: 'm_dup', text: '重复记忆', keys: ['重复'], type: 'fact', turn: 4, status: 'active' }],
  exemplars: [{ text: '来源例子' }],
};
mergeWorkspace(from, into);
ok('合并后轮次接续', into.rounds === 5, String(into.rounds));
ok('合并后来源轮次偏移', into.turns.some(t => t.text === '回答一' && t.turn === 6), JSON.stringify(into.turns.map(t => [t.text, t.turn])));
ok('合并按 id/文本去重', into.memories.length === 1 && into.turns.filter(t => t.text === '第一条').length === 1, String(into.memories.length));
ok('合并摘要和描述', into.summary.includes('目标摘要') && into.summary.includes('来源摘要') && into.description.includes('来源范围'), into.summary);

// ── 7. 多话题卡片完整且按 wsId 对齐 ──
const wsA = { id: 'wsA', name: 'A 区', description: '', keywords: ['A'], summary: '', turns: [], memories: [], rounds: 0 };
const wsB = { id: 'wsB', name: 'B 区', description: '', keywords: ['B'], summary: '', turns: [], memories: [], rounds: 0 };
for (let i = 0; i < 30; i++) {
  const text = i % 2 ? 'A 区很长的历史 ' + i : 'B 区很长的历史 ' + i;
  (i % 2 ? wsA : wsB).turns.push({ role: 'user', text, turn: i, at: now + i });
}
const multi = buildMultiContext([wsA, wsB], [
  { wsId: 'wsB', text: 'B 区的问题' },
  { wsId: 'wsA', text: 'A 区的问题' },
], { multiContextMaxChars: 1600, recentTurns: 4 }, now);
ok('多话题保留第一张卡', multi.includes('### 工作区 1/2') && multi.includes('A 区'), multi.slice(0, 80));
ok('多话题保留最后一张卡', multi.includes('### 工作区 2/2') && multi.includes('B 区'), multi.slice(-120));
ok('多话题总预算受控', multi.length <= 1600, String(multi.length));

// ── 8. 插件 API：archive/delete 解绑多话题、重复来源、superseded 错误、index.html ──
process.env.DSH_HOME = tempHome();
const { apply } = await import('../lib/index.js');
const ctx = makeCtx({ webServer: true });
const inst = apply(ctx, { debug: false, llmJudge: false, sweepIntervalMs: 0 });
await inst.snapshot();
const state = inst.state;
const t0 = Date.now();
const mk = (id, name) => ({ id, name, description: '', keywords: [], summary: '', turns: [], memories: [], exemplars: [], rounds: 0, hits: 0, createdAt: t0, updatedAt: t0 });
state.workspaces.push(mk('ws_a', 'A'), mk('ws_b', 'B'), mk('ws_src', '来源区'), mk('ws_tgt', '目标区'));
state.workspaces.find(w => w.id === 'ws_src').turns = [
  { role: 'user', text: '收银机断线先查 net.log', turn: 1, at: t0 - 2000 },
  { role: 'assistant', text: '结论：断线是 4G 心跳超时', turn: 1, at: t0 - 1000 },
];
state.workspaces.find(w => w.id === 'ws_src').rounds = 1;
state.workspaces.find(w => w.id === 'ws_b').memories = [
  { id: 'm_sup_api', type: 'fact', text: '旧结论', keys: ['旧'], status: 'superseded', tier: 'durable', scope: 'workspace', turn: 1, at: t0 },
];
state.sessions.s1 = {
  workspaceId: 'ws_a', routedAt: t0, pending: null, lastQuery: 'A 和 B', lastTurn: 1,
  activeWorkspaceIds: ['ws_a', 'ws_b'], lastSegments: [
    { index: 0, wsId: 'ws_a', name: 'A', text: 'A 问题' },
    { index: 1, wsId: 'ws_b', name: 'B', text: 'B 问题' },
  ], multiQuery: 'A 和 B', recent: [{ wsId: 'ws_a', at: t0 }, { wsId: 'ws_b', at: t0 }],
};
await inst.flush();

const route = ctx.routes[0];
const server = createServer((req, res) => route.handler(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const apiBase = 'http://127.0.0.1:' + server.address().port + '/hybrid-workspace';
async function post (body) {
  const r = await fetch(apiBase + '/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
try {
  const page = await fetch(apiBase + '/index.html');
  ok('index.html 面板可访问', page.status === 200 && (await page.text()).includes('混合工作区'), String(page.status));
  ok('面板 API 基址兼容 index.html', readFileSync(new URL('../lib/ui.js', import.meta.url), 'utf8').includes("replace(/\\/index\\.html$/i, '')"));

  const dup = await post({ op: 'migrate', sourceIds: ['ws_src', '来源区'], into: 'ws_tgt', query: '断线', mode: 'match', dryRun: true });
  ok('迁移重复来源只 plan 一次', dup.status === 200 && dup.json.plans?.length === 1, JSON.stringify(dup.json.plans?.map(p => p.source?.id)));

  const badRestore = await post({ op: 'restoreMemory', id: 'm_sup_api' });
  ok('superseded 恢复被拒绝', badRestore.status === 400 && String(badRestore.json.error).includes('替代'), String(badRestore.status));

  const archived = await post({ op: 'archive', id: 'ws_a' });
  await sleep(50);
  const sid = inst.state.sessions.s1;
  ok('归档主区后解绑', archived.status === 200 && sid.workspaceId === 'ws_b', sid.workspaceId);
  ok('归档后清多话题分段', sid.activeWorkspaceIds.length === 1 && sid.lastSegments.length === 0 && sid.multiQuery === '', JSON.stringify({ active: sid.activeWorkspaceIds, seg: sid.lastSegments.length }));

  const del = await post({ op: 'delete', id: 'ws_b' });
  await sleep(50);
  ok('删除剩余活跃区后清主区', del.status === 200 && inst.state.sessions.s1.workspaceId === null && inst.state.sessions.s1.activeWorkspaceIds.length === 0, JSON.stringify(inst.state.sessions.s1));
} finally {
  server.close();
}

console.log(fails ? '\nREVIEW FAIL ' + fails : '\nREVIEW PASS');
process.exit(fails ? 1 : 0);
