// 工作区导出/导入：JSON 供备份与再导入，Markdown 供人读且能回读。
// 纯函数、零 DSH import；分配新 id 由索引层完成，这里只保证字段和 supersede 链。

import { clipped, hash } from './text.js';
import { TIERS, STATUSES } from './lifecycle.js';

export const PORTABLE_FORMAT = 'dsh-hybrid-workspace';
export const PORTABLE_VERSION = 1;

const TYPES = new Set(['decision', 'fact', 'todo', 'question', 'episode']);
const TIER_SET = new Set(TIERS);
const STATUS_SET = new Set(STATUSES);
const MAX_TURNS = 500;
const MAX_MEMORIES = 500;
const MAX_TEXT = 4000;

const boolOf = (v) => v === true || v === 'true' || v === '是' || v === '1';
const numOf = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const timeOf = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? t : 0;
};
const keysOf = (v) => String(v ?? '').split(/[、,，;；\n]+/u).map(s => s.trim()).filter(Boolean).slice(0, 12);
const textOf = (v) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_TEXT);

function cleanTurn (t, i, now) {
  const text = textOf(t?.text);
  if (!text) return null;
  const turn = numOf(t?.turn) || numOf(t?.round) || i + 1;
  return {
    role: t?.role === 'assistant' ? 'assistant' : 'user',
    text,
    turn,
    round: numOf(t?.round) || turn,
    at: timeOf(t?.at) || now,
  };
}

function cleanMemory (m, i, now) {
  const text = textOf(m?.text);
  if (!text) return null;
  const at = timeOf(m?.at) || now;
  return {
    id: '',
    oldId: String(m?.id ?? ''),
    type: TYPES.has(m?.type) ? m.type : 'fact',
    text,
    keys: Array.isArray(m?.keys) ? m.keys.map(String).slice(0, 12) : keysOf(m?.keys),
    entities: Array.isArray(m?.entities) ? m.entities.map(String).slice(0, 12) : [],
    importance: Math.max(1, Math.min(5, numOf(m?.importance) || 3)),
    turn: numOf(m?.turn) || 0,
    at,
    status: STATUS_SET.has(m?.status) ? m.status : 'active',
    source: String(m?.source ?? 'import').slice(0, 40),
    tier: TIER_SET.has(m?.tier) ? m.tier : 'durable',
    scope: m?.scope === 'global' ? 'global' : 'workspace',
    pinned: boolOf(m?.pinned),
    validUntil: m?.validUntil == null ? null : (timeOf(m.validUntil) || null),
    expiresAt: m?.expiresAt == null ? null : (timeOf(m.expiresAt) || null),
    ttlMs: Math.max(0, numOf(m?.ttlMs)),
    createdAt: timeOf(m?.createdAt) || at,
    updatedAt: timeOf(m?.updatedAt) || at,
    lastUsedAt: timeOf(m?.lastUsedAt) || at,
    supersedes: String(m?.supersedes ?? ''),
    supersededBy: String(m?.supersededBy ?? ''),
    index: i,
  };
}

function normalizeWorkspace (raw, { now = Date.now(), salt = '', index = 0 } = {}) {
  const ws = raw && typeof raw === 'object' ? raw : {};
  const name = clipped(String(ws.name ?? '').trim() || '导入的工作区', 60);
  const turns = (Array.isArray(ws.turns) ? ws.turns : []).map((t, i) => cleanTurn(t, i, now)).filter(Boolean).slice(-MAX_TURNS);
  const memories = (Array.isArray(ws.memories) ? ws.memories : []).map((m, i) => cleanMemory(m, i, now)).filter(Boolean).slice(-MAX_MEMORIES);

  // 先给每条记忆新 id，再把 supersede 链从旧 id 映射到新 id；找不到目标就断开。
  const map = new Map();
  for (const m of memories) {
    m.id = 'm_' + hash([salt, '|', index, '|', m.text, '|', m.turn, '|', m.index].join(''), 10);
    if (m.oldId && !map.has(m.oldId)) map.set(m.oldId, m.id);
  }
  for (const m of memories) {
    const oldSupersedes = m.supersedes;
    const oldSupersededBy = m.supersededBy;
    m.supersedes = map.get(oldSupersedes) || '';
    m.supersededBy = map.get(oldSupersededBy) || '';
    if (m.supersededBy) m.status = 'superseded';
    delete m.oldId;
    delete m.index;
  }

  const exemplars = (Array.isArray(ws.exemplars) ? ws.exemplars : []).map(e => {
    const text = textOf(e?.text ?? e);
    return text ? { text: clipped(text, 200), at: timeOf(e?.at) || now } : null;
  }).filter(Boolean).slice(-20);

  return {
    name,
    description: clipped(String(ws.description ?? ''), 300),
    keywords: Array.isArray(ws.keywords) ? ws.keywords.map(String).slice(0, 12) : [],
    summary: clipped(String(ws.summary ?? ''), 700),
    rounds: Math.max(0, numOf(ws.rounds) || turns.filter(t => t.role === 'user').length),
    turns,
    memories,
    exemplars,
    policy: ws.policy && typeof ws.policy === 'object' ? ws.policy : undefined,
  };
}

