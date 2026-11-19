// 工作区路由：字段加权 IDF 覆盖率 + 迟滞（连续两条 / 强信号）+ 短句粘住。
// 借鉴 semantic-router 的"代表性话语"路由、TextTiling 的词面凝聚度、以及
// Claude/ChatGPT Projects 的 workspace card 结构；不引入 embedding。

import { clipped, entities, fieldTokenSets, FIELD_WEIGHTS, hash, heuristicName, idfMap, routingTokens, similarity, stripFiller, tokens, topKeywords } from './text.js';

const DEFAULTS = {
  routeMinScore: 0.1,
  routeAccept: 0.48,
  sameTopicAccept: 0.3,
  routeMargin: 0.1,
  switchMargin: 0.14,
  strongSwitch: 0.5,
  strongMargin: 0.3,
  pendingSwitch: 2,
  shortSticky: 12,
  unseenPenalty: 0.15,
  exemplarKeep: 16,
};

export function buildScorer (workspaces, cfg = {}) {
  const n = Math.max(1, workspaces.length);
  const fieldSets = new Map(workspaces.map(ws => [ws.id, fieldTokenSets(ws)]));
  const docs = [];
  for (const sets of fieldSets.values()) {
    const union = new Set();
    for (const set of Object.values(sets)) for (const t of set) union.add(t);
    docs.push(union);
  }
  const idf = idfMap(docs);
  const unseen = Math.log(1 + n);

  function scoreOne (ws, queryTokens) {
    const sets = fieldSets.get(ws.id) ?? {};
    let denom = 0, num = 0;
    const matched = [];
    for (const t of queryTokens) {
      // 从未在任何工作区出现过的词是「新细节」，不该按最高 IDF 惩罚当前话题；
      // 否则「消息越长、越具体，越容易被判成不匹配」，跨会话回原区会失效。
      const w = idf.get(t) ?? unseen * (cfg.unseenPenalty ?? 0.15);
      denom += w;
      let hit = 0;
      for (const [field, set] of Object.entries(sets)) {
        if (set.has(t)) hit = Math.max(hit, FIELD_WEIGHTS[field] ?? 0.4);
      }
      if (hit > 0) { num += w * hit; matched.push(t); }
    }
    return { score: denom ? num / denom : 0, coverage: queryTokens.size ? matched.length / queryTokens.size : 0, matched };
  }

  function rank (text) {
    const q = routingTokens(text);
    return workspaces.map(ws => {
      const r = scoreOne(ws, q);
      let score = r.score;
      // 工作区名是用户亲手起的强标签；整名出现在句子里时给一个小加成。
      const name = String(ws.name ?? '').trim();
      const exact = name.length >= 2 && String(text).includes(name);
      if (exact) score = Math.min(1, score + 0.18);
      return { ws, score, coverage: r.coverage, matched: r.matched, exact };
    }).sort((a, b) => b.score - a.score || (b.ws.hits ?? 0) - (a.ws.hits ?? 0));
  }

  return { rank, idf, fieldSets };
}

function brief (scores) {
  return scores.slice(0, 5).map(s => ({ id: s.ws.id, name: s.ws.name, score: Math.round(s.score * 1000) / 1000, exact: s.exact }));
}

