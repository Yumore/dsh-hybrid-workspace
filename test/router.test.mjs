import { decideRoute, createWorkspace, addExemplar, mergeWorkspace } from '../lib/router.js';
import { jaccard, tokens } from '../lib/text.js';

const clusters = [
  ['示范门店四台收银机每天下午四点断线', '示范门店的收银机断线时 net.log 里 reconnect 记录对不上', '示范门店断线后 session 表里 sessionid 每隔几分钟变一次'],
  ['会员积分接口现在同步写，结算老是拖延', '会员积分接口扣减要不要改成异步队列', '会员积分接口重写后结算顺序怎么保证'],
  ['供应商对账金额差了两毛三分钱', '供应商对账的采购单和发票金额对不上怎么核', '供应商对账差异要按单据号逐条查吗'],
  ['示范卡券核销时报券码已使用', '示范卡券的券码状态在后台显示未核销', '示范卡券核销接口返回 500 怎么排查'],
  ['门诊药房处方打印机打不出小票', '门诊药房处方单模板里的医保编号错位', '门诊药房处方结算单打印出来少了一联'],
  ['前台小票打印机缺纸后一直报错', '小票打印机重连后小票模板变成空白', '小票打印机的小票模板里门店名称取错了'],
  ['收银机开机黑屏进不了系统', '收银机开机换了电源适配器还是黑屏', '收银机开机时风扇转但屏幕没信号'],
  ['门店交接班报表金额对不上', '门店交接班时现金和系统差 200', '门店交接班报表要按收银员拆分吗'],
  ['微信支付回调超时导致订单未支付', '微信支付对账单和系统订单差一笔', '微信支付回调重试机制怎么设'],
  ['电子秤称重后条码打出来没价格', '电子秤称重商品的条码规则是什么', '电子秤称重和小票打印机怎么连'],
  ['库存盘点后数量没有同步到前台', '库存盘点的差异要不要生成调整单', '库存盘点同步接口多久跑一次'],
  ['会员储值退款后余额没有回滚', '会员储值退款要不要审批', '会员储值余额和退款单对不上'],
];

function run () {
  const workspaces = [];
  const session = { workspaceId: null, pending: null };
  const byId = (id) => workspaces.find(w => w.id === id);
  const step = (text) => {
    let d = decideRoute({ workspaces, session, text });
    if (d.action === 'ask-llm') d = { action: 'new', how: 'ask-llm-fallback' };
    let ws;
    if (d.action === 'new') {
      ws = createWorkspace(text); workspaces.push(ws); session.workspaceId = ws.id; session.pending = null;
    } else if (d.action === 'route') {
      ws = byId(d.wsId); session.workspaceId = ws.id; session.pending = null; addExemplar(ws, text);
    } else {
      ws = byId(session.workspaceId);
      if (d.pending) session.pending = d.pending; else if (d.how !== 'pending-switch') session.pending = null;
    }
    ws.rounds = (ws.rounds ?? 0) + 1; ws.hits = (ws.hits ?? 0) + 1;
    ws.turns.push({ role: 'user', text, round: ws.rounds });
    return { d, ws };
  };
  const rows = [];
  clusters.forEach((qs, ci) => qs.forEach((q, qi) => rows.push({ ci, qi, q, ...step(q) })));
  return { workspaces, rows };
}

const { workspaces, rows } = run();
let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
};

let correct = 0;
let spreadSum = 0;
const perTopic = [];
clusters.forEach((_, ci) => {
  const rs = rows.filter(r => r.ci === ci);
  const first = rs[0].ws.id;
  const same = rs.filter(r => r.ws.id === first).length;
  const ids = [...new Set(rs.map(r => r.ws.id))];
  correct += same;
  spreadSum += ids.length;
  perTopic.push({ ci, ws: ids.length, same });
});
ok('12 组话题每组 3 条同区', perTopic.every(t => t.same === 3), JSON.stringify(perTopic));

