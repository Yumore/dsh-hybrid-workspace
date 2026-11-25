// P2 执行器：把收件箱任务派给一个独立的 DSH 子会话。
// 这里只用宿主通过 ctx.get 暴露的服务，不 import 任何 DSH 内部包；
// 服务缺失或版本不兼容时明确失败，绝不把模拟完成写成真实结果。

import { randomUUID } from 'node:crypto';
import { clipped } from './text.js';

const PLUGIN_SOURCE = { kind: 'plugin:dsh-hybrid-workspace' };
const USER_SOURCE = { kind: 'user' };

export class ExecutorUnavailableError extends Error {
  constructor (message) {
    super(message);
    this.name = 'ExecutorUnavailableError';
    this.code = 'executor-unavailable';
  }
}

function service (ctx, name) {
  try {
    const get = ctx && typeof ctx.get === 'function' ? ctx.get.bind(ctx) : null;
    return get ? (get(name) ?? null) : null;
  } catch { return null; }
}

// DSH 24 注册名是 approval；兼容旧版/别名的 userApproval。
function approvalService (ctx) {
  for (const name of ['approval', 'userApproval', 'user-approval']) {
    const found = service(ctx, name);
    if (found && typeof found.setPolicy === 'function') return found;
  }
  return null;
}

function rootAgent (agent) {
  if (!agent?.session) return false;
  const header = agent.session.header ?? {};
  const meta = header.meta ?? agent.session.meta ?? agent.session.metadata ?? {};
  if (header.origin === 'subagent' || meta?.origin === 'subagent') return false;
  if (meta?.parentSession || meta?.parentSessionId) return false;
  if (Number(meta?.delegationDepth) > 0) return false;
  return true;
}

// 只探测，不创建：面板每次刷新都会调用，不能有副作用。
export function probeExecutor (ctx) {
  const agents = service(ctx, 'agents');
  const approval = approvalService(ctx);
  const reasons = [];
  if (!agents || typeof agents.create !== 'function') reasons.push('agents 服务未加载');
  else if (typeof agents.list !== 'function') reasons.push('agents.list 不可用');
  if (!approval) reasons.push('approval 服务未加载，无法隔离审批');
  return { available: reasons.length === 0, reason: reasons.join('；'), agents: Boolean(agents), approval: Boolean(approval) };
}

function liveParent (ctx, wsId, sessions) {
  const agents = service(ctx, 'agents');
  if (!agents || typeof agents.create !== 'function') {
    throw new ExecutorUnavailableError('DSH 执行器不可用：agents 服务未加载');
  }
  const live = [];
  if (typeof agents.list === 'function') {
    try {
      for (const agent of agents.list() ?? []) if (rootAgent(agent)) live.push(agent);
    } catch { /* 列不出来时按没有父会话处理 */ }
  }
  const score = (sid) => {
    const s = sessions?.[sid] ?? {};
    return Math.max(Number(s.routedAt) || 0, ...(s.recent ?? []).map(r => Number(r.at) || 0));
  };
  const bound = live.filter(a => {
    const s = sessions?.[a.session.id];
    return s && (s.workspaceId === wsId || (s.activeWorkspaceIds ?? []).includes(wsId));
  }).sort((a, b) => score(b.session.id) - score(a.session.id));
  if (bound.length) return bound[0];
  const anyBound = live.filter(a => sessions?.[a.session.id]?.workspaceId).sort((a, b) => score(b.session.id) - score(a.session.id));
  return anyBound[0] ?? live[0] ?? null;
}

function latestPreset (session) {
  const header = session?.header ?? {};
  if (header.agentPreset) return String(header.agentPreset);
  if (session?.agentPreset) return String(session.agentPreset);
  try {
    const events = session?.snapshotEvents?.() ?? [];
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event?.type !== 'agent-preset/selected') continue;
      const id = event.data?.agentPreset ?? event.data?.id ?? event.data?.preset;
      if (id) return String(id);
    }
  } catch { /* 读取事件失败时用默认预设 */ }
  return undefined;
}

function modelSelection (parent) {
  let current = null;
  try { current = parent?.model?.current?.() ?? null; } catch { /* 回退 options */ }
  let headerConfig = null;
  try { headerConfig = parent?.session?.requestHeader?.()?.config ?? null; } catch { /* 回退 options */ }
  const options = parent?.options ?? {};
  const pick = (a, b, c) => a ?? b ?? c;
  return {
    provider: pick(current?.provider, options.provider, headerConfig?.provider),
    model: pick(current?.model, options.model, headerConfig?.model),
    reasoningEffort: pick(current?.reasoningEffort, options.reasoningEffort),
    maxTokens: pick(current?.maxTokens, options.maxTokens),
  };
}

