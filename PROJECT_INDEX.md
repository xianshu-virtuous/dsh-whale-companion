# dsh-whale-companion — 项目索引

## 项目定位
DeepSeek Harness 外部插件：蓝鲸娘女仆「深深」追加人格 + WebUI 自动续接；并含主人档案（L0/L1/L2 持久记忆）、peer 记忆、跨 profile 双向信箱、人格成长档案、离线识图兜底等模块。

## 权威版本
- `package.json`：`name` = `@dsh-external/dsh-whale-companion`，`version` = `0.3.1`
- 入口：`main` = `lib/index.js`；`exports` 含 `./client`（`lib/client.js`）、`./invariant`（`lib/invariant.js`）
- 包管理器：pnpm（`pnpm-lock.yaml`、`pnpm-workspace.yaml`）；无安装期生命周期脚本（不声明 `prepare`/`postinstall`）
- 适配基线：DSH `0.2.0-rc.2`（客户端模块机制改由 `dsh-client-modules` + `PLATFORM_MODULES` 基线驱动；`dsh-client-runtime` 在 0.2.0 已不再分发）

## 活动里程碑
- `baaaf1a` 2026-08-16 — Add whale companion plugin（初始提交）
- `32b84c7` 2026-09-28 — release 0.1.2：修复 `duplicate loader entry id` 启动失败（README insert 误导 + 移除 `prepare`）、适配 DSH 0.1.5 的 handoff、补齐主人档案 / peer 记忆 / 信箱 / 人格成长 / 离线识图五个模块，新增 `AGENTS.md` 与 `PROJECT_INDEX.md`。工作树已随该提交清空并推送到 `origin/main`
- `4164f35` 2026-10-11 — docs + 可移植性：新增 `docs/GETTING-STARTED.md`（三级记忆用法 / L0 模板与 1500 字符硬限制 / 记账习惯 / 压缩流程）；识图脚本 `scripts/describe_image.mjs` 随包分发、默认路径按模块位置定位（不再硬编码本机绝对路径）；默认人格去掉特定主人名
- `b3b272c` 2026-10-11 — release 0.2.0：适配 DSH 0.2.0 —— `dsh.client.inject` 精简为仅 `@deepseek-ai/dsh-client-ui-settings`（`dsh-client-runtime` 在 0.2.0 无此包；`dsh-client-ui-slots` 不再有 client bundle、改为 shell 基线库）；依赖跟到 `0.2.0-rc.2`；已推送 `origin/main`
- 2026-10-11 — release 0.3.0：新增**表情包模块**（`src/stickers/`）——用户自备素材目录 + 视觉模型异步打标签（描述 + 18 个情感标签）+ 标签检索（不引向量，候选交 LLM 自挑）；新增工具 `search_stickers` / `send_sticker` / `sync_stickers`、图片路由 `/api/dsh-whale-companion/stickers/<id>`、客户端 `tool.call.toolview` 卡片；依赖对齐 `schemastery@3.18.4`（消除 3.18.1/3.18.4 双版本类型冲突）

## 主要阻塞与风险
- 用户数据（`master/` `peers/` `mailbox/` `persona.json`）位于 `$DSH_HOME/plugins/dsh-whale-companion/`，仓库内不得出现；提交前用 `git status -uall` 复核。
- `lib/` 是已跟踪的构建产物：改 `src/` 必须 `pnpm run build` 后再提交，否则仓库产物与源码不一致。
- 本包是 bundle，自带 patch 已插入 `id: dsh-whale-companion`；任何 patch 层再 `insert` 同一 id 都会让 `dsh` 加载期直接退出（自救步骤见 README「故障排查」）。
- 行为变更未经真机验收：客户端交接逻辑改动后需刷新 WebUI 实测一次自动续接。
- 0.2.0 只适配到「清单 + 编译」层：前端代码仍以 `import type` 引用 `dsh-client-runtime@0.1.1-rc.2` 的类型（编译期擦除，不影响运行）；若 0.2.x 后续提供新的类型入口可再迁移。

## 最后核验日期
2026-10-11：面向 DSH `0.2.0-rc.2` 跑 `pnpm run typecheck`（通过）/ `pnpm test`（**70 用例全绿**，含新增 stickers 12 例）/ `pnpm run build`（成功）；`lib/client.js` 实际 require 仅 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`（均为 shell 基线）。`duplicate loader entry id` 结论复用 2026-09-28 复现，未重跑。

## 专题文档
- 仓库规则（自动注入）：`AGENTS.md`
- 使用、安装与故障排查：`README.md`
- 新用户上手（记忆三级怎么用、L0 模板、记账习惯、压缩流程）：`docs/GETTING-STARTED.md`
- 动态上下文：`docs/context/`（尚未创建，按需建立 NOW / MAP / RUNBOOK / DECISIONS / RISKS；旧内容进 `history/`）