// 全局档案导入：同样重编 id / supersede 链，并强制档案层字段。
export function normalizeProfile (list, { now = Date.now(), salt = '' } = {}) {
  const raw = Array.isArray(list) ? list : [];
  const memories = raw.map((m, i) => {
    const c = cleanMemory(m, i, now);
    if (!c) return null;
    if (m?.pinned === undefined) c.pinned = true;
    return c;
  }).filter(Boolean).slice(-MAX_MEMORIES);
  const map = new Map();
  for (const m of memories) {
    m.id = 'm_' + hash([salt, '|profile|', m.text, '|', m.turn, '|', m.index].join(''), 10);
    if (m.oldId && !map.has(m.oldId)) map.set(m.oldId, m.id);
  }
  for (const m of memories) {
    const oldSupersedes = m.supersedes;
    const oldSupersededBy = m.supersededBy;
    m.supersedes = map.get(oldSupersedes) || '';
    m.supersededBy = map.get(oldSupersededBy) || '';
    if (m.supersededBy) m.status = 'superseded';
    m.tier = 'profile';
    m.layer = 'profile';
    m.scope = 'global';
    m.validUntil = null;
    m.expiresAt = null;
    m.ttlMs = 0;
    delete m.oldId;
    delete m.index;
  }
  return memories;
}

function portableOf (ws, now) {
  return {
    name: String(ws?.name ?? ''),
    description: String(ws?.description ?? ''),
    keywords: Array.isArray(ws?.keywords) ? ws.keywords : [],
    summary: String(ws?.summary ?? ''),
    rounds: Number(ws?.rounds) || 0,
    turns: (ws?.turns ?? []).map(t => ({ role: t.role, text: t.text, turn: t.turn, round: t.round, at: t.at })),
    memories: (ws?.memories ?? []).map(m => ({
      id: m.id, type: m.type, text: m.text, keys: m.keys ?? [], entities: m.entities ?? [],
      importance: m.importance, turn: m.turn, at: m.at, status: m.status, source: m.source,
      tier: m.tier, scope: m.scope, pinned: m.pinned, validUntil: m.validUntil, expiresAt: m.expiresAt,
      ttlMs: m.ttlMs, createdAt: m.createdAt, updatedAt: m.updatedAt, lastUsedAt: m.lastUsedAt,
      supersedes: m.supersedes ?? '', supersededBy: m.supersededBy ?? '',
    })),
    exemplars: ws?.exemplars ?? [],
    policy: ws?.policy ?? undefined,
    exportedAt: new Date(now).toISOString(),
  };
}

export function toJson (workspaces, { now = Date.now(), profile = [] } = {}) {
  const list = (Array.isArray(workspaces) ? workspaces : [workspaces]).filter(Boolean);
  return JSON.stringify({
    format: PORTABLE_FORMAT,
    version: PORTABLE_VERSION,
    exportedAt: new Date(now).toISOString(),
    workspaces: list.map(ws => portableOf(ws, now)),
    profile: (Array.isArray(profile) ? profile : []).map((m, i) => ({ ...cleanMemory(m, i, now), id: String(m?.id ?? '') })),
  }, null, 2);
}

