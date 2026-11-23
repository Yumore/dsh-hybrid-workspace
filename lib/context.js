// 上下文装配：工作区卡 + 相关记忆 + 未决事项 + 最近几轮 + 隔离规则。
// 预算硬上限，按优先级裁剪；只装当前工作区，杜绝串区。

import { clipped } from './text.js';
import { retrieve, stats } from './memory.js';
import { contextCfgFor } from './policy.js';

const LABEL = { decision: '决策', fact: '事实', todo: '待办', question: '问题', episode: '早期' };

function lineOf (m) {
  const where = m.turn ? '第' + m.turn + '轮·' : '';
  const search = m.type === 'decision' && (m.keys ?? []).length
    ? '（搜：' + (m.keys ?? []).slice(0, 3).join('、') + '）'
    : '';
  return '- [' + where + (LABEL[m.type] ?? '记忆') + '] ' + clipped(m.text, 170) + search;
}

function profileBlock (profile, query, cfg, now) {
  if (cfg.includeGlobal === false) return { lines: [], block: '' };
  const list = Array.isArray(profile) ? profile : [];
  if (!list.length) return { lines: [], block: '' };
  const got = retrieve({ memories: list, turns: [], rounds: 0 }, query, {
    k: cfg.profileInject ?? 4,
    now,
    touch: false,
  });
  const lines = got.memories.filter(m => m.tier === 'profile').map(lineOf);
  return { lines, block: lines.length ? ['### 全局档案（跨工作区）', ...lines].join('\n') : '' };
}

export function buildContext (ws, query, cfg = {}, now = Date.now(), profile = [], cap = null, opts = {}) {
  if (!ws) return '';
  const c = contextCfgFor(ws, cfg, cap);
  const max = c.contextMaxChars;
  // 面板刷新用 touch:false，避免仅仅看一眼就续期 TTL。
  const got = retrieve(ws, query, { k: c.memoryInject ?? 8, now, touch: opts.touch !== false });
  const global = profileBlock(profile, query, c, now);
  const s = stats(ws);

  let descLimit = 180, keywordLimit = 8, summaryLimit = 360;
  const header = () => [
    '## 当前工作区：' + ws.name + ' (id ' + ws.id + ')',
    '范围：' + ((descLimit ? clipped(ws.description, descLimit) : '') || '未填写（可在面板改范围）'),
    keywordLimit && (ws.keywords ?? []).length ? '关键词：' + (ws.keywords ?? []).slice(0, keywordLimit).join('、') : '',
    summaryLimit && ws.summary ? '已有摘要：' + clipped(ws.summary, summaryLimit) : '',
    '记忆：共 ' + got.total + ' 条（决策 ' + s.decision + ' / 事实 ' + s.fact + ' / 待办 ' + s.todo + ' / 问题 ' + s.question + '）',
    // 预算裁剪可能已经把档案行删光，标题不能继续说“命中 N 条”。
    profileLines.length ? '全局档案：命中 ' + profileLines.length + ' 条（跨工作区）' : '',
  ].filter(Boolean).join('\n');

  let ruleLines = c.includeRules === false ? [] : [
    '### 回答规则',
    '- 只依据本工作区的范围、记忆和当前会话回答；不要引用或在回答里混入其他工作区的历史。',
    '- 缺少细节时，先用 search_context 在压缩历史里搜关键词，再用 decompress 还原对应范围；工具不可用就直说没查到，不要编造。',
    '- 用户新的纠正或补充优先于旧记忆；与旧结论冲突时以本轮说法为准。',
  ];
  const rules = () => ruleLines.join('\n');

  const memLines = got.memories.map(lineOf);
  const openLines = got.openItems.map(lineOf);
  const profileLines = global.lines;
  const recentLines = (ws.turns ?? []).slice(-(c.recentTurns ?? 4))
    .map(t => '- ' + (t.role === 'assistant' ? '助手' : '用户') + '：' + clipped(t.text, 150));

  const memBlock = () => memLines.length ? ['### 本区相关记忆', ...memLines].join('\n') : '### 本区相关记忆\n（暂无结构化记忆，以最近对话为准）';
  const openBlock = () => openLines.length ? ['### 未决事项', ...openLines].join('\n') : '';
  const recentBlock = () => recentLines.length ? ['### 最近对话', ...recentLines].join('\n') : '';
  const rebuild = () => [header(), profileLines.length ? ['### 全局档案（跨工作区）', ...profileLines].join('\n') : '', memBlock(), openBlock(), recentBlock(), rules()].filter(Boolean);

  let parts = rebuild();
  const size = () => parts.join('\n\n').length;

  // 先砍最近对话的最旧行，再砍未决、记忆尾部、全局档案；最后才缩头部描述/摘要。
  // 这样 600 字符的小预算也不会把“回答规则”从末尾截断。
  while (size() > max && recentLines.length > 0) { recentLines.shift(); parts = rebuild(); }
  while (size() > max && openLines.length > 0) { openLines.pop(); parts = rebuild(); }
  while (size() > max && memLines.length > 0) { memLines.pop(); parts = rebuild(); }
  while (size() > max && profileLines.length > 0) { profileLines.pop(); parts = rebuild(); }

  const shrink = [
    () => { summaryLimit = 180; },
    () => { summaryLimit = 80; },
    () => { summaryLimit = 0; },
    () => { descLimit = 80; },
    () => { descLimit = 40; },
    () => { descLimit = 0; },
    () => { keywordLimit = 4; },
    () => { keywordLimit = 0; },
  ];
  for (const step of shrink) {
    if (size() <= max) break;
    step(); parts = rebuild();
  }
  // 极端小预算才缩规则；保留标题和第一条，避免最后被 clipped 截成半句。
  while (size() > max && ruleLines.length > 2) { ruleLines.pop(); parts = rebuild(); }
  let out = parts.join('\n\n');
  if (out.length > max) {
    // 仍超限时宁可去掉规则段，也不让结尾硬截断把工作区标题切成乱码。
    ruleLines = [];
    parts = rebuild();
    out = parts.join('\n\n');
  }
  return out.length > max ? out.slice(0, max) : out;
}

