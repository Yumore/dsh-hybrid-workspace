// v2 状态：单文件 JSON + 原子写 + decisions/trace 日志；首次启动只读迁移 v1。
// 状态目录独立（$DSH_HOME/hybrid-workspace-v2），绝不改 v1 的 state.json。

import { copyFile, mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hash } from './text.js';
import { normalizeMemory } from './lifecycle.js';
import { normalizePolicy } from './policy.js';

export const STATE_VERSION = 2;

function emptyState () {
  return { version: STATE_VERSION, createdAt: Date.now(), updatedAt: Date.now(), workspaces: [], sessions: {}, archives: [], profile: [], llmCalls: 0, multiTurns: 0 };
}

function normalizeWorkspace (ws) {
  const now = Date.now();
  return {
    id: String(ws.id ?? ('ws_' + hash(String(ws.name ?? '') + now, 8))),
    name: String(ws.name ?? '未命名工作区'),
    description: String(ws.description ?? ''),
    keywords: Array.isArray(ws.keywords) ? ws.keywords.map(String).slice(0, 12) : [],
    summary: String(ws.summary ?? ''),
    turns: Array.isArray(ws.turns) ? ws.turns.map(t => { const turn = Number(t.turn) || Number(t.round) || 0; return { role: t.role === 'assistant' ? 'assistant' : 'user', text: String(t.text ?? ''), turn, round: Number(t.round) || turn, at: t.at ?? now }; }).slice(-200) : [],
    memories: Array.isArray(ws.memories) ? ws.memories.filter(m => m && typeof m.text === 'string').map(m => normalizeMemory(m, { now })) : [],
    exemplars: Array.isArray(ws.exemplars) ? ws.exemplars.map(e => ({ text: String(e.text ?? e), at: e.at ?? now })).slice(-20) : [],
    rounds: Number(ws.rounds) || 0,
    hits: Number(ws.hits) || 0,
    policy: normalizePolicy(ws.policy),
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
  out.multiTurns = Number(s.multiTurns) || 0;
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
      activeWorkspaceIds: Array.isArray(v.activeWorkspaceIds) ? v.activeWorkspaceIds.map(String).slice(0, 8) : [],
      lastSegments: Array.isArray(v.lastSegments) ? v.lastSegments.slice(0, 8).map(x => ({
        index: Number(x.index) || 0, wsId: String(x.wsId ?? ''), name: String(x.name ?? ''), text: String(x.text ?? ''),
      })) : [],
      multiQuery: String(v.multiQuery ?? ''),
      recent: Array.isArray(v.recent) ? v.recent.slice(-12) : [],
    };
  }
  // 全局档案独立于任何工作区：只存 state.profile，不复制进 ws.memories。
  const rawProfile = Array.isArray(s.profile) ? s.profile : (Array.isArray(s.profile?.memories) ? s.profile.memories : []);
  out.profile = rawProfile.filter(m => m && typeof m.text === 'string').slice(-200).map(m => {
    const mem = normalizeMemory(m);
    mem.tier = 'profile';
    mem.layer = 'profile';
    mem.scope = 'global';
    // 旧数据/未显式取消置顶的档案默认置顶；用户取消过就尊重 false。
    mem.pinned = m.pinned !== false;
    mem.validUntil = null;
    mem.expiresAt = null;
    mem.ttlMs = 0;
    return mem;
  });
  out.archives = Array.isArray(s.archives) ? s.archives.slice(0, 40).map(a => {
    const now = Date.now();
    const turns = Array.isArray(a.turns) ? a.turns.filter(t => t && typeof t.text === 'string').map(t => {
      const turn = Number(t.turn) || Number(t.round) || 0;
      return { role: t.role === 'assistant' ? 'assistant' : 'user', text: String(t.text ?? ''), turn, round: Number(t.round) || turn, at: Number(t.at) || now };
    }) : [];
    const memories = Array.isArray(a.memories)
      ? a.memories.filter(m => m && typeof m.text === 'string').map(m => normalizeMemory(m, { now }))
      : [];
    return {
      id: String(a.id ?? ''),
      name: String(a.name ?? '未命名工作区'),
      description: String(a.description ?? ''),
      keywords: Array.isArray(a.keywords) ? a.keywords.map(String).slice(0, 12) : [],
      summary: String(a.summary ?? ''),
      turns,
      memories,
      rounds: Number(a.rounds) || 0,
      archivedAt: Number(a.archivedAt) || now,
      reason: String(a.reason ?? ''),
      restorable: a.restorable !== false,
      migratedTo: a.migratedTo && typeof a.migratedTo === 'object'
        ? { id: String(a.migratedTo.id ?? ''), name: String(a.migratedTo.name ?? '') }
        : null,
      movedTurns: Number(a.movedTurns) || 0,
      movedMemories: Number(a.movedMemories) || 0,
      contextChars: Number(a.contextChars) || 0,
      contextTokens: Number(a.contextTokens) || 0,
      policy: normalizePolicy(a.policy),
      exemplars: Array.isArray(a.exemplars) ? a.exemplars.map(e => ({ text: String(e?.text ?? e), at: Number(e?.at) || now })).slice(-20) : [],
      hits: Number(a.hits) || 0,
      createdAt: Number(a.createdAt) || Number(a.archivedAt) || now,
      updatedAt: Number(a.updatedAt) || Number(a.archivedAt) || now,
    };
  }) : [];
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
      turns: (a.turns ?? []).map(t => ({ role: t.role === 'assistant' ? 'assistant' : 'user', text: String(t.text ?? ''), turn: Number(t.turn) || Number(t.round) || 0, round: Number(t.round) || Number(t.turn) || 0, at: Number(t.at) || Date.now() })),
      memories: (a.ledger ?? []).map(e => ({ type: 'fact', text: String(e.text ?? ''), turn: Number(e.round) || 0, at: Number(e.at) || Date.now() })),
      rounds: Number(a.rounds) || 0, archivedAt: Number(a.archivedAt) || Date.now(), reason: String(a.reason ?? 'v1'),
    });
  }
  return normalizeState(s);
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
      // 损坏的 v2 状态先留证；绝不能用旧的 v1 覆盖损坏的 v2。
      // 备份后直接重建空状态，跳过 v1 迁移，用户可手工从备份恢复。
      const backup = statePath + '.corrupt-' + Date.now();
      try { await copyFile(statePath, backup); } catch { /* 备份失败也继续 */ }
      log('state corrupt, backup: ' + backup + '; starting empty v2 (v1 migration skipped)');
      const state = emptyState();
      await saveState(statePath, state);
      return { state, dir, statePath, migratedFrom: null, corrupt: true };
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