function userMessage (text, source) {
  return {
    id: 'msg_' + randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source,
  };
}

function messageText (message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('').trim();
}

function eventsOf (agent) {
  try { return agent?.session?.snapshotEvents?.() ?? []; } catch { return []; }
}

function reasonKind (reason) {
  if (typeof reason === 'string') return reason;
  return String(reason?.kind ?? reason?.type ?? reason?.reason ?? '');
}

function reasonError (event) {
  const data = event?.data ?? {};
  const error = data.error ?? data.reason?.error ?? null;
  if (!error) return '';
  if (typeof error === 'string') return error;
  return String(error.message ?? error.code ?? '');
}

const sleep = (ms) => new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref?.(); });

async function waitForTurn (agent, baseline, deadline) {
  for (;;) {
    const events = eventsOf(agent).slice(baseline);
    if (events.some(e => e?.type === 'turn/start' || e?.type === 'turn/end')) return events;
    if (Date.now() >= deadline) return null;
    await sleep(20);
  }
}

async function waitIdle (agent, deadline) {
  const left = Math.max(1, deadline - Date.now());
  let timer = null;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(false), left); timer.unref?.(); });
  try {
    const idle = Promise.resolve().then(() => agent.whenIdle()).then(() => true, () => true);
    return await Promise.race([idle, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 在独立子会话里执行一条收件箱任务。
 * @returns {Promise<{status:'done'|'failed'|'cancelled',result:string,error:string,simulated:boolean,childSessionId:string,parentSessionId:string}>}
 */
export async function runInboxTask ({ ctx, cfg, task, workspace, sessions, signal, onChild, log = () => {} }) {
  const agents = service(ctx, 'agents');
  const approval = approvalService(ctx);
  if (!agents || typeof agents.create !== 'function') {
    throw new ExecutorUnavailableError('DSH 执行器不可用：agents 服务未加载');
  }
  if (!approval) {
    throw new ExecutorUnavailableError('DSH 执行器不可用：approval 服务未加载，无法隔离审批');
  }
  const parent = liveParent(ctx, workspace.id, sessions);
  if (!parent) {
    throw new ExecutorUnavailableError('没有可用的父会话：请先在 DSH 里打开一个会话，或重启桌面端');
  }

  const presets = service(ctx, 'agentPresets');
  const titleService = service(ctx, 'sessionTitle');
  const presetId = latestPreset(parent.session);
  let setup;
  if (presets && typeof presets.mount === 'function') {
    let resolved = null;
    try { resolved = typeof presets.resolve === 'function' ? await presets.resolve(presetId) : null; } catch { resolved = null; }
    const mountId = resolved?.id ?? presetId;
    if (mountId) setup = async agentCtx => { await presets.mount(agentCtx, mountId); };
  }

  const selection = modelSelection(parent);
  const childId = 'session-' + randomUUID();
  const parentHeader = parent.session?.header ?? {};
  const parentMeta = parentHeader.meta ?? parent.session?.meta ?? parent.session?.metadata ?? {};
  const depth = Math.max(0, Number(parentHeader.delegationDepth ?? parentMeta?.delegationDepth) || 0) + 1;
  const agentOptions = { ...(parent.options ?? {}) };
  for (const key of ['provider', 'model', 'reasoningEffort', 'maxTokens']) {
    if (selection[key] !== undefined) agentOptions[key] = selection[key];
  }

  const childMeta = {
    parentSession: parent.session.id,
    isSeeded: false,
    origin: 'subagent',
    delegationDepth: depth,
  };
  const childCwd = parentHeader.cwd ?? parentMeta?.cwd;
  if (childCwd) childMeta.cwd = childCwd;
  if (presetId) childMeta.agentPreset = presetId;

  let handle;
  try {
    handle = await agents.create({
      sessionId: childId,
      meta: childMeta,
      inheritedEventCount: 0,
      agentOptions,
      ...(setup ? { setup } : {}),
    });
  } catch (error) {
    throw new ExecutorUnavailableError('创建 DSH 子会话失败：' + String(error?.message ?? error));
  }
  const agent = handle?.agent;
  if (!agent || typeof agent.followup !== 'function') {
    try { await handle?.dispose?.(); } catch { /* ignore */ }
    throw new ExecutorUnavailableError('创建 DSH 子会话失败：执行器没有返回 agent');
  }

  let cancelled = Boolean(signal?.aborted);
  let timedOut = false;
  let deadline = Date.now() + Math.max(1000, Number(cfg.inboxTaskTimeoutMs) || 600000);
  const abort = () => {
    cancelled = true;
    try { agent.cancel('user'); } catch { /* 已结束 */ }
  };
  signal?.addEventListener?.('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    try { agent.cancel('user'); } catch { /* 已结束 */ }
  }, Math.max(1000, Number(cfg.inboxTaskTimeoutMs) || 600000));
  timer.unref?.();

  const baseline = eventsOf(agent).length;
  try {
    approval.setPolicy(agent, 'never');
    try { titleService?.rename?.(agent.session, '收件箱 · ' + clipped(workspace.name, 20)); } catch { /* 标题只是辅助 */ }
    onChild?.({ agent, childSessionId: childId, parentSessionId: parent.session.id });
    if (cancelled) {
      try { agent.cancel('user'); } catch { /* ignore */ }
      return { status: 'cancelled', result: '', error: '用户取消', simulated: false, childSessionId: childId, parentSessionId: parent.session.id };
    }

    agent.inject(userMessage('这条消息来自工作区收件箱。请直接执行任务，不要重新路由聊天内容。', PLUGIN_SOURCE));
    agent.followup(userMessage(
      '【收件箱任务】工作区：' + workspace.name + '\n\n' + task.text + '\n\n' +
      '只完成这条任务；不要改写工作区上下文，不要创建新的工作区。完成后用简洁的正文汇报结果。',
      USER_SOURCE,
    ));

    await waitForTurn(agent, baseline, deadline);
    if (cancelled) {
      return { status: 'cancelled', result: '', error: '用户取消', simulated: false, childSessionId: childId, parentSessionId: parent.session.id };
    }
    if (timedOut) {
      return { status: 'failed', result: '', error: '子会话执行超时，已取消', simulated: false, childSessionId: childId, parentSessionId: parent.session.id };
    }
    const sawTurn = eventsOf(agent).slice(baseline).some(e => e?.type === 'turn/start' || e?.type === 'turn/end');
    if (!sawTurn) {
      return { status: 'failed', result: '', error: '子会话没有开始执行（未出现 turn/start）', simulated: false, childSessionId: childId, parentSessionId: parent.session.id };
    }
    await waitIdle(agent, deadline);
    if (cancelled) {
      return { status: 'cancelled', result: '', error: '用户取消', simulated: false, childSessionId: childId, parentSessionId: parent.session.id };
    }
    if (timedOut) {
      return { status: 'failed', result: '', error: '子会话执行超时，已取消', simulated: false, childSessionId: childId, parentSessionId: parent.session.id };
    }

    const events = eventsOf(agent).slice(baseline);
    const end = [...events].reverse().find(e => e?.type === 'turn/end');
    if (!end) {
      return { status: 'failed', result: '', error: '子会话没有返回 turn/end', simulated: false, childSessionId: childId, parentSessionId: parent.session.id };
    }
    const kind = reasonKind(end.data?.reason);
    const text = [...events].reverse()
      .filter(e => e?.type === 'assistant/message')
      .map(e => messageText(e.data?.message))
      .find(Boolean) ?? '';
    if (kind === 'completed') {
      return { status: 'done', result: clipped(text || '（子会话完成，但没有可见文本输出）', 6000), error: '', simulated: false, childSessionId: childId, parentSessionId: parent.session.id };
    }
    if (kind === 'aborted') {
      return { status: 'cancelled', result: '', error: '子会话被中断', simulated: false, childSessionId: childId, parentSessionId: parent.session.id };
    }
    const detail = reasonError(end);
    const message = kind === 'error'
      ? ('子会话执行失败' + (detail ? '：' + detail : ''))
      : kind === 'blocked'
        ? '子会话被阻塞，可能需要审批（子会话审批已设为 never）'
        : kind === 'max-tokens'
          ? '子会话输出达到上限，结果不完整'
          : '子会话结束原因：' + (kind || '未知');
    return { status: 'failed', result: text ? clipped(text, 1000) : '', error: message, simulated: false, childSessionId: childId, parentSessionId: parent.session.id };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', abort);
    try { await handle.dispose?.(); } catch (error) { log('inbox dispose fail: ' + String(error?.message ?? error)); }
  }
}
