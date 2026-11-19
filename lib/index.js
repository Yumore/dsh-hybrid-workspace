// dsh-hybrid-workspace v2：单聊天框 + 工作区路由 + 结构化记忆 + 预算化上下文。
// 纯 ESM、零 DSH 内部 import，避免加载期依赖；面板走宿主 webServer。

import { homedir } from 'node:os';
import { join } from 'node:path';
import { clipped, hash, heuristicName } from './text.js';
import * as store from './store.js';
import * as router from './router.js';
import * as memory from './memory.js';
import * as context from './context.js';
import { mountRoutes } from './ui.js';

export const name = 'hybrid-workspace';
export const inject = ['systemPrompt'];

export const DEFAULTS = {
  enabled: true,
  mode: 'hybrid',              // hybrid | lexical | llm
  autoCreate: true,
  panelPath: '/hybrid-workspace',
  debug: true,
  stateDir: '',                // 空 = $DSH_HOME/hybrid-workspace-v2
  maxWorkspaces: 60,
  archiveKeep: 20,
  routeMinScore: 0.1,
  routeAccept: 0.48,
  sameTopicAccept: 0.3,
  routeMargin: 0.1,
  switchMargin: 0.14,
  strongSwitch: 0.5,
  strongMargin: 0.3,
  unseenPenalty: 0.15,
  pendingSwitch: 2,
  shortSticky: 12,
  exemplarKeep: 16,
  nameMaxChars: 18,
  keywordMax: 8,
  keepTurns: 12,
  compactAt: 24,
  turnMaxChars: 600,
  memoryEnabled: true,
  memoryKeep: 300,
  memoryInject: 8,
  memoryMaxChars: 1100,
  contextMaxChars: 2400,
  recentTurns: 4,
  llmJudge: true,
  llmMaxTokens: 280,
  sectionOrder: 9000,
  disableProcessHook: false,
};

function deepText (node, out = [], depth = 0, seen = new Set()) {
  if (node == null || depth > 7) return out;
  if (typeof node === 'string') return out;
  if (Array.isArray(node)) { for (const v of node) deepText(v, out, depth + 1, seen); return out; }
  if (typeof node !== 'object') return out;
  if (seen.has(node)) return out;
  seen.add(node);
  if (typeof node.text === 'string' && (node.type === 'text' || node.type === 'text-delta' || node.type === 'text-start' || !node.type)) {
    out.push(node.text);
    return out;
  }
  for (const k of Object.keys(node)) {
    if (k === 'usage' || k === 'meta' || k === 'tokens' || k === 'signature') continue;
    deepText(node[k], out, depth + 1, seen);
  }
  return out;
}

function messageText (message) {
  if (typeof message === 'string') return message;
  if (typeof message?.content === 'string') return message.content;
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const parts = blocks.map(b => (b && typeof b.text === 'string' ? b.text : '')).filter(Boolean);
  if (parts.length) return parts.join('\n');
  return deepText(message).join('');
}

function lastUserText (messages) {
  const list = (messages ?? []).filter(m => m?.source?.kind === 'user' || m?.role === 'user');
  const last = list[list.length - 1];
  return last ? messageText(last).trim() : '';
}

