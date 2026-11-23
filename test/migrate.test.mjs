import { createServer } from 'node:http';
import { tempHome, makeCtx } from './fake-ctx.mjs';
import { planMigration, applyPlan } from '../lib/migrate.js';

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 纯函数：关键词命中 + 同轮助手回答 + 轮次重编号 ──
const now = Date.now();
const source = {
  id: 'ws_src', name: '收银机与积分杂项', keywords: ['收银机', '积分'], summary: '旧摘要',
  turns: [
    { role: 'user', text: '示范门店收银机断线，先查 net.log', turn: 1, at: now - 5000 },
    { role: 'assistant', text: '结论：断线是 4G 心跳超时，reconnect 改 30 秒', turn: 1, at: now - 4000 },
    { role: 'user', text: '会员积分接口改成异步写入', turn: 2, at: now - 3000 },
    { role: 'assistant', text: '结论：积分接口异步写入，结算先落队列', turn: 2, at: now - 2000 },
  ],
  memories: [
    { id: 'm_disc', text: '收银机断线根因是 4G 心跳超时', keys: ['断线', '4G'], type: 'decision', turn: 1, status: 'active' },
    { id: 'm_int', text: '积分接口改为异步写入', keys: ['积分', '异步'], type: 'decision', turn: 2, status: 'active' },
  ],
  exemplars: [{ text: '收银机断线', at: now }],
  rounds: 2,
};
const plan = planMigration(source, { query: '断线', mode: 'match' });
ok('关键词命中 2 条对话（含同轮回答）', plan.turns.length === 2, String(plan.turns.length));
ok('关键词命中 1 条记忆', plan.memories.length === 1, String(plan.memories.length));
ok('未命中内容留在来源', plan.remainingTurns === 2 && plan.remainingMemories === 1, plan.remainingTurns + '/' + plan.remainingMemories);
ok('预览包含命中样本', plan.sample.length > 0 && plan.scores.length > 0);

const target = { id: 'ws_tgt', name: '收银机专项', turns: [], memories: [], exemplars: [], rounds: 5, keywords: [] };
const moved = applyPlan(source, target, plan, { now });
ok('实际搬走 2 条对话', moved.turns === 2, String(moved.turns));
ok('实际搬走 1 条记忆', moved.memories === 1, String(moved.memories));
ok('目标轮次接续为 6', target.rounds === 6 && target.turns[0].turn === 6, target.rounds + '/' + target.turns[0].turn);
ok('目标记忆轮次同步重编号', target.memories[0].turn === 6, String(target.memories[0].turn));
ok('来源保留未命中对话与记忆', source.turns.length === 2 && source.memories.length === 1, source.turns.length + '/' + source.memories.length);
ok('来源轮次扣减', source.rounds === 1, String(source.rounds));
ok('目标合并关键词', target.keywords.includes('收银机') && target.keywords.includes('积分'));

// ── 纯函数：低分候选默认不搬，勾选 include 后可补选 ──
const nearSource = {
  id: 'ws_near', name: '积分杂项', keywords: ['积分'], summary: '',
  turns: [
    { role: 'user', text: '积分接口改异步', turn: 1, at: now - 3000 },
    { role: 'user', text: '会员积分按门店汇总', turn: 2, at: now - 2000 },
  ],
  memories: [
    { id: 'm_near', text: '会员积分按门店汇总', keys: ['积分', '门店'], type: 'fact', turn: 2, status: 'active' },
  ],
  exemplars: [], rounds: 2,
};
const nearPlan = planMigration(nearSource, { query: '积分 队列', mode: 'match', minScore: 0.5 });
ok('低分候选进入 nearItems', nearPlan.turns.length === 0 && nearPlan.nearItems.length >= 3, nearPlan.nearItems.length + '/' + nearPlan.turns.length);
ok('低分候选带 key 和分数', nearPlan.nearItems.every(x => x.key && x.score > 0 && x.score < 0.5));
const pickKey = nearPlan.nearItems[0].key;
const incPlan = planMigration(nearSource, { query: '积分 队列', mode: 'match', minScore: 0.5, include: [pickKey] });
ok('include 可把低分候选补进迁移', incPlan.items.some(x => x.key === pickKey) && incPlan.items.length === 1, String(incPlan.items.length));
ok('补选后 nearItems 去重', incPlan.nearItems.every(x => x.key !== pickKey) && incPlan.nearItems.length === nearPlan.nearItems.length - 1, incPlan.nearItems.length + '/' + nearPlan.nearItems.length);

