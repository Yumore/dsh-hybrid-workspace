# dsh-hybrid-workspace v2

一个 DeepSeek Harness 插件：仍然只有一个聊天框，但每句话会先被判断属于哪个「工作区」，回答只装配该工作区的范围、结构化记忆和最近几轮对话。

v2 是对早期 v1 的重构，代码独立成包。

## 它解决什么

- 一个聊天框里混着运维、业务系统、日常杂事，历史越长越互相干扰。
- 全部历史都塞进上下文，既贵又稀释注意力；粗暴截断又会丢结论。
- 手工维护多个会话/多个窗口，切换成本高，还容易把 A 项目的细节带到 B 项目。

v2 的做法不是「物理切分会话」，而是**路由 + 结构化记忆 + 预算化装配**：

```text
用户消息
  → 路由（字段加权 IDF + 迟滞；模糊时才问 LLM）
  → 绑定/新建工作区
  → 抽取记忆（决策/事实/待办/问题），合并、supersede
  → 系统提示词只注入当前工作区的一张卡（默认 ≤2400 字符）
  → 模型回答；回答再回写为记忆
```

## 与 v1 的差异

| 维度 | v1 | v2 |
| --- | --- | --- |
| 路由 | 词面覆盖率，一有命中就换区 | 字段加权 IDF + 迟滞（连续两条才切、短句粘住、强信号直切） |
| 记忆 | 每轮抽 1~3 条「结论账本」平铺 | 分类型记忆 + ADD/NOOP/supersede + 相关度检索 + MMR 去重 |
| 注入 | 最近 10 条账本，与当前问题无关也塞 | 只装与当前问题相关的 top 记忆 + 未决事项 + 最近 4 轮 |
| 预算 | 约 700 token 封顶 | 默认 2400 字符，硬预算，按优先级裁剪 |
| 面板 | 卡片 + 归档 | 增加记忆类型统计、记忆明细、代表性问法、路由判定 trace、合并 |
| 状态 | v1 schema | v2 schema，首次启动只读迁移 v1 |

## 配置

在 profile 的 `cordis.patch.yml` 对应条目下配置；未写的项用默认值。

```yaml
- id: hybrid-workspace
  name: dsh-hybrid-workspace-v2
  config:
    mode: hybrid            # hybrid | lexical | llm
    autoCreate: true
    routeAccept: 0.48       # 接受某个已有工作区的分数线
    sameTopicAccept: 0.3    # 留在当前区所需的最低分
    switchMargin: 0.14      # 候选领先当前区多少才考虑切换
    pendingSwitch: 2        # 连续几条同候选才真正切换
    shortSticky: 12         # 短于该字数的消息粘在当前区
    unseenPenalty: 0.15     # 从未出现过的词按多少 IDF 计权
    contextMaxChars: 2400   # 注入块字符预算
    memoryInject: 8         # 最多注入几条相关记忆
    recentTurns: 4          # 注入最近几轮对话
    memoryKeep: 300         # 每个工作区最多保留多少条记忆
    maxWorkspaces: 60
    archiveKeep: 20
    panelPath: /hybrid-workspace
    debug: true
```

## 面板

插件挂载在宿主 webServer 上（默认 `/hybrid-workspace/`），自包含 HTML + JSON API，无外部资源、无前端构建：

- 工作区卡片：轮数、命中、会话数、范围、关键词、记忆类型统计、记忆明细（superseded 划线）、代表性问法、最近对话。
- 操作：重命名、改范围、合并到另一个区、清空、删除。
- 「最近路由判定」：每条消息选了哪个区、分数、是否调用了 LLM。
- 「已归档」：满额淘汰的快照，可恢复或彻底删除。

## 状态与日志

默认在 `$DSH_HOME/hybrid-workspace-v2/`：

- `state.json`：工作区、记忆、会话绑定、归档；原子写，300ms 防抖。
- `decisions.log`：新建/路由/合并/清空等决策。
- `trace.jsonl`：最近路由判定（候选分数、how 字段）。

v1 的 `$DSH_HOME/hybrid-workspace/state.json` 只在 v2 状态不存在时读取一次用于迁移，**不会修改 v1 文件**。

## 安装

在源码目录执行：

```bash
node scripts/install.mjs                     # dry-run，先看要改什么
node scripts/install.mjs --apply             # 写入 profile
node scripts/install.mjs --apply --replace   # 已装 v1 时：先卸 v1 再装 v2
```

脚本会改四处并备份：profile 的 `package.json`（file: 依赖）、`dsh.profile.bundles`、`cordis.patch.yml`、`node_modules` 软链。装完需要重启 DeepSeek Harness。

`--replace` 会移除 v1 的依赖、bundle、补丁块和软链，但**不会恢复 v1**；v1 的 state.json 仍保留，v2 首次启动会只读迁移。

## 测试

```bash
cd dsh-hybrid-workspace-v2
for f in test/core.test.mjs test/router.test.mjs test/memory.test.mjs \
         test/migration.test.mjs test/autocreate.test.mjs test/state-corrupt.test.mjs \
         test/eval-real.mjs test/ui-smoke.mjs test/load-check.mjs; do
  node "$f"
done
```

测试覆盖：路由与迟滞、记忆抽取/合并/supersede/检索/压缩、v1→v2 迁移、autoCreate=false 时不丢消息、损坏状态备份、真实问题 fixture（本地自备）离线评估、面板 HTTP e2e、最小 ctx 加载。

## 已知边界

- **隔离是提示词级**：会话的原始历史仍在 DSH 会话日志里；v2 只是不把其他区的内容注入当前步骤。真正的物理隔离（一区一会话/子代理）尚未启用，见 `docs/plan-b.md`。
- **记忆抽取是启发式的**：无实体、无线索词的纯叙述句会漏；抽取器是规则，不是模型。
- **路由是词面 + IDF**：同义改写、跨语言、极短指代依赖迟滞或 LLM 兜底；LLM 判定默认只在模糊时调用。
- **单进程状态**：`state.json` 无跨进程锁；同一 `$DSH_HOME` 多实例并发写有风险。
- **面板无鉴权**：依赖宿主 webServer 绑定回环地址；不要暴露到公网。
- **测试数据**：真实问题 fixture 含生产数据，未纳入仓库；缺失时 `test/eval-real.mjs` 自动跳过真实数据部分。
