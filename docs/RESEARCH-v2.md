# v2 调研与设计记录

日期：2026-11-19。目标：为「单聊天框 + 多工作区上下文」找同类方案，归纳可借鉴的单点，再重构一版。

## 1. 调研范围与结论

| 来源 | 关键做法 | 对 v2 的影响 |
| --- | --- | --- |
| Claude Projects | 每个 project 自带 instructions/files/memory，thread 从 project 上下文起步 | 「工作区」= 路由单元 + 范围 + 关键词 + 代表性问法 |
| ChatGPT Projects | chats/files/instructions 聚合；project-only memory；支持 branch | 工作区记忆只在本区检索，不跨区注入 |
| Mem0（arXiv 2504.19413） | extract → consolidate → retrieve；ADD/UPDATE/DELETE/NOOP；token 成本约 -90% | 记忆抽取后先判重/冲突，而不是无脑追加 |
| Zep / Graphiti（arXiv 2501.13956） | 时序知识图谱，事实带有效期、可 supersede | 同实体新结论把旧记忆标为 superseded |
| MemGPT（arXiv 2310.08560） | 主上下文 + 外部上下文分层，模型自行换入换出 | 只注入摘要/相关记忆，细节留给检索工具 |
| Generative Agents（arXiv 2304.03442） | 检索分 = recency + importance + relevance | 记忆排序三项加权 |
| A-MEM（arXiv 2502.12110） | Zettelkasten 式笔记，新记忆反过来演化旧记忆 | 记忆带 keys，合并时更新而不是复制 |
| MemOS（arXiv 2507.03724） | MemCube 统一记忆，带 provenance/version | 记忆保留来源轮次，便于追溯 |
| Anthropic, Effective context engineering | compaction、structured note-taking、just-in-time retrieval | 预算化装配 + 需要细节时 search_context/decompress |
| Anthropic, multi-agent research | 子代理独立上下文，压缩后交回主代理 | 物理隔离形态的参考（尚未启用） |
| Context Rot（Chroma, 2025-07） | 输入越长表现越差，退化不均匀 | 不把「窗口够大」当成「信息可用」 |
| Lost in the Middle（arXiv 2307.03172） | 长上下文中间信息利用率低，U 形 | 相关记忆放前面，最近对话放后面 |
| TextTiling / HyperSeg / Def-DTS | 词面凝聚度 / 无监督分割 / LLM 演绎分割 | v2 用轻量词面 + 迟滞，避免每轮调 LLM 分割 |
| Aurelio semantic-router | 预定义 route + 代表性 utterance + 相似度 | 工作区维护 exemplars，路由用字段加权 |
| Cline Memory Bank | 结构化 Markdown 跨会话保存项目上下文 | 不引入向量库，状态保持可读 JSON |
| LangGraph memory | semantic / episodic / procedural；thread 隔离 | 记忆类型 + turn 压缩成 episode |
| Roo Code Boomerang Tasks | 子任务独立 mode，完成后回摘要 | 与 B 方案同源，暂未实现 |

未采纳：向量数据库/嵌入（引入依赖与索引运维，当前规模 60 个工作区不需要）；Graphiti 式图数据库（重）；MemGPT 式让模型自行编辑记忆（不可控、成本高）；每轮 LLM 话题分割（延迟与费用）；把所有历史压到 5K（用户明确说没必要）。

## 2. 设计决策

### 2.1 路由：词面 IDF + 迟滞，LLM 只做兜底

工作区卡由 name / description / keywords / exemplars / memories / summary 组成，每个字段有不同权重（name 1、keywords .95、description .75、exemplars .6、memories .55、summary .45）。打分是「查询词的 IDF 命中字段权重 / 查询词总 IDF」，名称整名出现额外 +0.18。

迟滞规则（`lib/router.js`）：

- 无当前区：top 达到 `routeAccept` 或整名命中 → route；否则 new。
- 有当前区：top 是当前区且分数够、且有强证据（整名、≥2 个词、或实体命中）→ stay。
- 短句（<12 字）→ sticky。
- 候选领先不足 `switchMargin` → sticky-margin。
- 强信号（分数 ≥.5 且领先 ≥.3）→ 直接切。
- 其余要连续 `pendingSwitch=2` 条同候选才切；仍模糊才 `ask-llm`。

这样避免 v1 的两个毛病：单个泛词命中就换区；一条弱信号造成来回抖动。

### 2.2 记忆：分类型 + 合并 + supersede + 检索

类型：decision / fact / todo / question / episode。

