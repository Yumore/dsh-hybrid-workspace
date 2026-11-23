# 宿主 profile 插件清理记录（2026-11-23）

> 这是一次本机 profile 的维护记录，不属于插件运行逻辑。公开仓库保留它，是为了说明为什么移除了两个插件；不包含凭据、门店或会员数据。

## 移除

| 包 | 版本 | 原因 |
| --- | --- | --- |
| `dsh-context` | 0.84.0 | 只做上下文洞察/仪表板，不做压缩、不注射上下文；上下文构成已并入 hybrid-workspace 面板的「上下文构成 · 所有工作区」。缓存文件长期未更新，属于装过但最近没用。 |
| `@deepseek-ai/dsh-experimental-plugin-market-bundle` | 0.2.1-rc.3 | 官方 README 明确说「There is no official market; Discover lists only the index sources the user adds.」；它只提供 Installed/Discover、`pluginMarket` 服务和 `plugin_market` 工具，索引源为空时是空壳。 |

## 保留

- `dshmarket` 1.73.19：完整社区市场（搜索、一键安装、更新、备份），dsh 0.2.1+ 的 Plugins 页 Plugin Market tab。
- `billion-context`：上下文压缩内核，和 dsh-context 不是同一层。
- `dsh-auto-memory`：跨 App 文件型记忆真源，和 hybrid-workspace 的分工是「全局档案 vs 工作区记忆」。
- `dsh-cost-meter`：费用/额度账本，仍在活跃使用；与面板的 token 估算定位不同。

## 操作与回滚

- 只改 profile 的 `package.json`：从 `dependencies` 与 `dsh.profile.bundles` 删除上述两个包；`cordis.patch.yml` 没有这两个包的条目，无需改。
- `node_modules` 目录保留，便于回滚。
- 清理前/后的 manifest 备份在 profile 目录：`package.json.bak-20261123T100814-original` 与 `package.json.bak-20261123T100814-removed`。
- 回滚：把两个包名加回 `dependencies` 与 `dsh.profile.bundles`，重启 DeepSeek Harness。
- 改动要重启 DSH 才生效；清理记录本身不触发重启。
