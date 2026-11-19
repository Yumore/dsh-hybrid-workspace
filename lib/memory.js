// 结构化工作区记忆：抽取 → 合并/取代 → 检索 → 回合压缩。
// 借鉴 Mem0 的 extract/consolidate/retrieve、Zep 的 supersede、Generative Agents 的
// recency+importance+relevance 检索；但全部用可解释的词面分数，不引入向量库。

import { clipped, clean, entities, hash, jaccard, sentences, similarity, tokens, topKeywords } from './text.js';

const GREETING = /^(?:好的|收到|谢谢|感谢|嗯+|ok|okay|可以|行|继续|明白|了解|知道了|没问题)[。！!，,、\s]*$/iu;
const QUESTION = /[?？]|(?:是否|要不要|怎么|为什么|能否|多少|哪里|哪个|哪些|如何|有没有|是不是)/u;
const DECISION = /(?:结论|决定|定为|最终|口径|根因|修复|改成|改为|采用|方案是|定位到|确认是|建议|必须|不要|注意|风险|影响)/u;
const TODO = /(?:待办|下一步|需要|要跟进|跟进|验证|排查|补|加|记得|别忘了|明天|下周|之后)/u;
const FACT = /(?:报错|返回|显示|发现|出现|导致|报|是|为|有|在|已经|没有)/u;
const ISSUE = /(?:掉线|断线|黑屏|报错|失败|超时|卡|慢|错|异常|不对|打不出|连不上|闪退|崩溃|丢|少|多|重复|未|无法|不能)/u;

const TYPE_PRIOR = { decision: 1, todo: 0.92, question: 0.86, fact: 0.76, episode: 0.62 };

export function classifyType (text, role = 'user') {
  const t = String(text ?? '');
  if (role === 'user' && (QUESTION.test(t))) return 'question';
  if (DECISION.test(t)) return 'decision';
  if (TODO.test(t)) return 'todo';
  if (QUESTION.test(t)) return 'question';
  if (FACT.test(t) || ISSUE.test(t) || entities(t).length > 0) return 'fact';
  return 'fact';
}

function cueCount (t) {
  let n = 0;
  for (const re of [DECISION, TODO, QUESTION, FACT, ISSUE]) if (re.test(t)) n++;
  return n;
}

