# dsh-whale-companion — 项目索引

## 项目定位
DeepSeek Harness 外部插件：蓝鲸娘女仆「深深」追加人格 + WebUI 自动续接；并含主人档案（L0/L1/L2 持久记忆）、peer 记忆、跨 profile 双向信箱、人格成长档案、离线识图兜底等模块。

## 权威版本
- `package.json`：`name` = `@dsh-external/dsh-whale-companion`，`version` = `0.1.2`
- 入口：`main` = `lib/index.js`；`exports` 含 `./client`（`lib/client.js`）、`./invariant`（`lib/invariant.js`）
- 包管理器：pnpm（`pnpm-lock.yaml`、`pnpm-workspace.yaml`）；无安装期生命周期脚本（不声明 `prepare`/`postinstall`）
- 适配基线：DSH `0.1.5-rc.2`（会话历史改由 `uiConversation` 目标快照提供）

## 活动里程碑
- `baaaf1a` 2026-08-16 — Add whale companion plugin（初始提交）
- `32b84c7` 2026-09-28 — release 0.1.2：修复 `duplicate loader entry id` 启动失败（README insert 误导 + 移除 `prepare`）、适配 DSH 0.1.5 的 handoff、补齐主人档案 / peer 记忆 / 信箱 / 人格成长 / 离线识图五个模块，新增 `AGENTS.md` 与 `PROJECT_INDEX.md`。工作树已随该提交清空并推送到 `origin/main`

## 主要阻塞与风险
- 用户数据（`master/` `peers/` `mailbox/` `persona.json`）位于 `$DSH_HOME/plugins/dsh-whale-companion/`，仓库内不得出现；提交前用 `git status -uall` 复核。
- `lib/` 是已跟踪的构建产物：改 `src/` 必须 `pnpm run build` 后再提交，否则仓库产物与源码不一致。
- 本包是 bundle，自带 patch 已插入 `id: dsh-whale-companion`；任何 patch 层再 `insert` 同一 id 都会让 `dsh` 加载期直接退出（自救步骤见 README「故障排查」）。
- 行为变更未经真机验收：客户端交接逻辑改动后需刷新 WebUI 实测一次自动续接。

## 最后核验日期
2026-09-28：`pnpm run typecheck` / `pnpm test`（54 用例）/ `pnpm run build` 全绿；重复 id 用 `dsh --profile web --patch <dup-insert.yml> --dump-config` 复现（同 id 两行，dump 不报错、加载期才抛）。

## 专题文档
- 仓库规则（自动注入）：`AGENTS.md`
- 使用、安装与故障排查：`README.md`
- 动态上下文：`docs/context/`（尚未创建，按需建立 NOW / MAP / RUNBOOK / DECISIONS / RISKS；旧内容进 `history/`）
