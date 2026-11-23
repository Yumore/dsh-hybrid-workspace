import assert from 'node:assert/strict';
import { agent, firePre, makeCtx, sleep, stateOf, tempHome } from './fake-ctx.mjs';

const HOME = tempHome();
process.env.DSH_HOME = HOME;
const mod = await import('../lib/index.js');

const ctx = makeCtx({ webServer: false });
const inst = mod.apply(ctx, { debug: false, disableProcessHook: true });
const a = agent('filter-session');
const pre = ctx.handlers['agent/pre-step'][0];

const msg = (text, source) => ({ role: 'user', source, content: [{ type: 'text', text }] });
const inject = async (text, source, turn) => {
  await pre({ agent: a, messages: [msg(text, source)], turn, step: 1 }, async () => 'next');
};

await inject('[Plugin context from "batching-guidance"; not a user instruction or authorization.]\nPut independent operations in one program.', { kind: 'plugin', name: 'batching-guidance' }, 1);
await inject('[Plugin context from "batching-guidance"; not a user instruction or authorization.]\nSecond copy.', { kind: 'user', name: 'batching-guidance' }, 2);
await inject('plugin context without prefix', { kind: 'plugin', name: 'dsh-ops:step-tail' }, 3);
await sleep(100);
await inst.flush();

let st = stateOf(HOME);
assert.equal(st.workspaces.length, 0, '注入消息不应建区');
assert.equal((st.sessions['filter-session']?.workspaceId ?? null), null);
assert.equal(ctx.sections[0].text({ agent: a }), '');

const real = await firePre(ctx, a, '示范门店收银机掉线了，帮我查 net.log 的 reconnect 记录', 4);
assert(real.includes('示范门店'));
await sleep(100);
await inst.flush();
st = stateOf(HOME);
assert.equal(st.workspaces.length, 1, '真实用户消息应建区');
assert.equal(st.sessions['filter-session'].workspaceId, st.workspaces[0].id);

await inject('[Plugin context from "batching-guidance"; not a user instruction or authorization.]\nShould be ignored.', { kind: 'user' }, 5);
await sleep(80);
await inst.flush();
st = stateOf(HOME);
assert.equal(st.workspaces.length, 1);
assert.equal(st.workspaces[0].rounds, 1, '注入消息不应增加轮数');
assert.equal(st.workspaces[0].turns.filter(t => t.role === 'user').length, 1);

const handler = ctx.handlers['session/event'][0];
await handler({ id: 'filter-session' }, { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '[Plugin context from "batching-guidance"; x]' }] } } });
await handler({ id: 'filter-session' }, { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '结论：收银机掉线是 4G 心跳超时，先看 net.log。' }] } } });
await sleep(100);
await inst.flush();
st = stateOf(HOME);
assert.equal(st.workspaces[0].turns.filter(t => t.role === 'assistant').length, 1);
assert(st.workspaces[0].memories.some(m => m.text.includes('4G')));

// 推理块不能当助手正文落库，否则会进上下文并出现在面板。
await handler({ id: 'filter-session' }, { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'reasoning', text: 'SECRET_REASONING_ONLY' }] } } });
await handler({ id: 'filter-session' }, { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'reasoning', text: 'SECRET_REASONING_WITH_TEXT' }, { type: 'text', text: '可见结论' }] } } });
await sleep(100);
await inst.flush();
st = stateOf(HOME);
const wsAfter = st.workspaces[0];
assert.equal(wsAfter.turns.filter(t => t.role === 'assistant').length, 2, '只应保留一条可见助手回答');
assert(wsAfter.turns.some(t => t.role === 'assistant' && t.text.includes('可见结论')));
assert(!wsAfter.turns.some(t => String(t.text).includes('SECRET_REASONING')), '推理块不能写入 turns');
assert(!(wsAfter.memories ?? []).some(m => String(m.text).includes('SECRET_REASONING')), '推理块不能写入 memories');

console.log('FILTER PASS');
