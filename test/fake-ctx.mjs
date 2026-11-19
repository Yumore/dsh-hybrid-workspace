import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function tempHome () {
  return mkdtempSync(join(tmpdir(), 'hw-v2-'));
}

export function makeCtx ({ llmReply, webServer = true } = {}) {
  const handlers = {};
  const sections = [];
  const routes = [];
  const llmRequests = [];
  const ctx = {
    handlers, sections, routes, llmRequests,
    on: (ev, fn) => { (handlers[ev] ??= []).push(fn); },
    systemPrompt: { section: s => sections.push(s), getSectionOrder: () => undefined },
    llm: {
      async *stream (options) {
        llmRequests.push(options);
        if (llmReply === undefined) throw new Error('llm offline');
        yield { type: 'text-delta', text: llmReply };
      },
    },
    inject: (_deps, cb) => cb(ctx),
    effect: (fn) => fn(),
    logger: { info () {}, debug () {} },
  };
  if (webServer) ctx.webServer = { register: r => routes.push(r) };
  return ctx;
}

export const agent = (id = 's1') => ({ session: { id, requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } });
export const userMsg = (text) => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] });

export async function firePre (ctx, a, text, turn = 1, step = 1) {
  for (const h of ctx.handlers['agent/pre-step'] ?? []) {
    await h({ agent: a, messages: [userMsg(text)], turn, step }, async () => 'next');
  }
  const s = ctx.sections[0];
  return s?.text ? s.text({ agent: a }) : '';
}

export async function fireAssistant (ctx, a, text) {
  for (const h of ctx.handlers['session/event'] ?? []) {
    await h({ id: a.session.id }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } });
  }
  await sleep(20);
}

export function stateOf (home) {
  return JSON.parse(readFileSync(join(home, 'hybrid-workspace-v2', 'state.json'), 'utf8'));
}

export function idOf (section) {
  return (section.match(/\(id (\w+)\)/) ?? [])[1] ?? null;
}

export function headOf (section) {
  return (section.split('\n')[0] || '(空)').replace('## 当前工作区：', '');
}
