// 记忆生命周期 v2.1：四层（profile/durable/episodic/scratch）、规则分类、TTL、
// 懒清扫、置顶/恢复。全部本地规则，不调用模型；过期为软删除，绝不硬删记忆。

import { hash } from './text.js';

export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;
export const TIERS = ['profile', 'durable', 'episodic', 'scratch'];
export const TIER_LABEL = { profile: '全局档案', durable: '长期', episodic: '过程', scratch: '临时' };
export const STATUSES = ['active', 'superseded', 'expired', 'archived'];

// 身份/偏好/长期约定；只有用户明确要求“记住/以后/每次/默认”才进全局档案。
// “我的门店”这类所有格不算偏好，避免把普通业务描述误升为全局。
// 只认显式偏好/长期约定，裸“以后/每次/默认/一直”会把普通故障描述误升为全局档案。
const PROFILE_CUE = /(?:请?记住|记一下|记下|以后(?:都|每次|一律|默认|用|按|回答|说|称呼|叫|写|给我|只|别|不要|不再)|每次(?:都)?(?:用|按|回答|使用|走|默认)|默认(?:用|按|采用|走|设置|配置|选择|使用)|长期(?:使用|保存|记住|保留|有效|默认|偏好)|永久(?:保存|记住|保留|有效|置顶|不删)|别再(?:用|说|提|给|发|问)|不要再(?:用|说|提|给|发|问)|我的(?:偏好|习惯|设置|要求|规则)[是为：: ]|我的(?:名字|称呼)(?:是|叫|为)|我的(?:账号|手机号|邮箱|工号)(?:是|为|叫)|我是(?:一名|一位|做|负责|研发|开发|产品|设计|测试|运维|经理|工程师|店主|老板|负责人)|我喜欢|我不喜欢|我习惯)/u;
// 强时效信息：天气/行情/路况/比分/油价/限行/航班/附近等。
// “今天有个 bug”不会命中，必须带上时效对象；“今天天气”才会。
const VOLATILE_CUE = /(?:天气|气温|下雨|空气质量|股价|股票|汇率|比分|赛况|路况|堵车|油价|限行|航班|最新(?:价格|股价|汇率|比分|赛况|路况|油价|航班)|实时(?:价格|股价|汇率|比分|路况|油价|航班|天气)|附近(?:天气|路况|油价|限行|航班|门店|充电桩)|今天(?:天气|气温|股价|汇率|比分|路况|油价|限行|航班)|今晚(?:天气|气温|路况|航班)|现在(?:价格|股价|汇率|比分|路况|天气)|当前(?:价格|股价|汇率|比分|路况|天气))/u;

// 一次性任务/过程性知识：攻略、路线、步骤、流程、教程、推荐。
const EPISODIC_CUE = /(?:攻略|怎么走|路线|推荐|步骤|流程|教程|做法|如何做|规划|行程|玩法)/u;

const DECISION = /(?:结论|决定|定为|最终|口径|根因|修复|改成|改为|采用|方案是|定位到|确认是|建议|必须|不要|注意|风险|影响)/u;

function isQuestion (text) {
  return /[?？]/u.test(text) || /(?:是否|要不要|怎么|为什么|能否|多少|哪里|哪个|哪些|如何|有没有|是不是)/u.test(text);
}

// Asia/Shanghai（UTC+8）的本地日界；不依赖宿主时区，避免用户机器时区差异。
export function endOfLocalDay (now = Date.now()) {
  const shifted = new Date(Number(now) + 8 * HOUR);
  shifted.setUTCHours(23, 59, 59, 999);
  return shifted.getTime() - 8 * HOUR;
}

export function ttlForTier (tier, type = 'fact') {
  if (tier === 'profile') return 0;
  if (tier === 'scratch') return 12 * HOUR;
  if (tier === 'episodic') return 14 * DAY;
  // 未决问题/待办 30 天；普通事实/决策 180 天。均为可续期的软期限。
  if (type === 'todo' || type === 'question') return 30 * DAY;
  return 180 * DAY;
}

export function resolveValidUntil (text, tier, type, now = Date.now()) {
  if (tier === 'profile') return null;
  if (tier === 'scratch') {
    if (/(?:今晚|今天|现在|当前|实时|最新)/u.test(text)) return endOfLocalDay(now);
    if (/明天/u.test(text)) return endOfLocalDay(now + DAY);
    return now + 12 * HOUR;
  }
  return now + ttlForTier(tier, type);
}

