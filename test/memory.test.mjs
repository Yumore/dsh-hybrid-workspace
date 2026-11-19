import { classifyType, extractMemories, rememberText, retrieve, compactTurns, stats } from '../lib/memory.js';
import { createWorkspace } from '../lib/router.js';

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
};

ok('用户问句判为 question', classifyType('会员积分接口扣减要不要改成异步队列', 'user') === 'question');
ok('助手结论判为 decision', classifyType('结论：会员积分接口改成异步队列', 'assistant') === 'decision');

const extracted = extractMemories('排查结论：万象城收银机断线是 4G 链路心跳超时导致。下一步需要把 net.log 的 reconnect 间隔改成 30 秒。', { role: 'assistant', turn: 4, max: 3 });
ok('抽取助手结论与待办', extracted.length >= 2, String(extracted.length));
ok('至少一条 decision', extracted.some(m => m.type === 'decision'), extracted.map(m => m.type).join(','));
ok('结论保留 4G 实体', extracted.some(m => m.text.includes('4G')));
ok('寒暄不记', extractMemories('好的，收到', { role: 'user' }).length === 0);

const ws = createWorkspace('会员积分接口扣减改成异步队列');
const first = extractMemories('结论：会员积分接口扣减改成异步队列，结算顺序按创建时间排。', { role: 'assistant', turn: 1 })[0];
const op1 = rememberText(ws, '结论：会员积分接口扣减改成异步队列，结算顺序按创建时间排。', { role: 'assistant', turn: 1 });
ok('首次写入 add', op1[0]?.op === 'add' && ws.memories.length === 1, op1.map(o => o.op).join(','));
ok('决策计数', stats(ws).decision >= 1, JSON.stringify(stats(ws)));

const dup = rememberText(ws, '结论：会员积分接口扣减改成异步队列，结算顺序按创建时间排。', { role: 'assistant', turn: 2 });
ok('近重复不新增', dup[0]?.op === 'noop' && ws.memories.length === 1, dup.map(o => o.op).join(','));

const newText = '会员积分接口的扣减逻辑已经确认改成异步队列并上线，结算顺序按创建时间排。';
const sup = rememberText(ws, newText, { role: 'assistant', turn: 3 });
ok('新结论取代旧结论', sup.some(o => o.op === 'supersede'), sup.map(o => o.op).join(','));
ok('旧记忆标记 superseded', ws.memories.some(m => m.status === 'superseded'));
ok('stats 记录 superseded', stats(ws).superseded >= 1, JSON.stringify(stats(ws)));

const ws2 = createWorkspace('万象城收银机断线');
rememberText(ws2, '结论：万象城收银机断线是 4G 链路心跳超时导致，要查 net.log 的 reconnect 记录。', { role: 'assistant', turn: 1 });
rememberText(ws2, '会员积分接口改成异步队列，结算顺序按创建时间排。', { role: 'assistant', turn: 2 });
rememberText(ws2, '供应商对账金额差了两毛三分钱，按单据号逐条核。', { role: 'assistant', turn: 3 });
const got = retrieve(ws2, '万象城收银机断线怎么排查', { k: 2, now: Date.now(), turnsBack: 20 });
ok('检索命中相关记忆', got.memories.some(m => m.text.includes('万象城')), got.memories.map(m => m.text.slice(0, 12)).join('|'));
ok('检索返回总数', got.total >= 3, String(got.total));

const ws3 = createWorkspace('待办测试');
rememberText(ws3, '下一步需要验证会员积分接口的异步队列顺序。', { role: 'user', turn: 1 });
const open = retrieve(ws3, '完全无关的查询词', { k: 0, turnsBack: 10 });
ok('未决事项单独列出', open.openItems.length >= 1, JSON.stringify(open.openItems.map(m => m.type)));

const ws4 = createWorkspace('压缩测试');
for (let i = 1; i <= 30; i++) {
  ws4.rounds = i;
  ws4.turns.push({ role: i % 2 ? 'user' : 'assistant', text: '第 ' + i + ' 轮：万象城收银机断线，net.log 里 reconnect 每隔几分钟变一次，结论是 4G 心跳超时。', round: i });
}
const ep = compactTurns(ws4, { compactAt: 24, keepTurns: 12 });
ok('超阈值压缩出 episode', !!ep && ep.type === 'episode');
ok('只保留最近 12 轮', ws4.turns.length === 12, String(ws4.turns.length));
ok('episode 进入记忆', ws4.memories.some(m => m.type === 'episode'));

const ws5 = createWorkspace('容量测试');
const topics = ['打印机', '电子秤', '微信支付', '会员储值', '库存盘点', '交接班', '优惠券', '发票', '门店', '配送'];
for (let i = 0; i < topics.length; i++) {
  rememberText(ws5, '结论：' + topics[i] + '相关问题已定位为配置错误，需要修复并验证。', { role: 'assistant', turn: i + 1, cfg: { memoryKeep: 4 } });
}
const activeCount = ws5.memories.filter(m => m.status !== 'superseded').length;
ok('memoryKeep 生效', activeCount <= 4, String(activeCount));

console.log(fails ? 'MEMORY FAIL ' + fails : 'MEMORY PASS');
process.exit(fails ? 1 : 0);
