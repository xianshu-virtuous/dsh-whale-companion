# dsh-whale-companion — 仓库规则

## 项目定位
DeepSeek Harness 外部插件（`@dsh-external/dsh-whale-companion`）。以追加 section 的方式加入鲸鱼娘「深深」人格，不覆盖 Harness 身份与其他 system prompt；同时提供 WebUI 会话达到上下文窗口 88% 时的自动续接。另含主人档案、peer 记忆、跨 profile 信箱、人格成长等模块。

## 硬性边界与约定
- 人格一律以追加 section 注入（`whale-companion:persona`，order 10），**不得**替换或覆盖 Harness 身份、部署 persona、其他 system prompt。
- 用户数据只落在 `$DSH_HOME/plugins/dsh-whale-companion/` 下，禁止复制进仓库或提交：
  - `master/`（`core.md` L0 / `summary.md` L1 / `full/<topic>.md` L2）
  - `persona.json`（用户覆写的人格）
  - `peers/`（每个 peer 的独立记忆空间）
  - `mailbox/`（`to-gui/` `to-qq/` `archive/`）
- 信箱消息的身份字段 `from` 由写入方硬编码，不得让调用方伪造；消息为 UTF-8 JSON 落盘。
- 手工编辑 `persona.json` 损坏时，须回退默认人格并记录警告，绝不能阻止 Harness 启动。
- `master/full/*.md` 的写入是**追加**（append-only），不改写既有内容；单条 ≤2000 字符。
- `lib/` 是构建产物但已被 git 跟踪（`main: lib/index.js`），改 `src/` 后需重新构建，不要在未构建时提交。
- **不得声明 `prepare`/`postinstall` 等安装期生命周期脚本**：pnpm 10+ 会拦截依赖的构建脚本（需 `allowBuilds`）而使 `dsh plugin add` 失败，插件市场也据此判为不可安装。插件入口依赖仓库里已跟踪的 `lib/`。
- 本包是 bundle：自带的 `cordis.patch.yml` 已插入 `id: dsh-whale-companion`。文档里给用户的覆盖/关闭示例必须用 **id 定向 patch**（`config:` / `disabled: true`），**禁止**再教用户写 `insert` 同一 id——那会让 loader entry id 重复，`dsh` 在加载期直接抛 `duplicate loader entry id` 而无法启动。

## 构建与验收
- 包管理器：pnpm（依据 `pnpm-lock.yaml`、`pnpm-workspace.yaml`）。
- 命令逐字取自 package.json scripts：`pnpm run build`（tsdown）、`pnpm run typecheck`（tsc -p tsconfig.json --noEmit）、`pnpm test`（vitest run --config vitest.config.ts）。
- 单元测试位于 `tests/*.spec.ts`（handoff / persona / mailbox / peer-memory / persona-growth / tools）。

## 文档路由
- 项目状态看 `PROJECT_INDEX.md`。
- 动态上下文放 `docs/context/`（NOW / MAP / RUNBOOK / DECISIONS / RISKS）。
- 旧内容进 `history/`。