// 一条用户消息包含多个话题时，每个区给一张卡，按编号逐区回答。
// 每区预算从总预算里均分；多话题总预算可以比单区高，但仍有硬上限。
export function buildMultiContext (workspaces, segments, cfg = {}, now = Date.now(), profile = []) {
  const list = (workspaces ?? []).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return buildContext(list[0], segments?.[0]?.text ?? '', cfg, now, profile);
  const total = Math.max(1600, cfg.multiContextMaxChars ?? 3000);
  const queryText = (segments ?? []).map(x => x?.text ?? '').join('\n');
  const rules = [
    '### 多话题回答规则',
    '- 用户这一条消息包含多个话题。按上面的编号逐区回答，先答第 1 个，再答第 2 个。',
    '- 每个区只依据对应工作区卡片的记忆与最近对话；不要把 A 区的结论写进 B 区。',
    '- 如果某个区缺少细节，先用 search_context 搜该区关键词，再用 decompress 还原；查不到就直说。',
    '- 用户新的纠正或补充优先于旧记忆。',
  ].join('\n');
  const global = profileBlock(profile, queryText, cfg, now);
  const globalBlock = clipped(global.block, 300);
  const reserve = rules.length + globalBlock.length + 80;
  let per = Math.max(240, Math.floor((total - reserve) / list.length));
  let out = '';
  const build = () => {
    const cards = list.map((ws, i) => {
      const seg = (segments ?? []).find(x => x?.wsId === ws.id) ?? segments?.[i];
      const body = buildContext(ws, seg?.text ?? '', {
        ...cfg,
        recentTurns: Math.min(cfg.recentTurns ?? 4, 2),
        includeRules: false,
      }, now, [], per);
      return '### 工作区 ' + (i + 1) + '/' + list.length + '\n' + body;
    });
    return ['## 本条消息涉及 ' + list.length + ' 个工作区', globalBlock, ...cards, rules].filter(Boolean).join('\n\n');
  };
  out = build();
  // 均分后仍超总预算时继续压缩每卡，而不是末尾 clipped 把最后一张卡吃掉。
  while (out.length > total && per > 240) {
    per = Math.max(240, per - 20);
    out = build();
  }
  return out.length > total ? out.slice(0, total) : out;
}

// 面板“上下文构成”：按 buildContext 的实际分段统计字符，不另存一份估算。
const SECTION_MARKERS = [
  ['global', '### 全局档案（跨工作区）'],
  ['memories', '### 本区相关记忆'],
  ['open', '### 未决事项'],
  ['recent', '### 最近对话'],
  ['rules', '### 回答规则'],
];

export function breakdownText (text) {
  const t = String(text ?? '');
  const marks = SECTION_MARKERS
    .map(([key, marker]) => ({ key, at: t.indexOf(marker) }))
    .filter(x => x.at >= 0)
    .sort((a, b) => a.at - b.at);
  const out = { header: marks.length ? marks[0].at : t.length, global: 0, memories: 0, open: 0, recent: 0, rules: 0 };
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].at : t.length;
    out[marks[i].key] += Math.max(0, end - marks[i].at);
  }
  out.total = t.length;
  return out;
}

// 面板统计用：字符数是精确的，token 是按 CJK 约 1.5 字/token 的粗估，带“≈”展示。
export function contextUsage (ws, query, cfg = {}, now = Date.now(), profile = []) {
  const text = buildContext(ws, query, cfg, now, profile, null, { touch: false });
  const max = contextCfgFor(ws, cfg).contextMaxChars;
  const chars = text.length;
  return { chars, tokens: Math.ceil(chars / 1.5), max, pct: Math.max(0, Math.min(100, Math.round(chars / max * 100))), breakdown: breakdownText(text) };
}