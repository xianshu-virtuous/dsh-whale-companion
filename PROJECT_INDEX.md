# dsh-whale-companion — 项目索引

## 项目定位
DeepSeek Harness 外部插件：蓝鲸娘女仆「深深」追加人格 + WebUI 自动续接；并含主人档案（L0/L1/L2 持久记忆）、peer 记忆、跨 profile 双向信箱、人格成长档案等模块。

## 权威版本
- `package.json`：`name` = `@dsh-external/dsh-whale-companion`，`version` = `0.1.1`
- 入口：`main` = `lib/index.js`；`exports` 含 `./client`（`lib/client.js`）、`./invariant`（`lib/invariant.js`）
- 包管理器：pnpm（存在 `pnpm-lock.yaml`、`pnpm-workspace.yaml`）

## 活动里程碑
- `baaaf1a` 2026-08-16 — Add whale companion plugin。仓库唯一提交（`git rev-list --count HEAD` = 1），分支 `main`，远端 `origin` = https://github.com/xianshu-virtuous/dsh-whale-companion.git
- 该提交之后的开发（主人档案、peer 记忆、信箱、人格成长、`see-image` 等 `src/*.ts` 与对应测试）**尚未提交**，只存在于工作树。

## 主要阻塞与风险
- 工作树脏（历史遗留，未提交）：`git status --porcelain` 共 **21** 条 = 11 条已跟踪改动 + 10 条未跟踪文件（不含本次新增的 `AGENTS.md` / `PROJECT_INDEX.md`；计入后为 23 条）。
  - 已跟踪改动示例：`src/index.ts`、`src/shared/persona.ts`、`README.md`
  - 未跟踪示例：`src/mailbox.ts`、`src/master-profile.ts`、`tests/tools.spec.ts`
- 用户数据风险：主人档案 / 信箱 / peer 记忆 / `persona.json` 位于 `$DSH_HOME/plugins/dsh-whale-companion/`（仓库之外），提交或同步公开仓库前需确认这些数据未被纳入。
- `lib/` 构建产物已被 git 跟踪，`src/` 改动后未重新构建会导致仓库内产物与源码不一致。

## 最后核验日期
2026-09-24（本次核验基于 `README.md`、`package.json`、`git log -5 --date=short`、`git status --porcelain`、`src/` 与 `tests/` 文件清单，未运行构建或测试）

## 专题文档
- 仓库规则（自动注入）：`AGENTS.md`
- 使用与安装说明：`README.md`
- 动态上下文：`docs/context/`（本仓库当前尚未创建该目录，按需建立 NOW / MAP / RUNBOOK / DECISIONS / RISKS；旧内容进 `history/`）
