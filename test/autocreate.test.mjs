import { makeCtx, tempHome, agent, firePre, sleep, idOf } from './fake-ctx.mjs';
import { apply } from '../lib/index.js';
import { createWorkspace } from '../lib/router.js';

process.env.DSH_HOME = tempHome();

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
};

const ctx = makeCtx({ webServer: false });
const inst = apply(ctx, { autoCreate: false, debug: false });
const a = agent('s-auto');

// 没有当前区、又不允许自动建区：不应崩溃，也不应产生空工作区。
const empty = await firePre(ctx, a, '万象城那台收银机昨晚又掉线了，帮我看下 4G 链路', 1);
await sleep(30);
ok('autoCreate=false 且无区时不建区', inst.state.workspaces.length === 0, String(inst.state.workspaces.length));
ok('autoCreate=false 且无区时注入为空', empty === '');

// 有当前区时，新话题不能把消息丢掉；应留在当前区并照常记账。
await inst.snapshot();
const ws = createWorkspace('万象城收银机掉线排查，先看 net.log 的 reconnect 记录', { nameMaxChars: 18 });
inst.state.workspaces.push(ws);
inst.state.sessions['s-auto'] = { workspaceId: ws.id, routedAt: Date.now(), pending: null, lastQuery: '', lastTurn: 0, recent: [] };
await inst.flush();

const section = await firePre(ctx, a, '会员积分接口的扣减逻辑要不要改成异步队列，担心同步写会拖慢结算', 2);
await sleep(30);
ok('有当前区时留在原区', inst.state.sessions['s-auto'].workspaceId === ws.id, inst.state.sessions['s-auto'].workspaceId);
ok('用户消息仍记账', ws.rounds === 1 && ws.turns.length === 1, 'rounds=' + ws.rounds + ' turns=' + ws.turns.length);
ok('注入块仍指向当前区', idOf(section) === ws.id, idOf(section));
ok('仍只有一个工作区', inst.state.workspaces.length === 1, String(inst.state.workspaces.length));

await inst.flush();
console.log(fails ? 'AUTOCREATE FAIL ' + fails : 'AUTOCREATE PASS');
process.exit(fails ? 1 : 0);