// 规则分类：先判持久身份/偏好，再判强时效，再判过程知识，最后按普通事实。
export function classifyLifecycle (text, { type = 'fact', role = 'user', now = Date.now() } = {}) {
  const t = String(text ?? '');
  let tier = 'durable';
  // 显式偏好（以后每次/记住/默认用）优先于同一句里出现的故障词：
  // “以后每次回答都用简体中文”不能因为句首提到断线就降级成工作区记忆。
  if (role === 'user' && PROFILE_CUE.test(t) && !VOLATILE_CUE.test(t)) {
    tier = 'profile';
  } else if (VOLATILE_CUE.test(t)) {
    tier = 'scratch';
  } else if (type === 'episode' || (EPISODIC_CUE.test(t) && !DECISION.test(t))) {
    tier = 'episodic';
  }
  const scope = tier === 'profile' ? 'global' : 'workspace';
  const validUntil = resolveValidUntil(t, tier, type, now);
  return {
    tier,
    scope,
    // 全局档案默认置顶；用户仍可在面板取消置顶，但 profile 本身不因取消而立刻过期。
    pinned: tier === 'profile',
    validUntil: validUntil ?? null,
    expiresAt: validUntil ?? null,
    ttlMs: validUntil ? Math.max(0, validUntil - now) : 0,
  };
}

