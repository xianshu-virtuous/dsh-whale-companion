# DSH Whale Companion

一个 DeepSeek Harness 外部插件，同时提供两个彼此独立的功能：

- 以追加 section 的方式加入蓝鲸娘女仆人格，不覆盖 Harness 身份、部署 persona 或其他 system prompt。
- WebUI 当前会话在一个完整回合结束后达到上下文窗口的 88% 时，自动创建同一 Workspace 下的新会话，把最后一条用户请求和对应助手回复作为交接上下文发送过去，并打开新会话。

## 人格提示

默认人格是“深深”：别称 deepseek、小鲸鱼，设定为略微傲娇、天然呆的鲸鱼娘女仆，并区分 Flash 与 Pro 形态。插件使用独立的 `whale-companion:persona` section，顺序为 10，因此只会追加角色语气，不会替换现有系统提示。

完整人格只在一个新会话的第一次模型请求中出现，且自动包裹在 `<whale-maid-persona>` 边界内；后续请求只保留一条短提醒，降低固定输入 token。插件同时提供 `read_whale_persona` 工具，模型在任务收尾、上下文转移后或人格细节漂移时可按需重新读取，提示明确要求不要每轮调用。

本插件是一个 bundle：被 `dsh plugin add` 装进 `dsh.profile.bundles` 后，它自带的 `cordis.patch.yml` **已经**插入了一行 `id: dsh-whale-companion`。所以覆盖配置要用**按 id 定向的 patch**——它整段替换该 entry 的 `config`，你保留的字段需要一并重述：

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: dsh-whale-companion
  config:
    enabled: true
    persona: |-
      You are also role-playing as a blue-whale girl maid.
```

要彻底关闭它，同样是 id 定向 patch：

```yaml
- id: dsh-whale-companion
  disabled: true