export function decideRoute ({ workspaces, session, text, cfg = {} }) {
  const c = { ...DEFAULTS, ...cfg };
  const currentId = session?.workspaceId ?? null;
  if (!workspaces.length) return { action: 'new', how: 'bootstrap', scores: [] };
  const q = routingTokens(text);
  if (!q.size) {
    if (currentId) return { action: 'stay', wsId: currentId, how: 'empty-query', scores: [] };
    return { action: 'new', how: 'bootstrap', scores: [] };
  }
  const scorer = buildScorer(workspaces, c);
  const ranked = scorer.rank(text);
  const top = ranked[0];
  const second = ranked[1];
  const current = ranked.find(x => x.ws.id === currentId);
  const margin = top.score - (second?.score ?? 0);
  const base = { scores: brief(ranked), top: brief(ranked)[0], margin: Math.round(margin * 1000) / 1000 };
  const route = (x, how) => ({ ...base, action: 'route', wsId: x.ws.id, ws: x.ws, how });
  const stay = (how, extra = {}) => ({ ...base, action: 'stay', wsId: currentId, how, ...extra });
  const fresh = (how) => ({ ...base, action: 'new', how });

  // 短句（"继续""好的""那个呢"）天然没有词面信号，优先留在当前区。
  const short = String(text).trim().length < (c.shortSticky ?? 12);

  if (!currentId) {
    if (top.exact || top.score >= c.routeAccept) return route(top, top.exact ? 'exact-name' : 'match');
    if (top.score < c.routeMinScore) return fresh('no-signal');
    if (margin < 0.08 || top.score < c.routeAccept * 0.8) return { ...base, action: 'ask-llm', how: 'ambiguous-new' };
    return route(top, 'weak-match');
  }

  // 只有一个共享词（比如都叫"会员"）不足以认定同话题；至少两个实质命中，
  // 或命中一个实体词（设备号/单号/版本号），才算词面证据。
  const entitySet = new Set(entities(text).map(e => e.toLowerCase()));
  const matched = top.matched ?? [];
  const matchedStrong = top.exact || matched.length >= 2 || matched.some(t => entitySet.has(t));

  // 当前区恰好排在第一位时，只有真的命中才算同话题；零命中必须继续往下走，
  // 否则「只有一个工作区」时任何新话题都会被 same-topic 吞掉（v2 首轮实测 bug）。
  if (top.ws.id === currentId && (top.exact || (top.score >= c.sameTopicAccept && matchedStrong))) {
    return stay('same-topic', { pending: null });
  }
  if (short && !top.exact) return stay('sticky-short', { pending: session?.pending ?? null });
  if (top.score < c.routeMinScore) return fresh('no-signal');
  const currentScore = current?.score ?? 0;
  if (top.ws.id === currentId) {
    // 长句只共享一个泛词：更像新问题，而不是当前话题的延续。
    if (!matchedStrong) return fresh('weak-current-new');
    return stay('sticky-weak', { pending: null });
  }
  if (currentScore < c.routeMinScore && top.score < c.routeAccept) return fresh('no-signal');
  if (top.score < c.routeAccept || margin < c.routeMargin) return stay('sticky-weak', { pending: null });
  if (top.score - currentScore < c.switchMargin) return stay('sticky-margin', { pending: null });

  const strong = top.exact || (top.score >= c.strongSwitch && margin >= c.strongMargin);
  if (strong) return route(top, top.exact ? 'exact-name' : 'strong-signal');

  // 连续两条都指向同一个新候选才真正切换，防止单条弱信号造成抖动。
  const pending = session?.pending && session.pending.id === top.ws.id
    ? { id: top.ws.id, count: (session.pending.count ?? 0) + 1 }
    : { id: top.ws.id, count: 1 };
  if (pending.count >= (c.pendingSwitch ?? 2)) return { ...route(top, 'switch-pending'), pending: null };
  return stay('pending-switch', { pending });
}

export function createWorkspace (text, cfg = {}) {
  const now = cfg.now ?? Date.now();
  const name = clipped(heuristicName(text, cfg.nameMaxChars ?? 18), 40);
  const id = 'ws_' + hash(name + '|' + text + '|' + now, 8);
  const userText = clipped(stripFiller(text), 200);
  return {
    id,
    name,
    description: clipped(stripFiller(text), 180),
    keywords: topKeywords(text, cfg.keywordMax ?? 8),
    summary: '',
    turns: [],
    memories: [],
    exemplars: userText ? [{ text: userText, at: now }] : [],
    rounds: 0,
    hits: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function addExemplar (ws, text, cfg = {}) {
  if (!Array.isArray(ws.exemplars)) ws.exemplars = [];
  const t = clipped(stripFiller(text), 200);
  if (!t) return;
  if ((ws.exemplars ?? []).some(e => similarity(e.text ?? e, t) >= 0.9)) return;
  ws.exemplars.push({ text: t, at: Date.now() });
  const keep = cfg.exemplarKeep ?? DEFAULTS.exemplarKeep;
  if (ws.exemplars.length > keep) ws.exemplars = ws.exemplars.slice(-keep);
}

export function mergeWorkspace (from, into) {
  into.turns = [...(into.turns ?? []), ...(from.turns ?? [])].slice(-200);
  into.memories = [...(into.memories ?? []), ...(from.memories ?? [])];
  into.exemplars = [...(into.exemplars ?? []), ...(from.exemplars ?? [])].slice(-DEFAULTS.exemplarKeep);
  // 被合并方的关键词优先保留：它是即将消失那一边唯一的名字线索。
  into.keywords = [...new Set([...(from.keywords ?? []), ...(into.keywords ?? [])])].slice(0, 12);
  into.rounds = (into.rounds ?? 0) + (from.rounds ?? 0);
  into.hits = (into.hits ?? 0) + (from.hits ?? 0);
  into.updatedAt = Date.now();
  return into;
}

export { DEFAULTS as ROUTER_DEFAULTS, entities };