export function apply (ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config ?? {}) };
  if (cfg.enabled === false) return;

  const dshHome = process.env.DSH_HOME || join(process.env.HOME || homedir(), '.dsh');
  const dir = cfg.stateDir ? String(cfg.stateDir) : join(dshHome, 'hybrid-workspace-v2');
  const statePath = join(dir, 'state.json');
  const decisionsPath = join(dir, 'decisions.log');
  const tracePath = join(dir, 'trace.jsonl');

  let state = store.normalizeState(null);
  let loaded = false;
  let loading = null;
  let saveTimer = null;
  let traces = [];
  const seenSteps = new Set();
  const lastAssistant = new Map();

  const log = (msg) => {
    try { void store.appendJsonl(decisionsPath, { at: Date.now(), msg: String(msg) }); } catch { /* 日志失败不影响对话 */ }
    try { ctx.logger?.info?.('[hybrid-workspace] ' + msg); } catch { /* 无 logger */ }
    if (cfg.debug && ctx.logger?.debug) { try { ctx.logger.debug('[hybrid-workspace] ' + msg); } catch { /* ignore */ } }
  };

  const touch = () => { state.updatedAt = Date.now(); };

  const saveNow = async () => {
    if (!loaded) return;
    try { await store.saveState(statePath, state); } catch (error) { log('save fail: ' + String(error?.message ?? error)); }
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; void saveNow(); }, 300);
    saveTimer.unref?.();
  };

  const flush = async () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    await saveNow();
  };

  const ensureLoaded = async () => {
    if (loaded) return state;
    if (loading) return loading;
    loading = (async () => {
      const r = await store.loadOrMigrate({ dshHome, log });
      state = r.state;
      traces = await store.readJsonl(tracePath, 30);
      loaded = true;
      if (r.migratedFrom) log('migrated from ' + r.migratedFrom);
      return state;
    })();
    try { return await loading; } finally { loading = null; }
  };

  const byId = (id) => state.workspaces.find(w => w.id === id);
  const sessionOf = (sid) => {
    if (!state.sessions[sid]) {
      state.sessions[sid] = { workspaceId: null, routedAt: 0, pending: null, lastQuery: '', lastTurn: 0, recent: [] };
    }
    return state.sessions[sid];
  };

  const trace = (entry) => {
    const row = { at: Date.now(), ...entry };
    traces.push(row);
    if (traces.length > 50) traces = traces.slice(-50);
    try { void store.appendJsonl(tracePath, row); } catch { /* ignore */ }
  };

  function createWorkspace (text, suggestedName) {
    const ws = router.createWorkspace(text, { now: Date.now(), nameMaxChars: cfg.nameMaxChars, keywordMax: cfg.keywordMax });
    if (suggestedName) ws.name = clipped(suggestedName, 40);
    state.workspaces.push(ws);
    // 满额淘汰最久未用，先归档快照，绝不静默丢。
    if (state.workspaces.length > cfg.maxWorkspaces) {
      const dead = state.workspaces
        .filter(w => w.id !== ws.id)
        .sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0))[0];
      if (dead) archiveWorkspace(dead, 'maxWorkspaces');
    }
    return ws;
  }

  // 注入块的实际占用：优先用最近绑定会话的最后一条消息，这样面板看到的就是下一轮会注入的内容。
  function usageOf (ws) {
    const bound = Object.values(state.sessions)
      .filter(s => s.workspaceId === ws.id)
      .sort((a, b) => (b.routedAt ?? 0) - (a.routedAt ?? 0));
    const query = bound.map(s => s.lastQuery).find(Boolean) ||
      [...(ws.turns ?? [])].reverse().find(t => t.role === 'user')?.text || '';
    return context.contextUsage(ws, query, cfg);
  }

  // 归档是软删除：保留快照、解绑会话，面板可恢复。
  function archiveWorkspace (ws, reason = 'manual') {
    const usage = usageOf(ws);
    state.workspaces = state.workspaces.filter(w => w.id !== ws.id);
    state.archives.unshift({
      id: ws.id, name: ws.name, description: ws.description, keywords: ws.keywords,
      summary: ws.summary, turns: (ws.turns ?? []).slice(-8), memories: (ws.memories ?? []).slice(-20),
      rounds: ws.rounds ?? 0, archivedAt: Date.now(), reason,
      contextChars: usage.chars, contextTokens: usage.tokens,
    });
    if (state.archives.length > cfg.archiveKeep) state.archives = state.archives.slice(0, cfg.archiveKeep);
    for (const s of Object.values(state.sessions)) {
      if (s.workspaceId !== ws.id) continue;
      s.workspaceId = null; s.pending = null; s.lastQuery = '';
    }
    log('archive ws ' + ws.id + ' (' + ws.name + ') reason=' + reason);
    touch();
    return usage;
  }

  function appendTurn (ws, role, text, turn) {
    const t = clipped(text, cfg.turnMaxChars);
    if (!t) return;
    if (!Array.isArray(ws.turns)) ws.turns = [];
    ws.turns.push({ role, text: t, at: Date.now(), turn: Number(turn) || ws.rounds || 0 });
    if (ws.turns.length > 200) ws.turns = ws.turns.slice(-200);
  }

  function bind (sid, wsId, how) {
    const s = sessionOf(sid);
    s.workspaceId = wsId;
    s.routedAt = Date.now();
    s.pending = null;
    s.recent.push({ wsId, at: Date.now(), how });
    if (s.recent.length > 12) s.recent = s.recent.slice(-12);
  }

  async function classify (agent, text, session, signal) {
    if (!cfg.llmJudge || cfg.mode === 'lexical') return null;
    const target = agent?.session?.requestHeader?.()?.config;
    if (!target?.provider || !target?.model) return null;
    const current = byId(session.workspaceId);
    const catalog = state.workspaces
      .slice()
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, 20)
      .map(w => ({
        id: w.id,
        name: w.name,
        scope: clipped(w.description, 100),
        keywords: (w.keywords ?? []).slice(0, 6),
        examples: (w.exemplars ?? []).slice(-3).map(e => clipped(e.text ?? e, 80)),
        recent: (w.memories ?? []).filter(m => m.status === 'active' && m.type === 'decision').slice(-2).map(m => clipped(m.text, 90)),
      }));
    if (!catalog.length) return null;

    const sys = [
      '你是消息路由器。判断用户的新消息应该归入哪个工作区，或新建，或留在当前区。',
      '只输出一行 JSON，不要解释、不要代码块：',
      '{"id":"<工作区id | new | stay>","name":"<仅 id=new 时给 2-8 字工作区名>","confidence":0~1,"reason":"<=20字"}',
      '规则：能延续某工作区的范围/例子/记忆就选它；确实是全新主题才 new；含义模糊、指代（"继续""那个""改一下"）优先 stay 当前区。',
    ].join('\n');
    const recent = (current?.turns ?? []).slice(-4).map(t => (t.role === 'user' ? '用户：' : '助手：') + clipped(t.text, 100)).join('\n');
    const user = [
      '工作区清单：',
      JSON.stringify(catalog, null, 1),
      '当前工作区：' + (current ? current.id + ' / ' + current.name : '无'),
      recent ? '最近对话：\n' + recent : '',
      '用户新消息：',
      clipped(text, 700),
    ].filter(Boolean).join('\n');

    let out = '';
    try {
      state.llmCalls = (state.llmCalls ?? 0) + 1;
      for await (const chunk of ctx.llm.stream({
        provider: target.provider,
        model: target.model,
        messages: [
          { role: 'system', content: [{ type: 'text', text: sys }] },
          { role: 'user', content: [{ type: 'text', text: user }] },
        ],
        maxTokens: cfg.llmMaxTokens,
        sessionId: agent?.session?.id,
        purpose: 'hybrid-workspace-route',
        ...(signal ? { signal } : {}),
      })) {
        if (typeof chunk?.text === 'string') out += chunk.text;
        else if (typeof chunk?.delta?.text === 'string') out += chunk.delta.text;
      }
    } catch (error) {
      log('llm route fail: ' + String(error?.message ?? error));
      return null;
    }
    const match = out.match(/\{[\s\S]*\}/u);
    if (!match) { log('llm route unparsable: ' + clipped(out, 120)); return null; }
    try {
      const p = JSON.parse(match[0]);
      return {
        id: typeof p.id === 'string' ? p.id : null,
        name: typeof p.name === 'string' ? p.name : null,
        confidence: typeof p.confidence === 'number' ? p.confidence : 0.5,
        reason: typeof p.reason === 'string' ? p.reason : '',
      };
    } catch { return null; }
  }

  async function routeMessage (agent, text, turn, signal) {
    const sid = agent?.session?.id ?? 'unknown';
    const session = sessionOf(sid);
    let decision = router.decideRoute({
      workspaces: state.workspaces,
      session,
      text,
      cfg: {
        routeMinScore: cfg.routeMinScore, routeAccept: cfg.routeAccept, sameTopicAccept: cfg.sameTopicAccept,
        routeMargin: cfg.routeMargin, switchMargin: cfg.switchMargin, strongSwitch: cfg.strongSwitch,
        strongMargin: cfg.strongMargin, unseenPenalty: cfg.unseenPenalty,
        pendingSwitch: cfg.pendingSwitch, shortSticky: cfg.shortSticky,
      },
    });
    let usedLlm = false;
    if (decision.action === 'ask-llm' || (cfg.mode === 'llm' && state.workspaces.length)) {
      const judged = await classify(agent, text, session, signal);
      if (judged) {
        usedLlm = true;
        state.llmCalls = state.llmCalls ?? 0;
        if (judged.id === 'new' && judged.confidence >= 0.6) {
          decision = { action: 'new', how: 'llm-new', name: judged.name, confidence: judged.confidence, scores: decision.scores ?? [] };
        } else if (judged.id === 'stay') {
          decision = { action: 'stay', wsId: session.workspaceId, how: 'llm-stay', confidence: judged.confidence, scores: decision.scores ?? [], pending: null };
        } else {
          const target = byId(judged.id);
          if (target && judged.confidence >= 0.5) {
            decision = { action: 'route', wsId: target.id, ws: target, how: 'llm-route', confidence: judged.confidence, scores: decision.scores ?? [], pending: null };
          } else if (!session.workspaceId && judged.confidence >= 0.6) {
            decision = { action: 'new', how: 'llm-new', name: judged.name, confidence: judged.confidence, scores: decision.scores ?? [] };
          } else {
            decision = { action: 'stay', wsId: session.workspaceId, how: 'llm-uncertain', confidence: judged.confidence, scores: decision.scores ?? [], pending: null };
          }
        }
      } else if (decision.action === 'ask-llm') {
        decision = session.workspaceId
          ? { action: 'stay', wsId: session.workspaceId, how: 'llm-fail', scores: decision.scores ?? [], pending: null }
          : { action: 'new', how: 'llm-fail', scores: decision.scores ?? [] };
      }
    }

    let ws = null;
    // autoCreate=false 时不能把消息丢掉：有当前区就留在当前区记下来，
    // 没有任何区才真的无从归属。否则关闭自动建区会让后续消息完全不进上下文。
    if (decision.action === 'new' && !cfg.autoCreate) {
      const cur = byId(session.workspaceId);
      if (!cur) { log('new topic but autoCreate=false and no current workspace'); return null; }
      log('new topic but autoCreate=false: stay ' + cur.id);
      decision = { action: 'stay', wsId: cur.id, how: 'auto-create-off', scores: decision.scores ?? [] };
    }
    if (decision.action === 'new') {
      ws = createWorkspace(text, decision.name || '');
      session.workspaceId = ws.id;
      session.routedAt = Date.now();
      session.pending = null;
      ws.hits = (ws.hits ?? 0) + 1;
      log('new ws ' + ws.id + ' (' + ws.name + ') how=' + decision.how);
    } else if (decision.action === 'route' && decision.ws) {
      ws = decision.ws;
      session.workspaceId = ws.id;
      session.routedAt = Date.now();
      session.pending = null;
      ws.hits = (ws.hits ?? 0) + 1;
      router.addExemplar(ws, text, { exemplarKeep: cfg.exemplarKeep });
      log('route ' + ws.id + ' how=' + decision.how);
    } else {
      ws = byId(session.workspaceId);
      if (decision.pending) session.pending = decision.pending;
      else if (decision.how !== 'pending-switch') session.pending = null;
      if (ws) ws.hits = (ws.hits ?? 0) + 1;
    }
    if (!ws) {
      session.lastQuery = text;
      session.lastTurn = turn;
      touch(); scheduleSave();
      trace({ sessionId: sid, text: clipped(text, 100), wsId: null, name: null, how: decision.how, scores: decision.scores, llm: usedLlm });
      return null;
    }

    ws.rounds = (ws.rounds ?? 0) + 1;
    appendTurn(ws, 'user', text, ws.rounds);
    if (cfg.memoryEnabled) {
      try { memory.rememberText(ws, text, { role: 'user', turn: ws.rounds, max: 3, cfg }); } catch (error) { log('memory user fail: ' + String(error?.message ?? error)); }
    }
    memory.compactTurns(ws, cfg);
    session.lastQuery = text;
    session.lastTurn = turn;
    session.recent.push({ wsId: ws.id, at: Date.now(), how: decision.how });
    if (session.recent.length > 12) session.recent = session.recent.slice(-12);
    ws.updatedAt = Date.now();
    touch(); scheduleSave();
    trace({ sessionId: sid, text: clipped(text, 100), wsId: ws.id, name: ws.name, how: decision.how, scores: decision.scores, llm: usedLlm });
    return ws;
  }

  async function onAssistant (session, event) {
    if (!event || event.type !== 'assistant/message') return;
    const sid = typeof session === 'string' ? session : session?.id;
    if (!sid) return;
    const s = state.sessions[sid];
    if (!s?.workspaceId) return;
    const ws = byId(s.workspaceId);
    if (!ws) return;
    const payload = event.data?.message ?? event.data;
    let text = messageText(payload).trim();
    if (!text) text = deepText(event.data).join('').trim();
    if (!text) return;
    const key = sid + ':' + hash(text, 10);
    const last = lastAssistant.get(sid);
    if (last && last.key === key && Date.now() - last.at < 5000) return;
    lastAssistant.set(sid, { key, at: Date.now() });
    if (lastAssistant.size > 50) lastAssistant.delete(lastAssistant.keys().next().value);
    appendTurn(ws, 'assistant', text, ws.rounds);
    if (cfg.memoryEnabled) {
      try { memory.rememberText(ws, text, { role: 'assistant', turn: ws.rounds, max: 3, cfg }); } catch (error) { log('memory assistant fail: ' + String(error?.message ?? error)); }
    }
    memory.compactTurns(ws, cfg);
    ws.updatedAt = Date.now();
    touch(); scheduleSave();
  }

  async function snapshot () {
    await ensureLoaded();
    const workspaces = state.workspaces.slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).map(w => {
      const usage = usageOf(w);
      return {
        id: w.id, name: w.name, description: w.description, keywords: w.keywords, summary: w.summary,
        rounds: w.rounds, hits: w.hits, createdAt: w.createdAt, updatedAt: w.updatedAt,
        sessions: Object.values(state.sessions).filter(s => s.workspaceId === w.id).length,
        contextChars: usage.chars, contextTokens: usage.tokens, contextMaxChars: usage.max, contextPct: usage.pct,
        memories: (w.memories ?? []).slice().sort((a, b) => (b.status === 'active') - (a.status === 'active') || (b.turn ?? 0) - (a.turn ?? 0)).slice(0, 80),
        memoryStats: memory.stats(w),
        exemplars: (w.exemplars ?? []).slice(-10),
        turns: (w.turns ?? []).slice(-8),
      };
    });
    return {
      workspaces,
      sessions: Object.entries(state.sessions).map(([sessionId, s]) => ({ sessionId, workspaceId: s.workspaceId, lastAt: s.routedAt, lastQuery: clipped(s.lastQuery, 80) })),
      archives: state.archives,
      trace: traces.slice(-30),
      stats: {
        workspaces: state.workspaces.length,
        memories: state.workspaces.reduce((n, w) => n + (w.memories ?? []).filter(m => m.status === 'active').length, 0),
        sessions: Object.values(state.sessions).filter(s => s.workspaceId).length,
        llmCalls: state.llmCalls ?? 0,
        contextChars: workspaces.reduce((n, w) => n + (w.contextChars ?? 0), 0),
        contextTokens: workspaces.reduce((n, w) => n + (w.contextTokens ?? 0), 0),
        contextMaxChars: cfg.contextMaxChars,
      },
    };
  }

  function resolveWs (token) {
    const t = String(token ?? '').trim();
    if (!t) return null;
    return byId(t) || state.workspaces.find(w => w.name === t) || state.workspaces.find(w => w.name.toLowerCase() === t.toLowerCase()) ||
      state.workspaces.find(w => w.name.includes(t)) || state.workspaces.find(w => w.id.includes(t));
  }

  async function applyOp (payload) {
    await ensureLoaded();
    const op = String(payload?.op ?? '');
    if (op === 'restore') {
      const entry = state.archives.find(a => a.id === String(payload?.id ?? ''));
      if (!entry) return { error: '归档不存在：' + String(payload?.id ?? '') };
      const ws = createWorkspace(entry.name + ' ' + (entry.description ?? ''), entry.name);
      ws.description = entry.description ?? '';
      ws.keywords = entry.keywords ?? ws.keywords;
      ws.summary = entry.summary ?? '';
      ws.turns = (entry.turns ?? []).map(t => ({ ...t }));
      ws.memories = (entry.memories ?? []).map(m => ({ ...m, status: 'active' }));
      ws.rounds = entry.rounds ?? 0;
      state.archives = state.archives.filter(a => a !== entry);
      log('restore ws ' + entry.id + ' -> ' + ws.id);
      touch(); await flush();
      return { ok: true, id: ws.id };
    }
    if (op === 'dropArchive') {
      const before = state.archives.length;
      state.archives = state.archives.filter(a => a.id !== String(payload?.id ?? ''));
      if (state.archives.length === before) return { error: '归档不存在：' + String(payload?.id ?? '') };
      log('drop archive ' + String(payload?.id ?? ''));
      touch(); await flush();
      return { ok: true };
    }
    if (op === 'list') return { ok: true, ...(await snapshot()) };
    const ws = payload?.id ? byId(String(payload.id)) : null;
    if (!ws) return { error: '工作区不存在：' + String(payload?.id ?? '') };
    if (op === 'archive') {
      const freed = archiveWorkspace(ws, 'manual');
      await flush();
      return { ok: true, archived: true, freed };
    }
    if (op === 'rename') {
      const next = clipped(payload.name, 60);
      if (!next) return { error: '名称不能为空' };
      log('rename ' + ws.id + ': ' + ws.name + ' -> ' + next);
      ws.name = next;
    } else if (op === 'describe') {
      ws.description = clipped(payload.description, 300);
      log('describe ' + ws.id + ' -> ' + ws.description);
    } else if (op === 'clear') {
      ws.turns = []; ws.memories = []; ws.summary = ''; ws.rounds = 0; ws.exemplars = [];
      log('clear ' + ws.id);
    } else if (op === 'delete') {
      const freed = usageOf(ws);
      state.workspaces = state.workspaces.filter(w => w.id !== ws.id);
      state.archives = state.archives.filter(a => a.id !== ws.id);
      for (const s of Object.values(state.sessions)) {
        if (s.workspaceId !== ws.id) continue;
        s.workspaceId = null; s.pending = null; s.lastQuery = '';
        s.recent = (s.recent ?? []).filter(r => r.wsId !== ws.id);
      }
      log('delete ws ' + ws.id + ' (' + ws.name + ') freed=' + freed.chars + ' chars');
      touch(); await flush();
      return { ok: true, freed };
    } else if (op === 'merge') {
      const into = resolveWs(payload.into);
      if (!into) return { error: '目标工作区不存在：' + String(payload.into ?? '') };
      if (into.id === ws.id) return { error: '不能合并到自己' };
      router.mergeWorkspace(ws, into);
      state.workspaces = state.workspaces.filter(w => w.id !== ws.id);
      for (const s of Object.values(state.sessions)) if (s.workspaceId === ws.id) s.workspaceId = into.id;
      log('merge ' + ws.id + ' -> ' + into.id);
    } else {
      return { error: '未知操作：' + op };
    }
    ws.updatedAt = Date.now();
    touch(); await flush();
    return { ok: true };
  }

  /* ── 钩子 ── */

  ctx.on('agent/pre-step', async (payload, next) => {
    try {
      await ensureLoaded();
      const agent = payload?.agent;
      const text = lastUserText(payload?.messages);
      if (!text) return next();
      const sid = agent?.session?.id ?? 'unknown';
      const turn = payload?.turn ?? 0;
      const key = sid + ':' + turn + ':' + hash(text, 8);
      if (seenSteps.has(key)) return next();
      seenSteps.add(key);
      if (seenSteps.size > 2000) seenSteps.delete(seenSteps.values().next().value);
      await routeMessage(agent, text, turn, payload?.signal);
    } catch (error) {
      log('pre-step fail: ' + String(error?.message ?? error));
    }
    return next();
  });

  ctx.on('session/event', (session, event) => {
    void ensureLoaded().then(() => onAssistant(session, event)).catch(error => log('assistant fail: ' + String(error?.message ?? error)));
  });

  // 系统提示词：随当前绑定工作区与最后一条用户消息动态变化，原地替换。
  let order = cfg.sectionOrder;
  try {
    const resolved = ctx.systemPrompt.getSectionOrder?.('HYBRID_WORKSPACE');
    if (typeof resolved === 'number') order = resolved;
  } catch { /* 未注册：用数字顺序 */ }

  ctx.systemPrompt.section({
    name: 'hybrid-workspace',
    order,
    interpolate: false,
    text: (contextObj) => {
      const sid = contextObj?.agent?.session?.id;
      if (!sid || !loaded) return '';
      const s = state.sessions[sid];
      const ws = s?.workspaceId ? byId(s.workspaceId) : null;
      if (!ws) return '';
      return context.buildContext(ws, s.lastQuery ?? '', {
        contextMaxChars: cfg.contextMaxChars,
        memoryInject: cfg.memoryInject,
        recentTurns: cfg.recentTurns,
      });
    },
  });

  /* ── 面板 ── */
  if (ctx.webServer) {
    try {
      ctx.inject(['webServer'], (scoped) => {
        scoped.effect(() => mountRoutes(scoped, {
          prefix: cfg.panelPath,
          snapshot: async () => { await ensureLoaded(); return snapshot(); },
          mutate: async (payload) => { await ensureLoaded(); return applyOp(payload); },
        }));
        log('panel mounted at ' + cfg.panelPath + '/');
      });
    } catch (error) {
      log('panel mount fail: ' + String(error?.message ?? error));
    }
  }

  ctx.on('dispose', () => { void flush(); });
  if (!cfg.disableProcessHook) {
    process.once('beforeExit', () => { void flush(); });
  }

  void ensureLoaded().catch(error => log('load fail: ' + String(error?.message ?? error)));

  return {
    // 测试/调试入口：只读快照与手动 flush，不暴露可变状态。
    snapshot,
    flush,
    get state () { return state; },
  };
}
