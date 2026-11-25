import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrMigrate, normalizeState, STATE_VERSION } from '../lib/store.js';

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) fails++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
};

const home = mkdtempSync(join(tmpdir(), 'hw-mig-'));
const v1Dir = join(home, 'hybrid-workspace');
mkdirSync(v1Dir, { recursive: true });
const v1 = {
  version: 1,
  workspaces: [{
    id: 'ws_v1', name: '零售收银终端', description: '商业收银终端、驱动、全国线上运维',
    keywords: ['retail', '收银'], summary: '终端 3.2.1 在示范门店 4G 链路偶发掉线',
    turns: [
      { role: 'user', text: '示范门店收银机又掉线了', round: 1, at: 100 },
      { role: 'assistant', text: '先看 net.log 的 reconnect 记录', round: 1, at: 101 },
    ],
    ledger: [
      { round: 2, text: '结论：终端 3.2.1 在示范门店 4G 链路偶发掉线，先查设备端 net.log', keys: ['示范门店', '终端', 'net.log'], at: 200 },
      { round: 3, text: '下一步需要把 reconnect 间隔改成 30 秒', keys: ['reconnect', '间隔'], at: 300 },
    ],
    rounds: 3, hits: 4, createdAt: 1, updatedAt: 400,
  }],
  sessions: { s1: { workspaceId: 'ws_v1', routedAt: 500 } },
  archives: [{
    id: 'a1', name: '旧供应商对账', description: '历史区', keywords: ['对账'], summary: '',
    turns: [{ role: 'user', text: '供应商对账差两毛', round: 1 }],
    ledger: [{ round: 1, text: '结论：按单据号逐条核', keys: ['单据号'], at: 600 }],
    rounds: 1, archivedAt: 700, reason: 'maxWorkspaces',
  }],
};
const v1Text = JSON.stringify(v1, null, 2);
writeFileSync(join(v1Dir, 'state.json'), v1Text, 'utf8');

const first = await loadOrMigrate({ dshHome: home });
ok('首次加载发生迁移', !!first.migratedFrom, String(first.migratedFrom));
ok('状态版本为 2', first.state.version === STATE_VERSION, String(first.state.version));
ok('工作区数量迁移', first.state.workspaces.length === 1, String(first.state.workspaces.length));
const ws = first.state.workspaces[0];
ok('工作区名字保留', ws.name === '零售收银终端', ws.name);
ok('ledger 转结构化记忆', ws.memories.length >= 2, String(ws.memories.length));
ok('结论记为 decision', ws.memories.some(m => m.type === 'decision' && m.text.includes('4G')), ws.memories.map(m => m.type).join(','));
ok('记忆来源标记 v1-ledger', ws.memories.some(m => m.source === 'v1-ledger'));
ok('用户轮次转为 exemplar', ws.exemplars.some(e => e.text.includes('示范门店')));
ok('turn 的 round 保留', ws.turns[0].round === 1, JSON.stringify(ws.turns[0]));
ok('会话绑定迁移', first.state.sessions.s1?.workspaceId === 'ws_v1', JSON.stringify(first.state.sessions));
ok('归档迁移', first.state.archives.length === 1 && first.state.archives[0].name === '旧供应商对账');
ok('归档里的账本转 memories', (first.state.archives[0].memories ?? []).length === 1);

const onDisk = JSON.parse(readFileSync(join(home, 'hybrid-workspace-v2', 'state.json'), 'utf8'));
ok('v2 状态已落盘', onDisk.workspaces.length === 1 && onDisk.version === 2);
ok('v1 文件未被改写', readFileSync(join(v1Dir, 'state.json'), 'utf8') === v1Text);

const second = await loadOrMigrate({ dshHome: home });
ok('二次加载不再迁移', second.migratedFrom === null);
ok('二次加载不重复', second.state.workspaces.length === 1 && second.state.archives.length === 1);

const normalized = normalizeState({ workspaces: [{ name: 'x', turns: [{ role: 'user', text: 't', round: 7 }] }] });
ok('normalizeState 保留 round', normalized.workspaces[0].turns[0].round === 7);

const reloaded = normalizeState({ sessions: { s1: { workspaceId: 'ws_a', newTopic: { text: '暂存首条', name: '暂存', at: 5, wsId: 'ws_a', round: 3, originTurn: 4 } } } });
const nt = reloaded.sessions.s1.newTopic;
ok('normalizeState 保留暂存轮的迁移坐标', nt?.wsId === 'ws_a' && nt?.round === 3 && nt?.originTurn === 4, JSON.stringify(nt));

console.log(fails ? 'MIGRATION FAIL ' + fails : 'MIGRATION PASS');
process.exit(fails ? 1 : 0);
