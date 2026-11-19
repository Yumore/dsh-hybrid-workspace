import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrMigrate } from '../lib/store.js';

const home = mkdtempSync(join(tmpdir(), 'hw-v2-corrupt-'));
const dir = join(home, 'hybrid-workspace-v2');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'state.json'), '{ this is not json', 'utf8');

let fails = 0;
const ok = (name, cond, detail = '') => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); };
const logs = [];
const r = await loadOrMigrate({ dshHome: home, log: m => logs.push(String(m)) });
ok('损坏状态回退为空状态', r.state.workspaces.length === 0 && r.state.version === 2);
const backups = readdirSync(dir).filter(f => f.startsWith('state.json.corrupt-'));
ok('损坏文件已备份', backups.length === 1, backups.join(','));
ok('备份内容保留原字节', backups.length === 1 && readFileSync(join(dir, backups[0]), 'utf8') === '{ this is not json');
ok('日志提示损坏', logs.some(l => l.includes('state corrupt')), logs.join('|'));
ok('新状态已落盘', (() => { try { return JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).version === 2; } catch { return false; } })());

console.log(fails ? 'CORRUPT FAIL ' + fails : 'CORRUPT PASS');
process.exit(fails ? 1 : 0);