// ── 插件 API：dry-run、部分迁移、搬空归档、会话重绑 ──
process.env.DSH_HOME = tempHome();
const { apply } = await import('../lib/index.js');
const ctx = makeCtx({ webServer: true });
const inst = apply(ctx, { debug: false, llmJudge: false, sweepIntervalMs: 0 });
await inst.snapshot();

const state = inst.state;
const t0 = Date.now();
state.workspaces.push({
  id: 'ws_src2', name: '收银机与积分杂项', description: '两种话题混在一起', keywords: ['收银机', '积分'], summary: '',
  turns: [
    { role: 'user', text: '示范门店收银机断线，先查 net.log', turn: 1, at: t0 - 5000 },
    { role: 'assistant', text: '结论：断线是 4G 心跳超时，reconnect 改 30 秒', turn: 1, at: t0 - 4000 },
    { role: 'user', text: '会员积分接口改成异步写入', turn: 2, at: t0 - 3000 },
    { role: 'assistant', text: '结论：积分接口异步写入，结算先落队列', turn: 2, at: t0 - 2000 },
  ],
  memories: [
    { id: 'm_disc2', text: '收银机断线根因是 4G 心跳超时', keys: ['断线', '4G'], type: 'decision', turn: 1, status: 'active', tier: 'durable', scope: 'workspace' },
    { id: 'm_int2', text: '积分接口改为异步写入', keys: ['积分', '异步'], type: 'decision', turn: 2, status: 'active', tier: 'durable', scope: 'workspace' },
  ],
  exemplars: [{ text: '收银机断线', at: t0 }], rounds: 2, hits: 3, createdAt: t0, updatedAt: t0,
});
state.workspaces.push({
  id: 'ws_tgt2', name: '收银机断线专项', description: '只放收银机链路问题', keywords: ['收银机'], summary: '',
  turns: [], memories: [], exemplars: [], rounds: 0, hits: 0, createdAt: t0, updatedAt: t0,
});
state.sessions.s1 = {
  workspaceId: 'ws_src2', routedAt: t0, pending: null, lastQuery: '收银机断线', lastTurn: 2,
  activeWorkspaceIds: ['ws_src2'], lastSegments: [{ index: 0, wsId: 'ws_src2', name: '收银机与积分杂项', text: '收银机断线' }],
  multiQuery: '', recent: [],
};
await inst.flush();

