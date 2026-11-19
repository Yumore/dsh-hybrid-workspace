// 上下文装配：工作区卡 + 相关记忆 + 未决事项 + 最近几轮 + 隔离规则。
// 预算硬上限，按优先级裁剪；只装当前工作区，杜绝串区。

import { clipped } from './text.js';
import { retrieve, stats } from './memory.js';

const LABEL = { decision: '决策', fact: '事实', todo: '待办', question: '问题', episode: '早期' };

function lineOf (m) {
  const where = m.turn ? '第' + m.turn + '轮·' : '';
  const search = m.type === 'decision' && (m.keys ?? []).length
    ? '（搜：' + (m.keys ?? []).slice(0, 3).join('、') + '）'
    : '';
  return '- [' + where + (LABEL[m.type] ?? '记忆') + '] ' + clipped(m.text, 170) + search;
}

export function buildContext (ws, query, cfg = {}, now = Date.now()) {
  if (!ws) return '';
  const max = Math.max(800, cfg.contextMaxChars ?? 2400);
  const got = retrieve(ws, query, { k: cfg.memoryInject ?? 8, now });
  const s = stats(ws);

  const header = [
    '## 当前工作区：' + ws.name + ' (id ' + ws.id + ')',
    '范围：' + (clipped(ws.description, 180) || '未填写（可在面板改范围）'),
    (ws.keywords ?? []).length ? '关键词：' + (ws.keywords ?? []).slice(0, 8).join('、') : '',
    ws.summary ? '已有摘要：' + clipped(ws.summary, 360) : '',
    '记忆：共 ' + got.total + ' 条（决策 ' + s.decision + ' / 事实 ' + s.fact + ' / 待办 ' + s.todo + ' / 问题 ' + s.question + '）',
  ].filter(Boolean).join('\n');

  const rules = [
    '### 回答规则',
    '- 只依据本工作区的范围、记忆和当前会话回答；不要引用或在回答里混入其他工作区的历史。',
    '- 缺少细节时，先用 search_context 在压缩历史里搜关键词，再用 decompress 还原对应范围；工具不可用就直说没查到，不要编造。',
    '- 用户新的纠正或补充优先于旧记忆；与旧结论冲突时以本轮说法为准。',
  ].join('\n');

  const memLines = got.memories.map(lineOf);
  const openLines = got.openItems.map(lineOf);
  let recentLines = [];
  for (const t of (ws.turns ?? []).slice(-(cfg.recentTurns ?? 4))) {
    recentLines.push('- ' + (t.role === 'assistant' ? '助手' : '用户') + '：' + clipped(t.text, 150));
  }

  const memBlock = () => memLines.length ? ['### 本区相关记忆', ...memLines].join('\n') : '### 本区相关记忆\n（暂无结构化记忆，以最近对话为准）';
  const openBlock = () => openLines.length ? ['### 未决事项', ...openLines].join('\n') : '';
  const recentBlock = () => recentLines.length ? ['### 最近对话', ...recentLines].join('\n') : '';

  let parts = [header, memBlock(), openBlock(), recentBlock(), rules].filter(Boolean);
  const size = () => parts.join('\n\n').length;

  // 先砍最近对话的最旧行，再砍未决，再砍记忆尾部；规则和头部始终保留。
  while (size() > max && recentLines.length > 0) { recentLines.shift(); parts = [header, memBlock(), openBlock(), recentBlock(), rules].filter(Boolean); }
  while (size() > max && openLines.length > 0) { openLines.pop(); parts = [header, memBlock(), openBlock(), recentBlock(), rules].filter(Boolean); }
  while (size() > max && memLines.length > 1) { memLines.pop(); parts = [header, memBlock(), openBlock(), recentBlock(), rules].filter(Boolean); }
  const out = parts.join('\n\n');
  return out.length > max ? clipped(out, max) : out;
}

// 面板统计用：字符数是精确的，token 是按 CJK 约 1.5 字/token 的粗估，带“≈”展示。
export function contextUsage (ws, query, cfg = {}, now = Date.now()) {
  const text = buildContext(ws, query, cfg, now);
  const max = Math.max(800, cfg.contextMaxChars ?? 2400);
  const chars = text.length;
  return { chars, tokens: Math.ceil(chars / 1.5), max, pct: Math.max(0, Math.min(100, Math.round(chars / max * 100))) };
}