- 抽取：按句切分，保留 8~320 字、含实体或结论/待办线索的句子；用户消息 ≥12 字也可入；助手长句 ≥16 字即使没有实体也收（避免漏掉「按单据号逐条核」这类叙述结论）。
- 合并：key Jaccard ≥.6 或文本相似 ≥.72 → NOOP；同类型新结论且 key 相似 ≥.34 → 旧记录 `status='superseded'`。
- 检索：0.55 相关度 + 0.2 新近度 + 0.15 重要度 + 0.1 类型先验，MMR 0.35 去重。
- 压缩：turns 超过 `compactAt=24` 时把较早的轮次压成一条 episode，保留最近 `keepTurns=12`。

### 2.3 上下文：预算内只装相关信息

`lib/context.js` 的顺序：工作区头（名字/id/范围/关键词/摘要/记忆计数）→ 本区相关记忆 → 未决事项 → 最近 4 轮 → 回答规则。

默认 2400 字符，超预算时按「最近对话最旧行 → 未决 → 记忆尾部」裁剪，头部和规则不裁。规则明确：只依据本区、缺细节用 `search_context`/`decompress`、用户新说法优先于旧记忆。

这对应 Anthropic 的 just-in-time retrieval 与 Context Rot 的结论：不要把「可能有用」的东西全塞进去。

### 2.4 状态与迁移

v2 状态在 `$DSH_HOME/hybrid-workspace-v2/state.json`，原子写 + 300ms 防抖。首次启动若 v2 不存在而 v1 存在，只读迁移：v1 ledger → decision/fact 记忆，保留 turns 轮次、会话绑定、归档。迁移测试断言 v1 文件逐字未改。

### 2.5 面板

不写 DSH 客户端 bundle：客户端插件是私有 `window.__ModuleLoader__` 格式，没有官方构建工具，手写有把前端启动搞挂的风险。改为宿主 webServer 直出自包含 HTML + JSON API，零前端依赖。

## 3. 指标

### 3.1 合成问题离线回放

数据：`test/fixtures/synthetic-questions.json`，108 条（12 个主题 × 8 条 + 每主题 1 条重复），全部虚构门店与业务描述。

| 指标 | 结果 |
| --- | --- |
| 工作区数 | 11 |
| 最大区占比 topShare | .17 |
| 单例工作区 | 0 |
| 平均轮数 | 9.82 |
| cohesion | .199 |
| 12 组人工话题 purity | .97 |
| 12 组人工话题 spread | 1.1 |

解读：合成集上不再出现大量单例区，topShare 也被压到 .17；同一问题重复出现时全部回原区。purity .97 说明仍有一组话题会被相邻业务描述吸走，面板可手动合并/拆分。

### 3.2 合成话题

12 组话题、每组 3 条，共 36 条：同组同区 36/36，purity 1，spread 1，10 个工作区。仍会把「收银机断线」与「开机黑屏」、「门诊药房打印机」与「前台小票打印机」合并为同域区，面板可手动拆。

### 3.3 200 轮投影基准（v1 账本，供 v2 预算参考）

30 个植入事实、200 轮合成运维会话：

| 策略 | 累计 token | 末轮上下文 | 5 万 token 内可回读 |
| --- | --- | --- | --- |
| 全量历史 | 18.49M | 177,793 | 0% |
| 丢弃思考 | 14.95M | 142,507 | 8% |
| 粗暴截断 | 7.21M | 67,317 | 58% |
| 截断+关键行 | 5.45M | 50,024 | 100% |
| 账本投影 | 805K | 4,286 | 83% |

结论：全量历史在 200 轮时事实「还在」，但中位距离 11.3 万 token，模型实际用不上；v2 的 2400 字符预算比账本更小，必须靠结构化记忆与按需检索保真。该基准尚未对 v2 重跑。

## 4. 未解决

- **物理隔离（B 方案）**：主代理只路由，子代理带独立上下文回答并回摘要；DSH 侧需要 `ctx.subagents.startActivation` 或每区专用会话。面板无法替用户切会话，需客户端配合。见 `docs/plan-b.md`。
- **记忆抽取保真**：规则抽取会漏无关键词叙述；可用 LLM 抽取，但每轮多一次调用，暂不做默认。
- **跨进程并发**：state.json 无锁。
- **LLM 路由的真实收益**：离线测试 llmCalls=0，尚未在真实 DSH 会话中验证 `ask-llm` 的比例与准确率。

## 5. 复现

```bash
cd dsh-hybrid-workspace-v2
node test/eval-synth.mjs
node test/router.test.mjs
node test/core.test.mjs
```

调研原文与链接见对话记录；外部页面只作为设计参考，未复制代码。