function textBlock (value) {
  return String(value ?? '').replace(/\r\n/g, '\n').split('\n').map(line => '  ' + line).join('\n');
}

function markdownOne (ws, now) {
  const lines = [
    '# 工作区：' + String(ws?.name ?? ''),
    '',
    '- 范围：' + String(ws?.description ?? ''),
    '- 关键词：' + (Array.isArray(ws?.keywords) ? ws.keywords.join('、') : ''),
    '- 摘要：' + String(ws?.summary ?? ''),
    '- 轮次：' + (Number(ws?.rounds) || 0),
    '- 导出时间：' + new Date(now).toISOString(),
    '',
  ];
  lines.push('## 记忆', '');
  const mems = Array.isArray(ws?.memories) ? ws.memories : [];
  if (!mems.length) lines.push('（无）', '');
  mems.forEach((m, i) => {
    lines.push('### 记忆 ' + (i + 1), '');
    lines.push('- 类型：' + String(m.type ?? 'fact'));
    lines.push('- 层级：' + String(m.tier ?? 'durable'));
    lines.push('- 状态：' + String(m.status ?? 'active'));
    lines.push('- 作用域：' + String(m.scope ?? 'workspace'));
    lines.push('- 置顶：' + (m.pinned ? '是' : '否'));
    lines.push('- 轮次：' + (Number(m.turn) || 0));
    lines.push('- 关键词：' + (Array.isArray(m.keys) ? m.keys.join('、') : ''));
    lines.push('- 时间：' + (m.at ? new Date(Number(m.at)).toISOString() : ''));
    if (m.supersedes) lines.push('- 取代：' + String(m.supersedes));
    if (m.supersededBy) lines.push('- 被取代：' + String(m.supersededBy));
    lines.push('- 文本：');
    lines.push(textBlock(m.text));
    lines.push('');
  });
  lines.push('## 对话', '');
  const turns = Array.isArray(ws?.turns) ? ws.turns : [];
  if (!turns.length) lines.push('（无）', '');
  turns.forEach((t, i) => {
    lines.push('### 对话 ' + (i + 1), '');
    lines.push('- 角色：' + (t.role === 'assistant' ? 'assistant' : 'user'));
    lines.push('- 轮次：' + (Number(t.turn) || 0));
    lines.push('- 时间：' + (t.at ? new Date(Number(t.at)).toISOString() : ''));
    lines.push('- 文本：');
    lines.push(textBlock(t.text));
    lines.push('');
  });
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
}

function markdownProfile (profile, now) {
  const lines = [
    '# 全局档案',
    '',
    '- 导出时间：' + new Date(now).toISOString(),
    '',
    '## 记忆',
    '',
  ];
  const mems = Array.isArray(profile) ? profile : [];
  if (!mems.length) lines.push('（无）', '');
  mems.forEach((m, i) => {
    lines.push('### 记忆 ' + (i + 1), '');
    lines.push('- 类型：' + String(m.type ?? 'fact'));
    lines.push('- 层级：profile');
    lines.push('- 状态：' + String(m.status ?? 'active'));
    lines.push('- 作用域：global');
    lines.push('- 置顶：' + (m.pinned === false ? '否' : '是'));
    lines.push('- 轮次：' + (Number(m.turn) || 0));
    lines.push('- 关键词：' + (Array.isArray(m.keys) ? m.keys.join('、') : ''));
    lines.push('- 时间：' + (m.at ? new Date(Number(m.at)).toISOString() : ''));
    if (m.supersedes) lines.push('- 取代：' + String(m.supersedes));
    if (m.supersededBy) lines.push('- 被取代：' + String(m.supersededBy));
    lines.push('- 文本：');
    lines.push(textBlock(m.text));
    lines.push('');
  });
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
}

export function toMarkdown (workspaces, { now = Date.now(), profile = [] } = {}) {
  const list = (Array.isArray(workspaces) ? workspaces : [workspaces]).filter(Boolean);
  const docs = list.map(ws => markdownOne(ws, now));
  if (Array.isArray(profile) && profile.length) docs.push(markdownProfile(profile, now));
  return docs.join('\n---\n\n');
}

