// v2 状态：单文件 JSON + 原子写 + decisions/trace 日志；首次启动只读迁移 v1。
// 状态目录独立（$DSH_HOME/hybrid-workspace-v2），绝不改 v1 的 state.json。

import { copyFile, mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hash } from './text.js';

export const STATE_VERSION = 2;

function emptyState () {
  return { version: STATE_VERSION, createdAt: Date.now(), updatedAt: Date.now(), workspaces: [], sessions: {}, archives: [], llmCalls: 0 };
}

function normalizeWorkspace (ws) {
  const now = Date.now();
  return {
    id: String(ws.id ?? ('ws_' + hash(String(ws.name ?? '') + now, 8))),
    name: String(ws.name ?? '未命名工作区'),
    description: String(ws.description ?? ''),
    keywords: Array.isArray(ws.keywords) ? ws.keywords.map(String).slice(0, 12) : [],
    summary: String(ws.summary ?? ''),
    turns: Array.isArray(ws.turns) ? ws.turns.map(t => ({ role: t.role === 'assistant' ? 'assistant' : 'user', text: String(t.text ?? ''), round: Number(t.round) || 0, at: t.at ?? now })).slice(-200) : [],
    memories: Array.isArray(ws.memories) ? ws.memories.filter(m => m && typeof m.text === 'string').map(m => ({
      id: String(m.id ?? ('m_' + hash(m.text, 10))),
      type: ['decision', 'fact', 'todo', 'question', 'episode'].includes(m.type) ? m.type : 'fact',
      text: String(m.text),
      keys: Array.isArray(m.keys) ? m.keys.map(String).slice(0, 12) : [],
      entities: Array.isArray(m.entities) ? m.entities.map(String).slice(0, 12) : [],
      importance: Math.max(1, Math.min(5, Number(m.importance) || 2)),
      turn: Number(m.turn) || 0,
      at: Number(m.at) || now,
      status: m.status === 'superseded' ? 'superseded' : 'active',
      supersedes: m.supersedes ?? null,
      supersededBy: m.supersededBy ?? null,
      source: m.source ?? 'migration',
    })) : [],
    exemplars: Array.isArray(ws.exemplars) ? ws.exemplars.map(e => ({ text: String(e.text ?? e), at: e.at ?? now })).slice(-20) : [],
    rounds: Number(ws.rounds) || 0,
    hits: Number(ws.hits) || 0,
    createdAt: Number(ws.createdAt) || now,
    updatedAt: Number(ws.updatedAt) || now,
  };
}

export function normalizeState (input) {
  const s = input && typeof input === 'object' ? input : {};
  const out = emptyState();
  out.createdAt = Number(s.createdAt) || out.createdAt;
  out.updatedAt = Number(s.updatedAt) || out.updatedAt;
  out.llmCalls = Number(s.llmCalls) || 0;
  out.workspaces = Array.isArray(s.workspaces) ? s.workspaces.map(normalizeWorkspace) : [];
  out.sessions = {};
  for (const [id, v] of Object.entries(s.sessions ?? {})) {
    if (!v || typeof v !== 'object') continue;
    out.sessions[id] = {
      workspaceId: v.workspaceId ?? null,
      routedAt: Number(v.routedAt) || 0,
      pending: v.pending && v.pending.id ? { id: String(v.pending.id), count: Math.max(1, Number(v.pending.count) || 1) } : null,
      lastQuery: String(v.lastQuery ?? ''),
      lastTurn: Number(v.lastTurn) || 0,
      recent: Array.isArray(v.recent) ? v.recent.slice(-12) : [],
    };
  }
  out.archives = Array.isArray(s.archives) ? s.archives.slice(0, 40).map(a => ({
    id: String(a.id ?? ''),
    name: String(a.name ?? '未命名工作区'),
    description: String(a.description ?? ''),
    keywords: Array.isArray(a.keywords) ? a.keywords.slice(0, 12) : [],
    summary: String(a.summary ?? ''),
    turns: Array.isArray(a.turns) ? a.turns.slice(-8) : [],
    memories: Array.isArray(a.memories) ? a.memories.slice(-20) : [],
    rounds: Number(a.rounds) || 0,
    archivedAt: Number(a.archivedAt) || Date.now(),
    reason: String(a.reason ?? ''),
  })) : [];
  return out;
}

