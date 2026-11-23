import assert from 'node:assert/strict';
import { agent, fireAssistant, firePre, headOf, idOf, makeCtx, sleep, stateOf, tempHome } from './fake-ctx.mjs';

const HOME = tempHome();
process.env.DSH_HOME = HOME;
const mod = await import('../lib/index.js');

const ctx = makeCtx({ webServer: false });
const inst = mod.apply(ctx, { debug: false, disableProcessHook: true, llmJudge: false, shortSticky: 200 });
const a = agent('multi-session');
const text = '示范门店收银机昨晚又掉线了，帮我查 net.log 的 reconnect 记录。\n\n会员积分接口扣减要不要改成异步队列？\n\n供应商对账差了两毛三分，按单据号核对口径。';

const section = await firePre(ctx, a, text, 1);
await sleep(120);
await inst.flush();
let st = stateOf(HOME);

assert.equal(st.workspaces.length, 3, '三个话题应建三个区');
assert.equal(st.multiTurns, 1);
assert(section.includes('本条消息涉及 3 个工作区'));
assert(section.includes('### 工作区 1/3'));
assert(section.includes('### 工作区 3/3'));
assert(section.includes('多话题回答规则'));

const sess = st.sessions['multi-session'];
assert.equal(sess.activeWorkspaceIds.length, 3);
assert.equal(sess.lastSegments.length, 3);
assert.equal(new Set(sess.lastSegments.map(x => x.wsId)).size, 3);
for (const ws of st.workspaces) {
  assert.equal(ws.rounds, 1, ws.name);
  assert.equal(ws.turns.filter(t => t.role === 'user').length, 1, ws.name);
}

await fireAssistant(ctx, a, '1. 收银机掉线先看 net.log 的 reconnect。\n2. 会员积分扣减建议改异步队列。\n3. 供应商对账按单据号逐条核对。');
await sleep(120);
await inst.flush();
st = stateOf(HOME);
for (const ws of st.workspaces) {
  const replies = ws.turns.filter(t => t.role === 'assistant');
  assert.equal(replies.length, 1, ws.name);
}
assert(
  st.workspaces.every(ws => !ws.turns.some(t => t.role === 'assistant' && t.text.includes('收银机掉线') && t.text.includes('供应商对账'))),
  '编号回答应拆分到各区，不能整段复制',
);

// 没有编号时只写主区，不把整段回答复制到其他区。
await fireAssistant(ctx, a, '没有编号的整段回答，只应落到主区。');
await sleep(120);
await inst.flush();
st = stateOf(HOME);
const primary = st.sessions['multi-session'].workspaceId;
const secondary = st.workspaces.filter(w => w.id !== primary);
assert.equal(st.workspaces.find(w => w.id === primary).turns.filter(t => t.role === 'assistant').length, 2, '主区应收到整段回答');
for (const ws of secondary) {
  assert(!ws.turns.some(t => t.role === 'assistant' && t.text.includes('没有编号的整段回答')), '非主区不应收到整段回答');
}

const second = st.workspaces.find(w => w.turns.some(t => t.role === 'user' && t.text.includes('会员积分')));
assert(second);
const follow = await firePre(ctx, a, '第二个呢？', 2);
await sleep(100);
await inst.flush();
st = stateOf(HOME);
assert.equal(idOf(follow), second.id, '“第二个”应回到第二段的工作区');
assert(headOf(follow).includes('会员积分'));
assert.equal(st.sessions['multi-session'].workspaceId, second.id);
assert.equal(st.sessions['multi-session'].activeWorkspaceIds.length, 1);
assert.equal(st.sessions['multi-session'].multiQuery, '');
assert.equal(st.workspaces.find(w => w.id === second.id).rounds, 2);

// 当前区已被旧三话题文本污染时，多话题仍应拆到 3 个不同工作区。
const a2 = agent('contam-session');
await firePre(ctx, a2, '项目 A 的预算和排期。', 3);
await sleep(120);
await inst.flush();
let mid = stateOf(HOME);
const contaminatedId = mid.sessions['contam-session'].workspaceId;
await firePre(ctx, a2, '今天天气怎么样，我最近要去检查身体做胃镜，餐饮项目的分析报告发我下。', 4);
await sleep(120);
await inst.flush();
await firePre(ctx, a2, '1、今天天气怎么样 2、我最近要去检查身体，做胃镜，查甲减等等。 3、餐饮项目的分析报告发我下', 5);
await sleep(150);
await inst.flush();
st = stateOf(HOME);
const cs = st.sessions['contam-session'];
assert.equal(st.multiTurns, 2, '污染后的三话题仍应计为多话题轮');
assert.equal(cs.activeWorkspaceIds.length, 3);
assert.equal(cs.lastSegments.length, 3);
assert.equal(new Set(cs.lastSegments.map(x => x.wsId)).size, 3, '三段应落到三个不同工作区');
for (const [i, needle] of [[0, '天气'], [1, '胃镜'], [2, '餐饮']]) {
  const ws = st.workspaces.find(w => w.id === cs.lastSegments[i].wsId);
  assert(ws, '第 ' + (i + 1) + ' 段应有工作区');
  assert.notEqual(ws.id, contaminatedId, '不应把被污染区当作新话题归属');
  assert(ws.turns.some(t => t.role === 'user' && t.text.includes(needle)), '第 ' + (i + 1) + ' 段文本应进入对应区');
}

console.log('MULTI PASS');