const route = ctx.routes[0];
const server = createServer((req, res) => route.handler(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port + '/hybrid-workspace';
async function post (body) {
  const r = await fetch(base + '/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

try {
  const dry = await post({ op: 'migrate', sourceIds: ['ws_src2'], into: 'ws_tgt2', query: '断线', mode: 'match', dryRun: true });
  ok('dry-run 200', dry.status === 200 && dry.json.ok === true, String(dry.status));
  ok('dry-run 返回 2 对话 / 1 记忆', dry.json.plans?.[0]?.turns === 2 && dry.json.plans?.[0]?.memories === 1, JSON.stringify(dry.json.plans?.[0]?.turns));
  ok('dry-run 返回剩余量', dry.json.plans?.[0]?.remainingTurns === 2 && dry.json.plans?.[0]?.remainingMemories === 1);
  ok('dry-run 不落盘', state.workspaces.find(w => w.id === 'ws_src2').turns.length === 4);

  const part = await post({ op: 'migrate', sourceIds: ['ws_src2'], into: 'ws_tgt2', query: '断线', mode: 'match', dryRun: false, archiveMode: 'auto', rebindSessions: true });
  ok('部分迁移 200', part.status === 200 && part.json.ok === true, JSON.stringify(part.json.error || ''));
  ok('部分迁移 2 对话 / 1 记忆', part.json.moved?.turns === 2 && part.json.moved?.memories === 1, JSON.stringify(part.json.moved));
  ok('来源未搬空所以不归档', (part.json.archived || []).length === 0);
  ok('来源仍保留 2 条对话', state.workspaces.find(w => w.id === 'ws_src2').turns.length === 2);
  ok('目标已有 2 条对话 / 1 条记忆', state.workspaces.find(w => w.id === 'ws_tgt2').turns.length === 2 && state.workspaces.find(w => w.id === 'ws_tgt2').memories.length === 1);
  ok('会话重绑到目标', state.sessions.s1.workspaceId === 'ws_tgt2' && state.sessions.s1.activeWorkspaceIds[0] === 'ws_tgt2');

  const all = await post({ op: 'migrate', sourceIds: ['ws_src2'], into: 'ws_tgt2', mode: 'all', dryRun: false, archiveMode: 'auto', rebindSessions: true });
  ok('全部迁移 200', all.status === 200 && all.json.ok === true, JSON.stringify(all.json.error || ''));
  ok('搬空后归档 1 个来源', (all.json.archived || []).length === 1, String((all.json.archived || []).length));
  const archived = state.archives.find(a => a.id === 'ws_src2');
  ok('迁移归档为元数据', Boolean(archived) && archived.restorable === false && (archived.turns || []).length === 0 && (archived.memories || []).length === 0);
  ok('迁移归档标记目标', archived?.migratedTo?.id === 'ws_tgt2' && archived?.migratedTo?.name === '收银机断线专项');
  ok('来源已移出活跃区', !state.workspaces.some(w => w.id === 'ws_src2'));
  ok('目标累计 4 条对话 / 2 条记忆', state.workspaces.find(w => w.id === 'ws_tgt2').turns.length === 4 && state.workspaces.find(w => w.id === 'ws_tgt2').memories.length === 2);

  const badRestore = await post({ op: 'restore', id: 'ws_src2' });
  ok('迁移归档拒绝恢复', badRestore.status === 400 && /不能原地恢复/.test(badRestore.json.error || ''), badRestore.json.error || '');

  // archiveMode=always：来源还有剩余也强制归档，快照可恢复
  const seed = (id, name, turns) => state.workspaces.push({
    id, name, description: '', keywords: [], summary: '', turns, memories: [], exemplars: [], rounds: 2, hits: 0, createdAt: t0, updatedAt: t0,
  });
  seed('ws_always', '收银机与积分混合', [
    { role: 'user', text: '收银机断线先查 net.log', turn: 1, at: t0 - 4000 },
    { role: 'assistant', text: '结论：4G 心跳超时', turn: 1, at: t0 - 3000 },
    { role: 'user', text: '会员积分接口改异步', turn: 2, at: t0 - 2000 },
    { role: 'assistant', text: '结论：先落队列', turn: 2, at: t0 - 1000 },
  ]);
  seed('ws_always_tgt', '收银机专项二', []);
  const always = await post({ op: 'migrate', sourceIds: ['ws_always'], into: 'ws_always_tgt', query: '断线', mode: 'match', dryRun: false, archiveMode: 'always' });
  ok('always 模式强制归档', always.status === 200 && (always.json.archived || []).length === 1, JSON.stringify(always.json.error || ''));
  const left = state.archives.find(a => a.id === 'ws_always');
  ok('always 归档保留剩余快照', left?.restorable === true && left?.reason === 'migrated-leftover' && (left.turns || []).length === 2, JSON.stringify({ restorable: left?.restorable, reason: left?.reason, turns: left?.turns?.length }));
  const restoreLeft = await post({ op: 'restore', id: 'ws_always' });
  ok('always 归档可恢复', restoreLeft.status === 200 && Boolean(restoreLeft.json.id), JSON.stringify(restoreLeft.json.error || ''));

  // archiveMode=never：搬空也保留空来源，不产生归档
  seed('ws_never', '会员积分专项', [
    { role: 'user', text: '会员积分接口改异步', turn: 1, at: t0 - 1000 },
    { role: 'assistant', text: '结论：先落队列', turn: 1, at: t0 - 500 },
  ]);
  seed('ws_never_tgt', '积分专项二', []);
  const never = await post({ op: 'migrate', sourceIds: ['ws_never'], into: 'ws_never_tgt', mode: 'all', dryRun: false, archiveMode: 'never' });
  const emptySource = state.workspaces.find(w => w.id === 'ws_never');
  ok('never 模式不归档', never.status === 200 && (never.json.archived || []).length === 0 && Boolean(emptySource));
  ok('never 模式保留空来源', emptySource?.turns.length === 0 && emptySource?.memories.length === 0);

  const page = await fetch(base + '/');
  const html = await page.text();
  ok('面板含新建与迁移入口', page.status === 200 && html.includes('新建工作区') && html.includes('迁移选中'));
} finally {
  server.close();
}

await sleep(30);
console.log(fails ? 'MIGRATE FAIL ' + fails : 'MIGRATE PASS');
if (fails) process.exitCode = 1;