let pairs = 0, sum = 0;
for (const ws of workspaces) {
  const ts = ws.turns.map(t => tokens(t.text));
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) { sum += jaccard(ts[i], ts[j]); pairs++; }
}
const top = Math.max(...workspaces.map(w => w.turns.length));
const cohesion = +(sum / Math.max(1, pairs)).toFixed(3);
const topShare = +(top / rows.length).toFixed(2);
const purity = +(correct / rows.length).toFixed(3);
const spread = +(spreadSum / clusters.length).toFixed(2);
ok('话题纯度 >= 0.95', purity >= 0.95, 'purity ' + purity);
ok('每组平均拆分 <= 1.1', spread <= 1.1, 'spread ' + spread);
ok('最大区占比 <= 0.25', topShare <= 0.25, 'topShare ' + topShare);
ok('工作区数量在 8~14', workspaces.length >= 8 && workspaces.length <= 14, String(workspaces.length));
ok('凝聚度 >= 0.12', cohesion >= 0.12, 'cohesion ' + cohesion);

// 迟滞：单条弱信号只挂起，连续第二条同候选才切换。
{
  const a = createWorkspace('示范门店四台收银机每天下午四点断线');
  const b = createWorkspace('会员积分接口现在同步写，结算老是拖延');
  const c = createWorkspace('供应商对账金额差了两毛三分钱');
  const list = [a, b, c];
  const cfg = { routeAccept: 0.2, routeMargin: 0.05, switchMargin: 0.01, strongSwitch: 0.99, strongMargin: 0.99, shortSticky: 4 };
  const session = { workspaceId: a.id, pending: null };
  const text = '会员积分接口扣减改成异步队列后，结算顺序怎么保证';
  const d1 = decideRoute({ workspaces: list, session, text, cfg });
  ok('单条信号先挂起', d1.action === 'stay' && d1.how === 'pending-switch' && d1.pending?.id === b.id, d1.how + ' ' + JSON.stringify(d1.pending));
  session.pending = d1.pending;
  const d2 = decideRoute({ workspaces: list, session, text, cfg });
  ok('连续两条才切换', d2.action === 'route' && d2.wsId === b.id && d2.how === 'switch-pending', d2.how);
  const dShort = decideRoute({ workspaces: list, session: { workspaceId: a.id, pending: null }, text: '好的' });
  ok('短句粘住当前区', dShort.action === 'stay' && ['sticky-short', 'empty-query'].includes(dShort.how), dShort.how);
  ok('强信号直接切换', ['strong-signal', 'same-topic'].includes(decideRoute({ workspaces: list, session: { workspaceId: a.id, pending: null }, text }).how));
}

// 优先 A/B/C：已有区能匹配时先路由，只有都不匹配才新建 D。
{
  const a2 = createWorkspace('示范门店收银机每天下午断线，需要排查 4G 链路');
  const b2 = createWorkspace('会员积分接口扣减改成异步队列');
  const c2 = createWorkspace('供应商对账金额差两毛三分钱，按单据号核对');
  const list = [a2, b2, c2];
  const run = (text) => decideRoute({ workspaces: list, session: { workspaceId: null, pending: null }, text, cfg: { autoSwitch: true } });
  const hitA = run('门店A的收银机又掉线了');
  const hitB = run('会员积分接口扣款失败');
  const hitC = run('供应商对账差了三毛钱');
  const miss = run('明天上午十点开会');
  ok('有匹配时优先 A/B/C', hitA.action === 'route' && hitA.wsId === a2.id && hitB.action === 'route' && hitB.wsId === b2.id && hitC.action === 'route' && hitC.wsId === c2.id, JSON.stringify([hitA, hitB, hitC].map(d => [d.action, d.ws?.name])));
  ok('都不匹配才新建 D', miss.action === 'new' && !miss.ws, miss.how);
}

// 合并：轮数、记忆、关键词合并，来源区不被清空。
{
  const from = createWorkspace('示范卡券核销时报券码已使用');
  const into = createWorkspace('示范卡券后台状态不对');
  from.rounds = 2; into.rounds = 3; from.hits = 1; into.hits = 2;
  from.memories.push({ id: 'x', type: 'fact', text: '券码状态' });
  from.keywords.push('专属词');
  mergeWorkspace(from, into);
  ok('合并后轮数相加', into.rounds === 5, String(into.rounds));
  ok('合并后记忆保留', into.memories.some(m => m.id === 'x'));
  ok('合并后关键词并集', into.keywords.includes('专属词'));
  ok('合并来源仍独立', from.rounds === 2 && from.memories.length === 1);
}

console.log(fails ? 'ROUTER FAIL ' + fails : 'ROUTER PASS');
process.exit(fails ? 1 : 0);