function parseMarkdown (text, { now, salt } = {}) {
  const docs = [];
  let doc = null;
  let section = '';
  let item = null;

  const flushItem = () => {
    if (!doc || !item) { item = null; return; }
    const fields = item.fields;
    const body = item.text.join('\n').replace(/\s+$/u, '');
    const base = {
      type: fields['类型'], tier: fields['层级'], status: fields['状态'], scope: fields['作用域'],
      pinned: fields['置顶'], turn: fields['轮次'], keys: fields['关键词'], at: fields['时间'],
      text: body || fields['文本'],
    };
    if (item.kind === 'memory') {
      base.supersedes = fields['取代'];
      base.supersededBy = fields['被取代'];
      doc.memories.push(base);
    } else {
      base.role = fields['角色'];
      doc.turns.push(base);
    }
    item = null;
  };
  const flushDoc = () => {
    flushItem();
    if (doc) docs.push(doc);
    doc = null;
    section = '';
  };

  for (const raw of String(text ?? '').split(/\r?\n/u)) {
    const line = raw.replace(/\s+$/u, '');
    const head = line.match(/^#\s*工作区[：:]\s*(.*)$/u);
    if (head) {
      flushDoc();
      doc = { name: head[1].trim(), description: '', keywords: '', summary: '', rounds: 0, turns: [], memories: [], profile: false };
      continue;
    }
    if (/^#\s*全局档案\s*$/u.test(line)) {
      flushDoc();
      doc = { name: '全局档案', description: '', keywords: '', summary: '', rounds: 0, turns: [], memories: [], profile: true };
      continue;
    }
    if (!doc) continue;
    const sect = line.match(/^##\s*(记忆|对话)/u);
    if (sect) { flushItem(); section = sect[1]; continue; }
    const sub = line.match(/^###\s*(记忆|对话)/u);
    if (sub) {
      flushItem();
      item = { kind: sub[1] === '记忆' ? 'memory' : 'turn', fields: {}, text: [], inText: false };
      continue;
    }
    const fm = line.match(/^-\s*([^：:]+)[：:]\s*(.*)$/u);
    if (item) {
      if (fm) {
        const key = fm[1].trim();
        if (key === '文本') { item.inText = true; item.text = fm[2] ? [fm[2]] : []; } else { item.fields[key] = fm[2]; }
        continue;
      }
      if (item.inText) item.text.push(line.startsWith('  ') ? line.slice(2) : line);
      continue;
    }
    if (fm && section === '') {
      const key = fm[1].trim();
      if (key === '范围') doc.description = fm[2];
      if (key === '关键词') doc.keywords = fm[2];
      if (key === '摘要') doc.summary = fm[2];
      if (key === '轮次') doc.rounds = numOf(fm[2]);
    }
  }
  flushDoc();
  return docs;
}

export function parsePortable (text, { now = Date.now(), salt = '' } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return { workspaces: [], error: '内容为空' };
  let list = [];
  let profileRaw = [];
  if (raw.startsWith('{') || raw.startsWith('[')) {
    let data;
    try { data = JSON.parse(raw); } catch (error) { return { workspaces: [], profile: [], error: 'JSON 解析失败：' + String(error?.message ?? error) }; }
    if (Array.isArray(data)) list = data;
    else {
      if (Array.isArray(data?.workspaces)) list = data.workspaces;
      else if (data?.workspace) list = [data.workspace];
      else if (data?.name) list = [data];
      if (Array.isArray(data?.profile)) profileRaw = data.profile;
      else if (Array.isArray(data?.profile?.memories)) profileRaw = data.profile.memories;
    }
  } else {
    const docs = parseMarkdown(raw, { now, salt });
    profileRaw = docs.filter(d => d.profile).flatMap(d => d.memories ?? []);
    list = docs.filter(d => !d.profile);
  }
  const workspaces = list.map((w, i) => normalizeWorkspace(w, { now, salt, index: i })).filter(w => w.turns.length || w.memories.length || w.name);
  const profile = normalizeProfile(profileRaw, { now, salt });
  if (!workspaces.length && !profile.length) return { workspaces: [], profile: [], error: '没有解析出工作区或全局档案；Markdown 需要 "# 工作区：名称" 标题' };
  return { workspaces, profile, error: '' };
}

export { normalizeWorkspace };
