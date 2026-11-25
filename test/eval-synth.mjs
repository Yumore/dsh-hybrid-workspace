import { readFileSync } from 'node:fs';
import { decideRoute, createWorkspace, addExemplar, takeRoundTurns } from '../lib/router.js';
import { jaccard, tokens } from '../lib/text.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/synthetic-questions.json', import.meta.url), 'utf8'));
const cases = fixture.questions.map(x => ({ q: x.question })).filter(x => x.q.trim());

// 合成聚类：用于检查同一话题是否被拆得过碎。全部为虚构门店与业务描述。
const clusters = [
  ['一号店四台收银机每天下午四点断线', '一号店收银机断线时 net.log 里 reconnect 记录对不上', '一号店断线后 session 表里 sessionid 每隔几分钟变一次'],
  ['会员积分接口现在同步写，结算老是拖延', '会员积分接口扣减要不要改成异步队列', '会员积分接口重写后结算顺序怎么保证'],
  ['供应商对账金额差了两毛三分钱', '供应商对账的采购单和发票金额对不上怎么核', '供应商对账差异要按单据号逐条查吗'],
  ['会员卡券核销时报券码已使用', '会员卡券的券码状态在后台显示未核销', '会员卡券核销接口返回 500 怎么排查'],
  ['小票打印机打不出小票', '小票打印机模板里的门店名称取错了', '小票打印机重连后模板变成空白'],
  ['收银机开机黑屏进不了系统', '收银机开机换了电源适配器还是黑屏', '收银机开机时风扇转但屏幕没信号'],
  ['门店交接班报表金额对不上', '门店交接班时现金和系统差 200', '门店交接班报表要按收银员拆分吗'],
  ['支付回调超时导致订单未支付', '支付对账单和系统订单差一笔', '支付回调重试机制怎么设'],
  ['电子秤称重后条码打出来没价格', '电子秤称重商品的条码规则是什么', '电子秤称重和小票打印机怎么连'],
  ['库存盘点后数量没有同步到前台', '库存盘点的差异要不要生成调整单', '库存盘点同步接口多久跑一次'],
  ['会员储值退款后余额没有回滚', '会员储值退款要不要审批', '会员储值余额和退款单对不上'],
  ['商品变价后前台价格没有更新', '商品变价和促销价冲突时以哪个为准', '商品变价同步到收银机延迟'],
];
const synth = clusters.flatMap((qs, ci) => qs.map(q => ({ q, topic: ci })));

function simulate (messages, cfg) {
  const workspaces = [];
  const session = { workspaceId: null, pending: null, newTopic: null };
  const byId = id => workspaces.find(w => w.id === id);
  const events = [];
  for (const item of messages) {
    const text = item.q ?? item;
    let d = decideRoute({ workspaces, session, text, cfg });
    events.push(d.how);
    let ws;
    if (d.action === 'new' || d.action === 'ask-llm') {
      const pending = session.newTopic;
      const confirmed = d.how === 'new-topic-confirmed' && pending?.text;
      ws = createWorkspace(confirmed ? pending.text : text); workspaces.push(ws);
      if (confirmed) {
        const from = byId(pending.wsId);
        if (from && from.id !== ws.id) takeRoundTurns(from, ws, pending.round);
      }
      session.workspaceId = ws.id; session.pending = null; session.newTopic = null;
    } else if (d.action === 'route') {
      ws = byId(d.wsId); session.workspaceId = ws.id; session.pending = null; session.newTopic = null; addExemplar(ws, text);
    } else {
      ws = byId(session.workspaceId);
      if (d.pending) session.pending = d.pending; else if (d.how !== 'pending-switch') session.pending = null;
      session.newTopic = d.newTopic !== undefined ? d.newTopic : null;
    }
    ws.rounds = (ws.rounds ?? 0) + 1; ws.hits = (ws.hits ?? 0) + 1;
    ws.turns.push({ role: 'user', text, round: ws.rounds, topic: item.topic });
    if (session.newTopic) session.newTopic = { ...session.newTopic, wsId: ws.id, round: ws.rounds };
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
    new: (hist['no-signal'] ?? 0) + (hist['bootstrap'] ?? 0) + (hist['new-topic-confirmed'] ?? 0) + (hist['weak-current-new'] ?? 0) + (hist['llm-new'] ?? 0),
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
const R = simulate(cases, cfg);
const caseM = metrics(R);
const synthM = synthetic(cfg);
console.log(JSON.stringify({ synthetic: caseM, clusters: synthM }, null, 2));

// 同一问题重复出现时，是否落回同一个工作区。
const owner = new Map();
for (const w of R.workspaces) for (const t of w.turns) owner.set(t.text, w.id);
const groups = new Map();
for (const item of cases) groups.set(item.q, [...(groups.get(item.q) ?? []), owner.get(item.q)]);
let dupGroups = 0, sameGroups = 0;
for (const ids of groups.values()) {
  if (ids.length < 2) continue;
  dupGroups++;
  if (new Set(ids).size === 1) sameGroups++;
}
const dupRate = dupGroups ? sameGroups / dupGroups : 1;

ok('合成问题覆盖面 >= 100 条', cases.length >= 100, String(cases.length));
ok('合成工单形成 8~40 个工作区', caseM.ws >= 8 && caseM.ws <= 40, String(caseM.ws));
ok('合成工单最大区占比 <= 0.3', caseM.topShare <= 0.3, String(caseM.topShare));
ok('合成工单孤立区 <= 15', caseM.singletons <= 15, String(caseM.singletons));
ok('合成工单凝聚度 >= 0.15', caseM.cohesion >= 0.15, String(caseM.cohesion));
ok('合成工单极少需要 LLM 兜底', caseM.asks <= 5, String(caseM.asks));
ok('重复问题回原区 >= 0.8', dupRate >= 0.8, dupRate.toFixed(2) + ' (' + sameGroups + '/' + dupGroups + ')');
ok('人工聚类纯度 >= 0.95', synthM.purity >= 0.95, String(synthM.purity));
ok('人工聚类平均拆分 <= 1.1', synthM.spread <= 1.1, String(synthM.spread));
ok('人工聚类工作区 8~14', synthM.ws >= 8 && synthM.ws <= 14, String(synthM.ws));

console.log(fails ? 'EVAL FAIL ' + fails : 'EVAL PASS');
process.exit(fails ? 1 : 0);
