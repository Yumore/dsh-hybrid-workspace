// 结论演变：把同一工作区里被 superseded 的旧记忆沿 supersededBy 串成时间线。
// 只读、纯函数；面板用来解释“为什么旧结论不见了”。

import { clipped } from './text.js';

const NODE_TEXT = 160;
const MAX_CHAINS = 10;

function nodeOf (m) {
  return {
    id: String(m.id ?? ''),
    text: clipped(m.text ?? '', NODE_TEXT),
    type: m.type ?? 'fact',
    status: m.status ?? 'active',
    turn: Number(m.turn) || 0,
    at: Number(m.at) || Number(m.updatedAt) || 0,
    pinned: m.pinned === true,
  };
}

export function buildTimeline (ws) {
  const list = Array.isArray(ws?.memories) ? ws.memories : [];
  if (list.length < 2) return { chains: [], conflicts: 0 };
  const byId = new Map(list.map(m => [String(m.id ?? ''), m]));
  const seen = new Set();
  const targets = new Set(list.map(m => String(m.supersededBy ?? '')).filter(Boolean));
  const chains = [];

  for (const start of list) {
    if (!start?.supersededBy) continue;
    // 只从链条起点开始，避免 old2 再生成一条 old2→new 的重复子链。
    if (targets.has(String(start.id ?? ''))) continue;
    const nodes = [];
    const local = new Set();
    let cur = start;
    while (cur && !local.has(String(cur.id))) {
      local.add(String(cur.id));
      nodes.push(nodeOf(cur));
      cur = cur.supersededBy ? byId.get(String(cur.supersededBy)) : null;
    }
    if (nodes.length < 2) continue;
    nodes.sort((a, b) => (a.at || 0) - (b.at || 0));
    const key = nodes.map(n => n.id).join('>');
    if (seen.has(key)) continue;
    seen.add(key);
    const last = nodes[nodes.length - 1];
    chains.push({
      id: 'chain_' + nodes[0].id,
      topic: clipped(nodes[0].text, 60),
      at: last.at || 0,
      nodes,
    });
  }

  chains.sort((a, b) => (b.at || 0) - (a.at || 0));
  return { chains: chains.slice(0, MAX_CHAINS), conflicts: chains.length };
}