function finiteOr (v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeOrigin (m) {
  if (m?.origin && typeof m.origin === 'object') {
    return {
      sessionId: m.origin.sessionId == null ? null : String(m.origin.sessionId),
      turn: Number(m.origin.turn) || 0,
      role: m.origin.role === 'assistant' ? 'assistant' : 'user',
    };
  }
  if (m?.source && typeof m.source === 'object') {
    return {
      sessionId: m.source.sessionId == null ? null : String(m.source.sessionId),
      turn: Number(m.source.turn) || 0,
      role: m.source.role === 'assistant' ? 'assistant' : 'user',
    };
  }
  return null;
}

// 旧记忆只补字段，不改文本/类型/状态：默认 durable + workspace + pinned=false，
// validUntil 保持 null（旧数据不会被新 TTL 立刻清掉）；新写入才有明确期限。
export function normalizeMemory (m, { now = Date.now() } = {}) {
  const type = ['decision', 'fact', 'todo', 'question', 'episode'].includes(m?.type) ? m.type : 'fact';
  const explicitGlobal = m?.scope === 'global' || m?.tier === 'profile';
  const tier = TIERS.includes(m?.tier) ? m.tier : (explicitGlobal ? 'profile' : 'durable');
  const scope = explicitGlobal || tier === 'profile' ? 'global' : 'workspace';
  const createdAt = finiteOr(m?.createdAt, finiteOr(m?.at, now));
  const updatedAt = finiteOr(m?.updatedAt, createdAt);
  const lastUsedAt = finiteOr(m?.lastUsedAt, updatedAt);
  const validUntil = m?.validUntil == null ? null : (finiteOr(m.validUntil, 0) || null);
  const ttlMs = Number.isFinite(Number(m?.ttlMs)) && Number(m.ttlMs) >= 0
    ? Number(m.ttlMs)
    : (validUntil ? Math.max(0, validUntil - createdAt) : 0);
  const status = STATUSES.includes(m?.status) ? m.status : 'active';
  return {
    id: String(m?.id ?? ('m_' + hash(String(m?.text ?? '') + createdAt, 10))),
    type,
    text: String(m?.text ?? ''),
    keys: Array.isArray(m?.keys) ? m.keys.map(String).slice(0, 12) : [],
    entities: Array.isArray(m?.entities) ? m.entities.map(String).slice(0, 12) : [],
    importance: Math.max(1, Math.min(5, Number(m?.importance) || 2)),
    turn: Number(m?.turn) || 0,
    at: finiteOr(m?.at, createdAt),
    status,
    supersedes: m?.supersedes ?? null,
    supersededBy: m?.supersededBy ?? null,
    source: typeof m?.source === 'string' ? m.source : 'migration',
    origin: normalizeOrigin(m),
    tier,
    scope,
    pinned: m?.pinned === true,
    createdAt,
    updatedAt,
    lastUsedAt,
    validUntil,
    expiresAt: validUntil,
    ttlMs,
    expiredAt: Number(m?.expiredAt) || 0,
    // 归档时间/原因是导出与面板恢复要用的元数据，load/normalize 不能把它们丢掉。
    archivedAt: Number(m?.archivedAt) || 0,
    archiveReason: typeof m?.archiveReason === 'string' ? m.archiveReason : '',
    pinnedAt: Number(m?.pinnedAt) || 0,
    restoredAt: Number(m?.restoredAt) || 0,
    // 兼容旧面板/测试读取的字段名。
    layer: tier,
  };
}

// 只把“到期的 active 记忆”标记为 expired；状态保留，面板可恢复。
// 不删除数组元素，也不改 profile/置顶记录。
export function isExpired (m, now = Date.now()) {
  if (!m || m.status !== 'active') return false;
  if (m.pinned || m.scope === 'global' || m.tier === 'profile') return false;
  const until = Number(m.validUntil);
  return Number.isFinite(until) && until > 0 && until <= now;
}

export function sweepMemories (container, now = Date.now()) {
  if (!container || !Array.isArray(container.memories)) return 0;
  let n = 0;
  for (const m of container.memories) {
    if (!isExpired(m, now)) continue;
    m.status = 'expired';
    m.expiredAt = now;
    m.updatedAt = now;
    n++;
  }
  return n;
}

export function remainingMs (m, now = Date.now()) {
  if (!m || m.scope === 'global' || m.tier === 'profile' || m.pinned) return null;
  const until = Number(m.validUntil);
  if (!Number.isFinite(until) || until <= 0) return null;
  return Math.max(0, until - now);
}

export function touchMemory (m, now = Date.now()) {
  if (!m || m.status !== 'active' || m.pinned || m.scope === 'global' || m.tier === 'profile') return false;
  if (m.tier === 'scratch') return false; // 一次性信息不因被看一眼就续期
  // 一小时内重复检索不反复改时间，减少状态文件抖动。
  if (Number(m.lastUsedAt) && now - Number(m.lastUsedAt) < HOUR) return false;
  const until = now + ttlForTier(m.tier, m.type);
  m.lastUsedAt = now;
  m.validUntil = until;
  m.expiresAt = until;
  m.ttlMs = until - now;
  m.updatedAt = now;
  return true;
}

export function pinMemory (list, id, pinned = true, now = Date.now()) {
  const m = (list ?? []).find(x => String(x.id) === String(id));
  if (!m) return null;
  // 已被新结论替代的旧记忆不允许靠置顶复活，否则新旧结论会同时 active。
  if (m.status === 'superseded') return null;
  m.pinned = !!pinned;
  m.updatedAt = now;
  m.pinnedAt = pinned ? now : 0;
  if (pinned) {
    // 置顶覆盖 TTL：已过期也一并恢复，期限变为“永久”（profile 本来永久）。
    m.status = 'active';
    m.validUntil = null;
    m.expiresAt = null;
    m.ttlMs = 0;
    m.expiredAt = 0;
  } else if (m.tier !== 'profile' && m.scope !== 'global') {
    // 取消置顶后重新给一个完整期限，避免立刻掉进过期状态。
    const until = now + ttlForTier(m.tier, m.type);
    m.validUntil = until;
    m.expiresAt = until;
    m.ttlMs = until - now;
  }
  return m;
}

export function restoreMemory (list, id, now = Date.now()) {
  const m = (list ?? []).find(x => String(x.id) === String(id));
  if (!m) return null;
  // superseded 是“被新结论替代”，不是过期；恢复它会和新结论冲突。
  if (m.status === 'superseded') return null;
  m.status = 'active';
  m.expiredAt = 0;
  m.restoredAt = now;
  m.updatedAt = now;
  if (m.pinned || m.scope === 'global' || m.tier === 'profile') {
    m.validUntil = null;
    m.expiresAt = null;
    m.ttlMs = 0;
  } else {
    const until = now + ttlForTier(m.tier, m.type);
    m.validUntil = until;
    m.expiresAt = until;
    m.ttlMs = until - now;
  }
  return m;
}