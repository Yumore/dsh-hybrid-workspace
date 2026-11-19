import { decideRoute, createWorkspace, addExemplar } from '../lib/router.js';
const clusters = [
  ['万象城四台收银机每天下午四点断线', '万象城的收银机断线时 net.log 里 reconnect 记录对不上', '万象城断线后 session 表里 sessionid 每隔几分钟变一次'],
  ['会员积分接口现在同步写，结算老是拖延', '会员积分接口扣减要不要改成异步队列', '会员积分接口重写后结算顺序怎么保证'],
  ['供应商对账金额差了两毛三分钱', '供应商对账的采购单和发票金额对不上怎么核', '供应商对账差异要按单据号逐条查吗'],
  ['瑞祥卡券核销时报券码已使用', '瑞祥卡券的券码状态在后台显示未核销', '瑞祥卡券核销接口返回 500 怎么排查'],
  ['DTP 药房处方打印机打不出小票', 'DTP 药房处方单模板里的医保编号错位', 'DTP 药房处方结算单打印出来少了一联'],
  ['前台小票打印机缺纸后一直报错', '小票打印机重连后小票模板变成空白', '小票打印机的小票模板里门店名称取错了'],
  ['收银机开机黑屏进不了系统', '收银机开机换了电源适配器还是黑屏', '收银机开机时风扇转但屏幕没信号'],
  ['门店交接班报表金额对不上', '门店交接班时现金和系统差 200', '门店交接班报表要按收银员拆分吗'],
  ['微信支付回调超时导致订单未支付', '微信支付对账单和系统订单差一笔', '微信支付回调重试机制怎么设'],
  ['电子秤称重后条码打出来没价格', '电子秤称重商品的条码规则是什么', '电子秤称重和小票打印机怎么连'],
  ['库存盘点后数量没有同步到前台', '库存盘点的差异要不要生成调整单', '库存盘点同步接口多久跑一次'],
  ['会员储值退款后余额没有回滚', '会员储值退款要不要审批', '会员储值余额和退款单对不上'],
];
const workspaces = []; const session = { workspaceId: null, pending: null };
const byId = id => workspaces.find(w => w.id === id);
const rows = [];
clusters.forEach((qs, ci) => qs.forEach((q, qi) => {
  const d = decideRoute({ workspaces, session, text: q });
  let ws;
  if (d.action === 'new' || d.action === 'ask-llm') { ws = createWorkspace(q); workspaces.push(ws); session.workspaceId = ws.id; session.pending = null; }
  else if (d.action === 'route') { ws = byId(d.wsId); session.workspaceId = ws.id; session.pending = null; addExemplar(ws, q); }
  else { ws = byId(session.workspaceId); if (d.pending) session.pending = d.pending; else if (d.how !== 'pending-switch') session.pending = null; }
  ws.rounds++; ws.hits++; ws.turns.push({ role:'user', text:q, topic:ci });
  rows.push({ ci, qi, q, id: ws.id, name: ws.name, how: d.how, top: d.top, scores: d.scores });
}));
console.log('workspaces', workspaces.length);
for (const ws of workspaces) {
  const topics = [...new Set(ws.turns.map(t => t.topic))];
  console.log(ws.id, JSON.stringify(ws.name), 'topics=' + topics.join(','), 'turns=' + ws.turns.length);
}
console.log('--- messages');
for (const r of rows) console.log('t' + r.ci + '.' + r.qi, r.how, r.name, 'score=' + r.top?.score, 'top=' + r.scores?.map(s=>s.id+':'+s.score).join(','));