function migrateV1 (v1) {
  const s = normalizeState({ createdAt: v1.createdAt, updatedAt: v1.updatedAt });
  for (const w of v1.workspaces ?? []) {
    const ws = normalizeWorkspace({
      ...w,
      turns: (w.turns ?? []).slice(-40),
      exemplars: (w.turns ?? []).filter(t => t.role === 'user').slice(-10).map(t => ({ text: t.text, at: t.at })),
      rounds: w.rounds ?? (w.turns ?? []).filter(t => t.role === 'user').length,
    });
    for (const e of (w.ledger ?? []).slice(-40)) {
      const text = String(e.text ?? '');
      if (!text) continue;
      ws.memories.push({
        id: 'm_' + hash('v1|' + text + '|' + (e.round ?? 0), 10),
        type: /(?:结论|决定|根因|修复|改成|改为|采用|方案|确认|口径)/u.test(text) ? 'decision' : 'fact',
        text,
        keys: Array.isArray(e.keys) ? e.keys.slice(0, 12) : [],
        entities: [],
        importance: 3,
        turn: Number(e.round) || 0,
        at: Number(e.at) || Date.now(),
        status: 'active',
        source: 'v1-ledger',
      });
    }
    s.workspaces.push(ws);
  }
  for (const [id, v] of Object.entries(v1.sessions ?? {})) {
    if (!v?.workspaceId) continue;
    s.sessions[id] = { workspaceId: v.workspaceId, routedAt: v.routedAt ?? 0, pending: null, lastQuery: '', lastTurn: 0, recent: [] };
  }
  for (const a of v1.archives ?? []) {
    s.archives.push({
      id: String(a.id ?? ''), name: String(a.name ?? '未命名工作区'), description: String(a.description ?? ''),
      keywords: Array.isArray(a.keywords) ? a.keywords : [], summary: String(a.summary ?? ''),
      turns: (a.turns ?? []).slice(-8),
      memories: (a.ledger ?? []).slice(-20).map(e => ({ type: 'fact', text: String(e.text ?? ''), turn: Number(e.round) || 0, at: Number(e.at) || Date.now() })),
      rounds: Number(a.rounds) || 0, archivedAt: Number(a.archivedAt) || Date.now(), reason: String(a.reason ?? 'v1'),
    });
  }
  return s;
}

export async function readJson (path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

export async function writeAtomic (path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, path);
}

export async function appendJsonl (path, obj) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(obj) + '\n', 'utf8');
}

export async function readJsonl (path, limit = 50) {
  try {
    const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export async function loadOrMigrate ({ dshHome, log = () => {} } = {}) {
  const dir = join(dshHome, 'hybrid-workspace-v2');
  const statePath = join(dir, 'state.json');
  let raw = null;
  try { raw = await readFile(statePath, 'utf8'); } catch { /* 不存在 */ }
  if (raw !== null) {
    try {
      const found = JSON.parse(raw);
      if (found) return { state: normalizeState(found), dir, statePath, migratedFrom: null };
    } catch {
      // 损坏的 v2 状态先留证再继续；绝不能静默用旧的 v1 覆盖掉用户数据。
      const backup = statePath + '.corrupt-' + Date.now();
      try { await copyFile(statePath, backup); } catch { /* 备份失败也继续 */ }
      log('state corrupt, backup: ' + backup);
    }
  }

  const v1Path = join(dshHome, 'hybrid-workspace', 'state.json');
  const v1 = await readJson(v1Path);
  let state;
  let migratedFrom = null;
  if (v1 && Array.isArray(v1.workspaces)) {
    state = migrateV1(v1);
    migratedFrom = v1Path;
    log('migrated v1 state: ' + v1.workspaces.length + ' workspaces');
  } else {
    state = emptyState();
  }
  await saveState(statePath, state);
  return { state, dir, statePath, migratedFrom };
}

export async function saveState (statePath, state) {
  state.updatedAt = Date.now();
  await writeAtomic(statePath, JSON.stringify(state, null, 2));
}
