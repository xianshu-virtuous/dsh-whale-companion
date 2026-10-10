# DECISIONS — 设计决策

## 2026-10-11 · 表情包模块：为什么重做、怎么做

### 背景

现有 `@dsh-external/dsh-stickers`（24 张表情 / 硬编码 catalog / 打包 75MB 素材）有两个根本问题：

1. **素材权利**：一部分沿用 **DSH 官方贴纸**，黑鲸娘 24 张由 **少女阿原（@ayuanwong）绘制**，文案创意来自内测群反馈 → **不能随插件分发**（微信投稿那条线也一直卡在"投稿人权利"）。
2. **机制落后**（对照 MoFox 的 `emoji_sender`）：素材必须打包、ID 硬编码、文案人工写、无使用去重。

代码本身是 **BSD-3-Clause**（可并入，保留 `Copyright (c) 2026, DSH External contributors` 即可），但**机制要重写**。

### 决定

在 whale-companion 内新增 **stickers 模块**（`src/stickers/`），学 MoFox `emoji_sender` 的设计：

| 维度 | 做法 |
|---|---|
| **素材来源** | **用户自己放** —— `$DSH_HOME/plugins/dsh-whale-companion/stickers/`；插件不含任何图片 |
| **文件命名** | 内容 **sha256**（与 MoFox 同款）→ 天然去重 + 稳定 id |
| **打标签** | 异步：扫描未入库的图 → 视觉模型 + 人格上下文 → `{ 描述, 情感标签, 是否收藏 }` |
| **索引** | `stickers/index.json`：`{ id, file, description, tags[], addedAt }` |
| **暴露给 LLM** | `search_stickers(描述, tags)` → 候选列表 → `send_sticker(id)` 发送 |
| **去重** | 每个会话记住最近 N 张（默认 6），检索时过滤；全被滤掉则回退全量 |
| **上限** | `maxStickers`（默认 200），达到后停止入库 |

### 技术取舍

- **不引入向量库**：DSH 0.2.0 **没有**内置 embedding（MoFox 用的是 ChromaDB）。表情包量级（几十~几百张）用「标签过滤 + 把候选交给 LLM 挑」足够，且**零新依赖**；将来上千张再议。
- **打标签走 DSH 的 llm 服务**（复用当前路由的多模态模型）；无多模态路由时回落本机 Ollama `qwen3-vl`（`see_image` 那套已具备该能力）。
- **保留 `send_sticker(id)` 直接发送**：whale 的人设已依赖这个用法（每轮最多一个、按语境发），不能破坏。
- **不迁移现有素材进仓库**；本机可将现有 24 张放进用户目录自用（个人使用，不涉分发）。

### 与 MoFox `emoji_sender` 的对照（参考实现要点）

- 入库：定时抽样 → VLM 注入人格判断"是否收藏" → 输出**描述 + 情感 tag** → 复制到 `memes/`（sha256 命名）→ 描述 embedding 入向量库
- 发送两种模式：`direct`（给描述+tag，插件按向量距离+温度采样直接发）/ `picker`（`search_emoji_memes` 看候选 → 按 id 发）
- 细节：情感 tag 内置常量；`temperature` 避免代表性表情被反复选中；`[dedup] window=6`；`max_memes=200`
- 我们的差异：**去掉向量层**（改 LLM 挑候选），其余照搬

### 已实现（0.3.0）

- [x] `src/stickers/store.ts`：目录扫描、sha256 短 id、`index.json` 原子读写、素材被删后自动清理条目
- [x] `src/stickers/tagging.ts`：Ollama 视觉模型打标签（描述 + 18 个情感标签，非白名单标签丢弃、回复容错解析）
- [x] `src/stickers/index.ts`：工具 `search_stickers` / `send_sticker` / `sync_stickers` + 图片路由 + 启动后台同步
- [x] 客户端 `tool.call.toolview` 卡片（`src/client/StickerCard.tsx`，按 0.2.0 的三态 `phase` 取参数）
- [x] 测试 12 例（`tests/stickers.spec.ts`）+ README 用法章节

### 待办

- [ ] 客户端「用户选择器」（输入框右侧点选表情）——当前只打通了 Agent 侧工具链
- [ ] 可选：打标签改走 DSH 路由的多模态模型（当前固定本机 Ollama，无多模态路由时是更稳的选择）
