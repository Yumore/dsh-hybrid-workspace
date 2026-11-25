import { decideRoute, createWorkspace, mergeWorkspace, findDuplicateWorkspace, isExplicitNewProject, takeRoundTurns, pickMultiTarget } from '../lib/router.js';

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
};

const a = createWorkspace('示范门店四台收银机每天下午四点断线');
const b = createWorkspace('会员积分接口现在同步写，结算老是拖延');
const list = [a, b];

// 1. 当前区存在时，未命中任何区的长句先停留，不立即建 D。
{
  const session = { workspaceId: a.id, pending: null, newTopic: null };
  const first = '仓库盘点工具先做扫码入库';
  const d1 = decideRoute({ workspaces: list, session, text: first });
  ok('未命中先停留当前区', d1.action === 'stay' && d1.how === 'no-signal-stay' && d1.newTopic?.text === first, d1.how + ' ' + JSON.stringify(d1.newTopic));
  session.newTopic = d1.newTopic;
  const d2 = decideRoute({ workspaces: list, session, text: '仓库盘点工具的扫码入库流程再改一下' });
  ok('第二条同主题才升级', d2.action === 'new' && d2.how === 'new-topic-confirmed' && d2.ws === undefined, d2.how);
}

// 2. 第二条是另一个无关话题：候选被重置，仍然不建区。
{
  const session = { workspaceId: a.id, pending: null, newTopic: null };
  const d1 = decideRoute({ workspaces: list, session, text: '仓库盘点工具先做扫码入库' });
  session.newTopic = d1.newTopic;
  const d2 = decideRoute({ workspaces: list, session, text: '明天上午十点在三楼会议室开周会' });
  ok('无关第二条不升级', d2.action === 'stay' && d2.how === 'no-signal-stay' && d2.newTopic?.text.includes('开周会'), d2.how + ' ' + JSON.stringify(d2.newTopic));
}

// 3. 明确说新项目才允许跳过两跳确认。
{
  const d = decideRoute({ workspaces: list, session: { workspaceId: a.id, pending: null, newTopic: null }, text: '新项目：仓库盘点工具' });
  ok('明确新项目立即建区', d.action === 'new' && d.how === 'explicit-new', d.how);
  ok('识别新项目语句', isExplicitNewProject('另起一个项目做盘点') && !isExplicitNewProject('这个项目继续做'));
}

// 4. 同名/同路径建区前查重。
{
  const ws = { id: 'ws_path', name: '/Users/mac/工作/华润/c' };
  ok('同路径名直接复用', findDuplicateWorkspace([ws], '/Users/mac/工作/华润/c ') === ws);
  ok('不同名不复用', findDuplicateWorkspace([ws], '/Users/mac/工作/华润/d') === null);
}

// 5. 合并轮次按 user 轮计数，turn 偏移避开目标区最大 turn。
{
  const from = {
    rounds: 2,
    turns: [
      { role: 'user', text: '来源一', turn: 1 },
      { role: 'assistant', text: '回答一', turn: 1 },
      { role: 'user', text: '来源二', turn: 2 },
      { role: 'assistant', text: '回答二', turn: 2 },
    ],
  };
  const into = {
    rounds: 3,
    turns: [
      { role: 'user', text: '目标一', turn: 1 },
      { role: 'assistant', text: '目标答一', turn: 1 },
      { role: 'user', text: '目标二', turn: 2 },
      { role: 'assistant', text: '目标答二', turn: 2 },
      { role: 'user', text: '目标三', turn: 3 },
      { role: 'assistant', text: '目标答三', turn: 3 },
    ],
  };
  mergeWorkspace(from, into);
  ok('合并轮数按用户轮相加', into.rounds === 5, String(into.rounds));
  ok('来源 turn 从目标最大 turn 之后接续', into.turns.some(t => t.text === '来源一' && t.turn === 4) && into.turns.some(t => t.text === '来源二' && t.turn === 5), JSON.stringify(into.turns.map(t => [t.text, t.turn])));
}

// 6. 两跳确认时，把暂存在旧区的首条 user/assistant 一起搬到新区。
{
  const from = {
    rounds: 3,
    hits: 2,
    turns: [
      { role: 'user', text: '旧话题一', turn: 1 },
      { role: 'assistant', text: '旧回答一', turn: 1 },
      { role: 'user', text: '新话题首条', turn: 2 },
      { role: 'assistant', text: '新话题首答', turn: 2 },
      { role: 'user', text: '旧话题三', turn: 3 },
      { role: 'assistant', text: '旧回答三', turn: 3 },
    ],
  };
  const to = createWorkspace('新话题');
  const moved = takeRoundTurns(from, to, 2);
  ok('迁移暂存首轮返回条数', moved === 2, String(moved));
  ok('迁移保留 user 与 assistant', to.turns.length === 2 && to.turns[0].text === '新话题首条' && to.turns[1].text === '新话题首答', JSON.stringify(to.turns));
  ok('迁移后新区从第 1 轮开始', to.rounds === 1 && to.turns.every(t => t.turn === 1 && t.round === 1), JSON.stringify([to.rounds, to.turns.map(t => t.turn)]));
  ok('迁移后旧区减少一轮一次命中', from.rounds === 2 && from.hits === 1 && from.turns.length === 4, JSON.stringify([from.rounds, from.hits, from.turns.length]));
  ok('迁移不存在的轮次返回 0', takeRoundTurns(from, createWorkspace('空'), 99) === 0);
}

// 7. 多话题分段命中两个身份词时优先复用旧区，不能因为分数没到 0.48 就新建。
{
  const opsA = { id: 'ws_ops', name: 'imPOS 运维 / 报障 / workTool', keywords: ['workbuddy', '智能', '助手'], description: '', exemplars: [] };
  const dshB = { id: 'ws_dsh', name: 'DSH 插件开发', keywords: ['插件', '工作区'], description: '', exemplars: [] };
  const text = '我在用workbuddy改智能助手的网络问题';
  const picked = pickMultiTarget({
    scores: [{ id: 'ws_dsh', score: 0.35 }, { id: 'ws_ops', score: 0.42 }],
    currentId: 'ws_dsh', text, workspaces: [dshB, opsA], cfg: {},
  });
  ok('多话题优先复用两个身份词命中的旧区', picked?.id === 'ws_ops', picked?.id);
  ok('多话题没有候选才新建', pickMultiTarget({ scores: [{ id: 'ws_dsh', score: 0.35 }], currentId: 'ws_dsh', text, workspaces: [dshB, opsA], cfg: {} }) === null);
}

console.log(fails ? 'ENTRY FAIL ' + fails : 'ENTRY PASS');
process.exit(fails ? 1 : 0);
