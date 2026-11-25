import { rmSync } from 'node:fs';
import { agent, fireAssistant, firePre, headOf, idOf, makeCtx, sleep, stateOf, tempHome } from './fake-ctx.mjs';

const HOME = tempHome();
process.env.DSH_HOME = HOME;
const mod = await import('../lib/index.js');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? '  [' + detail + ']' : ''));
};

const ctx = makeCtx();
const plugin = mod.apply(ctx, { debug: false, disableProcessHook: true });
const a = agent('session-A');
const b = agent('session-B');

const s1 = await firePre(ctx, a, '示范门店那台收银机昨晚又掉线了，帮我看看日志', 1);
await fireAssistant(ctx, a, '结论：示范门店收银机掉线是 4G 链路心跳超时导致的，先看 net.log 的 reconnect 记录，再确认 session 表。');
const s2 = await firePre(ctx, a, '会员积分接口要不要重写成异步的，顺便把超时时间调一下', 2);
await fireAssistant(ctx, a, '结论：会员积分接口改为异步队列，扣减先落消息表，消费端按单据号幂等。');
const s3 = await firePre(ctx, a, '会员积分接口扣减要不要改成异步队列', 3);
const s4 = await firePre(ctx, a, '示范门店收银机还是掉线', 4);
const s5 = await firePre(ctx, a, '好的', 5);
const s6 = await firePre(ctx, b, '供应商对账金额差了两毛三分钱', 1);
await fireAssistant(ctx, b, '结论：供应商对账差两毛三分是四舍五入口径不一致，按单据号逐条核对，确认后统一改为分单位计算。');
const s7 = await firePre(ctx, b, '示范门店收银机掉线后 net.log 里的 reconnect 记录对不上', 2);
const s8 = await firePre(ctx, a, '会员积分接口扣减改成异步队列后，结算顺序怎么保证', 6);

await sleep(500);
await plugin.flush();

const st = stateOf(HOME);
const names = st.workspaces.map(w => w.name);
console.log('  workspaces: ' + names.join(' | '));
const memberWs = st.workspaces.find(w => (w.turns ?? []).some(t => t.text.startsWith('会员积分接口扣减改成异步队列后')));
check('首条消息建区', !!idOf(s1), headOf(s1));
check('新话题首条先挂起', idOf(s2) === idOf(s1), headOf(s2));
check('第二条同主题另开区', !!idOf(s3) && idOf(s3) !== idOf(s1), headOf(s3));
check('暂存首条迁到新区', !!memberWs && (memberWs.turns ?? []).some(t => t.text.startsWith('会员积分接口要不要重写成异步的')), memberWs?.id);
check('同话题续用', memberWs?.id === idOf(s3), headOf(s3));
check('跨会话词面命中回原区', idOf(s7) === idOf(s1), headOf(s7));
check('短句粘住', idOf(s5) === idOf(s4), headOf(s5));
check('第二会话建新区', !!idOf(s6) && idOf(s6) !== idOf(s1) && idOf(s6) !== idOf(s3), headOf(s6));
check('回到会员区', idOf(s8) === memberWs?.id, headOf(s8));
check('三个工作区', st.workspaces.length === 3, String(st.workspaces.length));
check('注入块含回答规则', s1.includes('回答规则') && s1.includes('search_context'), headOf(s1));
check('注入块只含当前区', s1.includes('示范门店') && !s1.includes('会员积分接口扣减'), '');
check('用户消息回写 turn', (st.workspaces.find(w => w.id === idOf(s1))?.turns ?? []).some(t => t.role === 'user'), '');
check('助手消息回写 turn', (st.workspaces.find(w => w.id === idOf(s1))?.turns ?? []).some(t => t.role === 'assistant'), '');
check('决策进入记忆', (st.workspaces.find(w => w.id === idOf(s1))?.memories ?? []).some(m => m.type === 'decision' && m.text.includes('4G')), '');
check('问题进入记忆', (memberWs?.memories ?? []).some(m => m.type === 'question'), '');
check('llm 未调用（规则足够）', (st.llmCalls ?? 0) === 0, String(st.llmCalls));
check('trace 已记录', (st.workspaces.length >= 3), '');
check('会话绑定已落盘', Object.values(st.sessions).filter(s => s.workspaceId).length >= 2, '');

console.log(failures === 0 ? '\nCORE PASS' : '\n' + failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);
