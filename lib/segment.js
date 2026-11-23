// 多话题切分：显式空行/编号列表/句末连接词；宁可少切，也不把一句完整的话拆散。
// 输出 [{ index, text }]；只有 >=2 段且每段有实质内容时才多话题。

const LIST_LINE = /^\s*(?:\d+[.、)]|[一二三四五六七八九十]+[、.)]|[-*•])\s+/u;
// 同一条消息里用户可能把编号列表写成一行（中间只有空格），也要能拆。
const INLINE_LIST = /(^|[\s。！？!?；;])\d{1,2}[、.)）]\s*/gu;
const CONNECTOR = /(^|[。！？!?；;\n])\s*(?:另外|还有|顺便|再问一个|另一个问题|第二个问题|第三个问题)[，,、:：\s]*|话说(?=[，,、:：\s])[，,、:：\s]*/gu;
// 连续问句：只有出现 >=2 个问号，且下一句以新的发问/新对象开头时，才把句末当话题边界。
const ASK_BOUNDARY = /([。！？!?；;])\s*(?=(?:我想|我要|另外|还有|顺便|话说|再问|第二个|第三个|以及|同时|然后|dsh[-_]|评估一下|你觉得|你看|能不能|可以吗|是否|要不要))/gu;
const CODE_FENCE = /```/u;
const SEG = '\u0000SEG\u0000';

export const SEGMENT_DEFAULTS = { multiTopic: true, multiTopicMax: 3, segmentMinChars: 12 };

function cleanSegment (s) {
  return String(s ?? '')
    .split(SEG).join('')
    .replace(/^\s*(?:\d+[.、)]|[一二三四五六七八九十]+[、.)]|[-*•])\s+/u, '')
    .replace(/^\s*\d{1,2}[、.)）]\s*/u, '')
    .replace(/^[，,、:：;；\s]+/u, '')
    .trim();
}

function splitByList (text) {
  const lines = String(text).split('\n');
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (LIST_LINE.test(lines[i])) starts.push(i);
  if (starts.length < 2) return [];
  const out = [];
  if (starts[0] > 0) out.push(lines.slice(0, starts[0]).join('\n'));
  for (let i = 0; i < starts.length; i++) {
    out.push(lines.slice(starts[i], starts[i + 1] ?? lines.length).join('\n'));
  }
  return out.map(cleanSegment).filter(Boolean);
}

function splitByInlineList (text) {
  const s = String(text);
  const marks = [...s.matchAll(INLINE_LIST)].map(m => m.index + m[1].length);
  if (marks.length < 2) return [];
  const out = [];
  for (let i = 0; i < marks.length; i++) out.push(s.slice(marks[i], marks[i + 1] ?? s.length));
  return out.map(cleanSegment).filter(Boolean);
}

function splitByConnector (text) {
  const marked = String(text).replace(CONNECTOR, (_all, lead) => (lead || '') + '\n\n' + SEG + '\n\n');
  if (!marked.includes(SEG)) return [];
  return marked.split(SEG).map(cleanSegment).filter(Boolean);
}

function splitByQuestions (text) {
  const marks = (String(text).match(/[？?]/gu) || []).length;
  if (marks < 2) return [];
  const marked = String(text).replace(ASK_BOUNDARY, (_all, lead) => lead + '\n\n' + SEG + '\n\n');
  if (!marked.includes(SEG)) return [];
  return marked.split(SEG).map(cleanSegment).filter(Boolean);
}

export function splitSegments (text, cfg = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return [{ index: 0, text: '' }];
  const c = { ...SEGMENT_DEFAULTS, ...(cfg ?? {}) };
  if (c.multiTopic === false) return [{ index: 0, text: raw }];
  // 代码块里的空行/编号不是话题分隔，整段保留。
  if (CODE_FENCE.test(raw)) return [{ index: 0, text: raw }];

  const max = Math.max(1, Math.min(6, Number(c.multiTopicMax) || 3));
  const min = Math.max(4, Number(c.segmentMinChars) || 12);

  let parts = String(raw).split(/\n\s*\n+/u).map(cleanSegment).filter(Boolean);
  let explicit = false;
  if (parts.length < 2) {
    parts = splitByList(raw);
    explicit = parts.length >= 2;
    if (!explicit) {
      parts = splitByInlineList(raw);
      explicit = parts.length >= 2;
    }
    if (parts.length < 2) parts = splitByConnector(raw);
    if (parts.length < 2) parts = splitByQuestions(raw);
  }
  if (parts.length < 2) return [{ index: 0, text: raw }];

  // 短碎片并入前一段；首段过短则并入下一段。宁可少一个区，也不建"还有呢"区。
  // 显式编号列表是用户主动划的边界，短项（如“今天天气怎么样”）保留；只合并 4 字以下的碎片。
  const minMerge = explicit ? 4 : min;
  const merged = [];
  for (const p of parts) {
    if (merged.length && p.length < minMerge) merged[merged.length - 1] += '\n' + p;
    else merged.push(p);
  }
  if (merged.length > 1 && merged[0].length < minMerge) {
    merged[1] = merged[0] + '\n' + merged[1];
    merged.shift();
  }
  if (merged.length < 2) return [{ index: 0, text: raw }];

  const limited = merged.slice(0, max);
  if (merged.length > max) limited[max - 1] += '\n' + merged.slice(max).join('\n');
  return limited.map((t, index) => ({ index, text: t }));
}
