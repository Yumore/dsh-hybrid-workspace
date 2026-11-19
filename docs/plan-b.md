# B 方案：一工作区一会话（勘察记录）

目标：每个工作区一个独立 DSH 会话，历史与 billion-context 压缩树都按区物理隔离，单聊天框通过自动转交保持体验。

## 现状

v2 已实现「逻辑隔离」：路由 + 只注入当前区的记忆与最近对话。会话原始历史仍在 DSH 会话日志里，没有物理切分。B 是 opt-in 的下一步，默认不启用。

## 已核实的 API（本机 App 内置 DSH）

- `ctx.subagents.startActivation(spec)` → Promise<activation>
  - spec: `{ provider, label, prompt: ContentBlock[], parent: Agent, delivery: 'caller' | 'parent', signal?, cwd? }`
  - `activation.result` 是 thenable，resolve 为 `{ output: ContentBlock[], stopReason: 'completed' | 'error' | ... }`
  - `delivery: 'caller'` 时不注入“结果投递”指导、不需要 sessionPersistence；结果只在调用方手里。
  - 参考：`dsh-workflow-ptc/lib/index.js`（startActivation + await record.run.result）、`dsh-tool-subagent/lib/index.js`（parent 投递形态）。
- 子代理默认新建会话；要复用同一子会话需保留 childId 并按 continuable 路径再次投递，本插件目前没有稳定句柄。
- `ctx.agents.create()` 可在调用方提供的 SessionId 下建全新会话与 agent；`ctx.agents.get(id)` 取回 Agent。

## 形态 1：自动转交（单框不变）

主会话注册工具 `workspace_ask(question)`：

1. 读取当前会话绑定的工作区；
2. `startActivation({ provider: 'spawn', delivery: 'caller', parent, prompt: [工作区卡 + 相关记忆 + 问题] })`；
3. `await result.output`，把文本作为工具结果返回；
4. 主模型据此回答（或直接转述）。

优点：体验不变；子会话物理隔离；子代理上下文可独立压缩。
代价：每条消息多一次模型调用；子回答全文进主会话工具结果，token 未必省；需要子代理 provider 可用；取消/超时/错误要补齐。

## 形态 2：专用会话（手动切换）

每个工作区用 `ctx.agents.create` 建一个会话，seed 该区的卡与记忆；用户在 GUI 会话列表切换。

优点：真正的“一区一会话”，billion-context 压缩树天然分开；无额外模型调用。
阻塞：插件无法替用户在 GUI 切会话；会话标题/归属需要客户端配合（客户端 bundle 无官方构建工具）。

## 建议

v2 先用逻辑隔离跑一段时间，观察 decisions.log、trace.jsonl 与 token 数据。若跨区原文干扰仍是主要问题，再做形态 1 的 opt-in（workspace_ask），不设为默认；形态 2 等官方客户端扩展点。