export function extractMemories (text, { role = 'user', turn = 0, now = Date.now(), max = 3 } = {}) {
  const out = [];
  const seen = new Set();
  for (const s of sentences(text)) {
    const t = clean(s);
    if (t.length < 8 || t.length > 320) continue;
    if (GREETING.test(t)) continue;
    const ents = entities(t);
    const cues = cueCount(t);
    // 助手的长句即使没有实体或结论词，也常是解释性事实；只要足够长就收，
    // 否则「供应商对账差两毛三分」这类纯叙述结论会被整条漏掉。
    if (!ents.length && !cues && !QUESTION.test(t) && !(role === 'user' && t.length >= 12) && !(role === 'assistant' && t.length >= 16)) continue;
    const type = classifyType(t, role);
    const key = t.replace(/[\s，。！？!?；;、]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const importance = Math.max(1, Math.min(5,
      (type === 'decision' ? 4 : type === 'todo' ? 3 : type === 'question' ? 3 : 2) +
      Math.min(2, ents.length) + (cues >= 2 ? 1 : 0)
    ));
    const keys = [...new Set([...ents.map(e => e.toLowerCase()), ...topKeywords(t, 10)])].slice(0, 12);
    const score = ents.length * 3 + cues * 2 + Math.min(3, t.length / 60) + (type === 'decision' ? 1.5 : 0);
    out.push({
      id: 'm_' + hash(type + '|' + t + '|' + turn, 10),
      type, text: clipped(t, 240), keys, entities: ents,
      importance, turn, at: now, status: 'active', source: role,
      score,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max).map(({ score, ...m }) => m);
}

function active (ws) {
  return (ws.memories ?? []).filter(m => !m.status || m.status === 'active');
}

function trim (ws, max) {
  if (!Array.isArray(ws.memories)) ws.memories = [];
  let list = active(ws);
  if (list.length <= max) return;
  const removable = list
    .filter(m => m.type !== 'decision')
    .sort((a, b) => (a.importance - b.importance) || (a.turn - b.turn));
  for (const m of removable) {
    if (active(ws).length <= max) break;
    ws.memories = ws.memories.filter(x => x !== m);
  }
  while (active(ws).length > max) {
    const oldest = active(ws).sort((a, b) => (a.importance - b.importance) || (a.turn - b.turn))[0];
    ws.memories = ws.memories.filter(x => x !== oldest);
  }
}

export function consolidate (ws, mem, cfg = {}) {
  if (!Array.isArray(ws.memories)) ws.memories = [];
  const now = mem.at ?? Date.now();
  const same = active(ws).filter(m => m.id !== mem.id);
  let near = null;
  let best = 0;
  for (const old of same) {
    const keySim = jaccard(new Set(old.keys ?? []), new Set(mem.keys ?? []));
    const textSim = similarity(old.text, mem.text);
    const s = Math.max(keySim, textSim);
    if (s > best) { best = s; near = old; }
  }
  if (near && best >= 0.6) {
    near.updatedAt = now;
    near.importance = Math.max(near.importance ?? 1, mem.importance ?? 1);
    near.turn = Math.max(near.turn ?? 0, mem.turn ?? 0);
    return { op: 'noop', memory: near };
  }
  const old = near && best >= 0.34 ? near : null;
  if (old && ((old.type === mem.type && ['decision', 'fact'].includes(mem.type)) ||
    (['question', 'todo'].includes(old.type) && ['decision', 'fact'].includes(mem.type)))) {
    old.status = 'superseded';
    old.supersededBy = mem.id;
    old.updatedAt = now;
    mem.supersedes = old.id;
    ws.memories.push(mem);
    trim(ws, cfg.memoryKeep ?? 300);
    return { op: 'supersede', memory: mem, old };
  }
  ws.memories.push(mem);
  trim(ws, cfg.memoryKeep ?? 300);
  return { op: 'add', memory: mem };
}

export function rememberText (ws, text, { role = 'user', turn = 0, now = Date.now(), max = 3, cfg = {} } = {}) {
  const items = extractMemories(text, { role, turn, now, max });
  const ops = [];
  for (const m of items) ops.push(consolidate(ws, m, cfg));
  return ops;
}

function latestTurn (ws) {
  if (Number.isFinite(ws.rounds) && ws.rounds > 0) return ws.rounds;
  const turns = ws.turns ?? [];
  return turns.length ? (turns[turns.length - 1].turn ?? turns.length) : 0;
}

function memTokens (m) {
  return tokens((m.text ?? '') + ' ' + (m.keys ?? []).join(' '));
}

export function retrieve (ws, query, { k = 8, now = Date.now(), turnsBack = 60 } = {}) {
  const list = active(ws);
  const q = tokens(query);
  const lt = latestTurn(ws);
  const qWeight = [...q].reduce((n, t) => n + 1 + (t.length >= 4 ? 0.5 : 0), 0) || 1;
  const scored = list.map(m => {
    const mt = memTokens(m);
    let hit = 0;
    if (q.size) for (const t of q) if (mt.has(t)) hit += 1 + (t.length >= 4 ? 0.5 : 0);
    const relevance = q.size ? hit / qWeight : 0;
    const recency = Math.exp(-Math.max(0, lt - (m.turn ?? 0)) / Math.max(1, turnsBack));
    const importance = (m.importance ?? 1) / 5;
    const prior = TYPE_PRIOR[m.type] ?? 0.7;
    const score = 0.55 * relevance + 0.2 * recency + 0.15 * importance + 0.1 * prior;
    return { m, score, relevance };
  }).sort((a, b) => b.score - a.score);

  const picked = [];
  const pool = [...scored];
  while (pool.length && picked.length < k) {
    let bestI = 0, bestV = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      const sim = picked.length ? Math.max(...picked.map(p => jaccard(memTokens(p), memTokens(c.m)))) : 0;
      const v = c.score - 0.35 * sim;
      if (v > bestV) { bestV = v; bestI = i; }
    }
    picked.push(pool[bestI].m);
    pool.splice(bestI, 1);
  }

  const open = list
    .filter(m => m.type === 'todo' || m.type === 'question')
    .sort((a, b) => (b.turn ?? 0) - (a.turn ?? 0))
    .slice(0, 3)
    .filter(m => !picked.some(p => p.id === m.id));

  return { memories: picked, openItems: open, total: list.length };
}

export function stats (ws) {
  const counts = { decision: 0, fact: 0, todo: 0, question: 0, episode: 0, superseded: 0 };
  for (const m of ws.memories ?? []) {
    if (m.status === 'superseded') counts.superseded++;
    else if (counts[m.type] !== undefined) counts[m.type]++;
  }
  return counts;
}

export function compactTurns (ws, cfg = {}) {
  if (!Array.isArray(ws.turns)) ws.turns = [];
  const compactAt = cfg.compactAt ?? 24;
  const keep = cfg.keepTurns ?? 12;
  if (ws.turns.length <= compactAt) return null;
  const cut = ws.turns.length - keep;
  const old = ws.turns.slice(0, cut);
  const parts = [];
  for (const turn of old) {
    const picked = [];
    for (const s of sentences(turn.text)) {
      if (s.length < 10) continue;
      if (!entities(s).length && !/(?:结论|决定|改成|修复|报错|返回|需要|下一步|待办|风险|注意)/u.test(s)) continue;
      picked.push(clipped(s, 100));
      if (picked.length >= 2) break;
    }
    if (!picked.length) picked.push(clipped(turn.text, 100));
    parts.push((turn.role === 'user' ? '用户：' : '助手：') + picked.join('；'));
  }
  const text = clipped('早期对话摘要：' + parts.join(' / '), 700);
  const mem = {
    id: 'm_' + hash('episode|' + text, 10),
    type: 'episode',
    text,
    keys: topKeywords(text, 10),
    entities: entities(text),
    importance: 2,
    turn: old[0]?.turn ?? 0,
    at: Date.now(),
    status: 'active',
    source: 'compaction',
  };
  consolidate(ws, mem, { ...cfg, memoryKeep: Math.max(cfg.memoryKeep ?? 300, 50) });
  ws.turns = ws.turns.slice(-keep);
  return mem;
}
