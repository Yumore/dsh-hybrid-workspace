import { existsSync, readFileSync } from 'node:fs';
import { decideRoute, createWorkspace, addExemplar } from '../lib/router.js';
import { jaccard, tokens } from '../lib/text.js';

const fixtureUrl = new URL('./fixtures/real-questions.json', import.meta.url);
const hasReal = existsSync(fixtureUrl);
const fixture = hasReal ? JSON.parse(readFileSync(fixtureUrl, 'utf8')) : { questions: [] };
const real = fixture.questions.map(x => ({ q: x.question })).filter(x => x.q.trim());

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
const synth = clusters.flatMap((qs, ci) => qs.map(q => ({ q, topic: ci })));

function simulate (messages, cfg) {
  const workspaces = [];
  const session = { workspaceId: null, pending: null };
  const byId = id => workspaces.find(w => w.id === id);
  const events = [];
  for (const item of messages) {
    const text = item.q ?? item;
    let d = decideRoute({ workspaces, session, text, cfg });
    events.push(d.how);
    let ws;
    if (d.action === 'new' || d.action === 'ask-llm') {
      ws = createWorkspace(text); workspaces.push(ws); session.workspaceId = ws.id; session.pending = null;
    } else if (d.action === 'route') {
      ws = byId(d.wsId); session.workspaceId = ws.id; session.pending = null; addExemplar(ws, text);
    } else {
      ws = byId(session.workspaceId);
      if (d.pending) session.pending = d.pending; else if (d.how !== 'pending-switch') session.pending = null;
    }
    ws.rounds = (ws.rounds ?? 0) + 1; ws.hits = (ws.hits ?? 0) + 1;
    ws.turns.push({ role: 'user', text, round: ws.rounds, topic: item.topic });
  }
  return { workspaces, events };
}

function metrics (R) {
  const multi = R.workspaces.filter(w => w.turns.length >= 2);
  let sum = 0, weight = 0;
  for (const w of multi) {
    const sets = w.turns.map(t => tokens(t.text));
    let s = 0, n = 0;
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) { s += jaccard(sets[i], sets[j]); n++; }
    sum += (s / Math.max(1, n)) * w.turns.length; weight += w.turns.length;
  }
  const counts = R.workspaces.map(w => w.turns.length);
  const top = Math.max(...counts);
  const hist = {};
  for (const how of R.events) hist[how] = (hist[how] ?? 0) + 1;
  return {
    ws: R.workspaces.length,
    cohesion: +(sum / Math.max(1, weight)).toFixed(3),
    topShare: +(top / R.events.length).toFixed(2),
    singletons: counts.filter(n => n === 1).length,
    avgTurns: +(R.events.length / R.workspaces.length).toFixed(2),
    asks: hist['ask-llm'] ?? 0,
    new: (hist['no-signal'] ?? 0) + (hist['bootstrap'] ?? 0) + (hist['weak-current-new'] ?? 0) + (hist['llm-new'] ?? 0),
    routed: (hist['match'] ?? 0) + (hist['strong-signal'] ?? 0) + (hist['exact-name'] ?? 0) + (hist['switch-pending'] ?? 0),
  };
}

function synthetic (cfg) {
  const S = simulate(synth, cfg);
  const owner = new Map();
  for (const w of S.workspaces) for (const t of w.turns) owner.set(t.text, w.id);
  const byTopic = new Map();
  for (const item of synth) byTopic.set(item.topic, [...(byTopic.get(item.topic) ?? []), owner.get(item.q)]);
  let correct = 0, total = 0, spread = 0;
  for (const arr of byTopic.values()) {
    const m = new Map(); for (const id of arr) m.set(id, (m.get(id) ?? 0) + 1);
    correct += Math.max(...m.values()); total += arr.length; spread += m.size;
  }
  return { ...metrics(S), purity: +(correct / total).toFixed(2), spread: +(spread / byTopic.size).toFixed(1) };
}

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
};

const cfg = {};
const R = hasReal ? simulate(real, cfg) : null;
const realM = R ? metrics(R) : null;
const synthM = synthetic(cfg);
console.log(JSON.stringify({ real: realM ?? 'skipped (fixture not bundled)', synth: synthM }, null, 2));

if (hasReal) {
  // 重复工单一致性：同一条问题第二次出现时，是否落回同一个工作区。
  const owner = new Map();
  for (const w of R.workspaces) for (const t of w.turns) owner.set(t.text, w.id);
  const groups = new Map();
  for (const item of real) groups.set(item.q, [...(groups.get(item.q) ?? []), owner.get(item.q)]);
  let dupGroups = 0, sameGroups = 0;
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    dupGroups++;
    if (new Set(ids).size === 1) sameGroups++;
  }
  const dupRate = dupGroups ? sameGroups / dupGroups : 1;
  ok('真实问题覆盖面 >= 100 条', real.length >= 100, String(real.length));
  ok('真实工单形成 18~40 个工作区', realM.ws >= 18 && realM.ws <= 40, String(realM.ws));
  ok('真实工单最大区占比 <= 0.25', realM.topShare <= 0.25, String(realM.topShare));
  ok('真实工单孤立区 <= 12', realM.singletons <= 12, String(realM.singletons));
  ok('真实工单凝聚度 >= 0.18', realM.cohesion >= 0.18, String(realM.cohesion));
  ok('真实工单极少需要 LLM 兜底', realM.asks <= 5, String(realM.asks));
  ok('重复工单回原区 >= 0.8', dupRate >= 0.8, dupRate.toFixed(2) + ' (' + sameGroups + '/' + dupGroups + ')');
} else {
  console.log('SKIP 真实问题 fixture 未包含（含生产数据，见 .gitignore）');
}
ok('合成话题纯度 = 1', synthM.purity === 1, String(synthM.purity));
ok('合成话题平均拆分 <= 1.1', synthM.spread <= 1.1, String(synthM.spread));
ok('合成工作区 8~14', synthM.ws >= 8 && synthM.ws <= 14, String(synthM.ws));

console.log(fails ? 'EVAL FAIL ' + fails : 'EVAL PASS');
process.exit(fails ? 1 : 0);