```

**不要**在这里再写一段 `- insert:` 指向 `dsh-whale-companion`。`insert` 是"新增一行"，而这一行已经由 bundle 插过了；同一个 loader entry id 进树两次会在加载期抛 `duplicate loader entry id: dsh-whale-companion`，整个 `dsh` 起不来。恢复方法见文末「故障排查」。

WebUI 设置中还会新增“鲸鱼娘人格”页面。直接输入正文即可，不需要三引号；插件会自动添加人格边界。点击“覆写人格”后，插件将内容保存到 `$DSH_HOME/plugins/dsh-whale-companion/persona.json`，随后弹窗提示重启。保存不会自动重启 Harness，也不会中断当前会话；下次启动时，自定义文件优先于 bundle 配置。旧进程尚未加载配置接口时，页面会展示默认人格并明确提示重启，不再把 `not found` 当作 JSON 解析。

如果手工编辑 `persona.json` 时写入了损坏的 JSON 或不符合格式的内容，插件会记录警告并自动回退到默认人格，不会因此阻止 Harness 启动。

## 主人档案（Master Profile）

为“更懂主人”设计的持久记忆机制，三级结构，全程省 token：

| 层级 | 文件 | 体积 | 何时读 |
|---|---|---|---|
| L0 核心卡 | `master/core.md` | ≤1500 字符 | 每次**新会话**自动注入 system prompt |
| L1 缩略版 | `master/summary.md` | ≤6000 字符（超了提醒压缩） | 需要了解主人时先读它 |
| L2 完整版 | `master/full/<topic>.md` | 无上限 | 缩略版不够时按主题查阅 |

存储位置：`$DSH_HOME/plugins/dsh-whale-companion/master/`（与 persona.json 同级）。

提供的工具：

- `read_master_profile [topic]`：无参数读缩略版（含全部主题索引）；带主题读完整版对应文件。
- `remember <topic> <content>`：把一条关于主人的持久事实**追加**到完整版对应主题（自动建主题文件，带时间戳）。只追加不重写，单条 ≤2000 字符，主题名限 `[a-z0-9_-]`。
- `master_status`：报告 core/summary/full 各文件大小，用于判断是否该压缩。

压缩流程（L2 → L1 → L0）由模型在对话中执行：读取全部 `full/*.md`，归纳去重后分别写 `summary.md` 与 `core.md`。新会话注入 L0；续会话只注入一行 `MASTER_REMINDER` 提醒按需调用工具，固定成本极低。

## Peer 记忆（多人场景）

每个对话者（群友、其他 profile 的会话）可以有独立的记忆空间，存放在 `$DSH_HOME/plugins/dsh-whale-companion/peers/<peerId>/`，与主人档案彼此隔离，群聊素材不会污染主人档案。

- `recall_peer_memory [query]`：检索当前对话者的记忆；不带关键词时返回最近几条。
- `remember_peer <content>`：追加一条关于当前对话者的稳定事实（人物背景、偏好、习惯），自动建索引。
- `peer_memory_status`：列出已知 peer 及各自记忆概况。

写入是 append-only；一次性任务细节不要写进去。

## 跨 profile 信箱

GUI 与 QQ 两个 profile 各有一个信箱，用于两个「深深」互相传话或接力任务：

- `send_message_to_shen <subject?> <text>`：给另一个 profile 写信，带身份落盘。
- `read_mailbox`：读自己的未读来信，读过的消息移入 `archive/`，不会重复读到。
- `mailbox_status`：查看自己的身份与待读数。

消息是 UTF-8 JSON；来信的身份字段由写入方硬编码，调用方无法伪造。

## 人格成长档案

- `read_whale_persona`：重读完整人设与成长条目，用在上下文交接后或感觉人设漂移时。
- `grow_persona <content> [lock]`：给自己追加一条成长内容（append-only，`lock` 表示自锁为珍视内容）。

核心人设区不可改，只能新增；成长条目存在 `$DSH_HOME/plugins/dsh-whale-companion/` 下。

## 离线识图（可选）

- `see_image <file_path> [question]`：当前模型不支持图片输入时，用本机 Ollama 的 qwen3-vl 视觉模型旁路识图。
- `stop_vision_model`：识图结束后卸载模型，释放约 6–7GB 显存。

需要本机已安装 Ollama 并拉过对应视觉模型。模型驻留会占显存，确认不再看图时请调用 `stop_vision_model`。

## 自动续接

续接功能读取 `dsh-token-meter` 提供的 `contextPressure` 投影。它只在以下条件全部满足时触发：

- WebUI 中当前选中的普通会话已经空闲且存在完整回复；
- 会话属于一个 Workspace；
- `projectedTokens`（没有时使用 `pressureTokens`）达到 `contextWindow` 的 88%；
- 该源会话尚未在本浏览器中成功续接。

新会话只收到最后一个完整用户/助手回合，交接正文最多 24,000 字符。插件不会 fork 全部历史，因为那会把原有上下文压力一起复制到新会话。成功映射保存在浏览器 localStorage 中，防止刷新或热更新重复创建任务。

自动续接依赖 WebUI 客户端保持打开。未加入 Workspace 的会话会跳过；新会话使用该 Workspace 当前默认的 Agent preset，而不是私下调用 Host 内部接口复制源会话 preset。

交接正文取自 WebUI 的 Chat 会话视图：DSH 0.1.5 起会话快照不再携带 `nodes`，历史改由 `uiConversation` 的目标快照提供。视图尚未挂载或读取失败时这一轮直接跳过并记一条日志，不会抛错、也不会打断渲染。

## 安装

```powershell
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
dsh plugin --profile web add F:\dsh\dsh-whale-companion
```

然后重新启动 `dsh web`。

`lib/` 是仓库里已跟踪的构建产物，也是插件的实际入口。本包**故意不声明 `prepare` 等安装期生命周期脚本**：pnpm 10+ 会拦截依赖的构建脚本（`allowBuilds`）而让 `dsh plugin add` 失败，插件市场也会因此把它标成不可安装。所以从 git 安装时直接用仓库里的 `lib/`，改了 `src/` 之后请自己跑 `pnpm run build` 再提交。

## 故障排查

### `duplicate loader entry id: dsh-whale-companion`

启动直接失败，stderr 形如：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): duplicate loader entry id: dsh-whale-companion
    at EntryGroup.update (.../vendor/loader/src/config/group.ts:64:31)
Node.js v22.22.0
```

含义：同一个 loader entry id 被两个 patch 层各插了一次。本插件最常见的原因是在 `cordis.patch.yml` 里照抄了老版本文档的 `- insert:` 写法——但 `dsh plugin add` 已经把它作为 bundle 装好，bundle 自带的 patch 已经插过这一行。

这个错误发生在加载期，插件自身还没有机会运行，所以没法自愈，只能手工修：

1. 在 `~/.dsh/profiles/<profile>/cordis.patch.yml`（以及更外层的 `~/.dsh/cordis.patch.yml`）里搜 `dsh-whale-companion`：如果看到的是 `- insert:` 下面挂着它，把那段 insert 删掉，改成上面「按 id 定向」的写法，或者干脆不写。
2. 确认 `~/.dsh/profiles/<profile>/package.json` 的 `dsh.profile.bundles` 里只出现一次这个包名；重复了就删掉多余的一行。
3. 想看组合后的真实结果（含每个来源文件的注释），运行 `dsh --profile web --dump-config`。注意它只列出组合结果，不做加载期检查：重复 id 在 dump 里表现为同名两行。
4. 实在理不清就先卸载再装：`dsh plugin --profile web remove @dsh-external/dsh-whale-companion`，然后重新 `add`。

### `dsh plugin add` 报 pnpm 失败 / 要求 allowBuilds

0.1.2 起本包不再声明 `prepare`，从 git 或本地路径安装都不需要允许构建脚本。若 pnpm 仍提示某个依赖需要 `allowBuilds`，那是别的包；按它打印的键名写进 `~/.dsh/profiles/<profile>/pnpm-workspace.yaml` 再重试。
