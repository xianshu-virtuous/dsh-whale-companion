// describe_image.mjs —— 用 Ollama 本地视觉模型描述一张图片（离线、免费）
//
// 用法:
//   node describe_image.mjs <图片路径> ["要问的问题(可选)"]
//   node describe_image.mjs <图片路径> --ask "针对图里某处提问"
//
// 原理: 走 Ollama OpenAI 兼容接口 /v1/chat/completions，把图片 base64 发给
//       支持图片输入的视觉模型，返回的文字描述直接打印到 stdout。
//       调用方是 see_image 工具（src/see-image.ts）。
//
// 依赖: 本机 Ollama 服务已安装一个视觉模型（默认 qwen3-vl-vision:latest）。
//
// 环境变量:
//   OLLAMA_BASE_URL      完整服务地址，优先于下面两项（默认 http://127.0.0.1:<PORT>）
//   OLLAMA_PORT          Ollama 端口（默认 11434）
//   OLLAMA_VISION_MODEL  视觉模型名（默认 qwen3-vl-vision:latest）
//
// 退出码: 1 参数/格式错误，2 HTTP 失败，3 模型空回复。

import { readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'

const PORT = process.env.OLLAMA_PORT || 11434
const BASE = (process.env.OLLAMA_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '')
const MODEL = process.env.OLLAMA_VISION_MODEL || 'qwen3-vl-vision:latest'

const [, , ...argv] = process.argv
const pathArg = argv.find(a => !a.startsWith('--'))
const askIdx = argv.indexOf('--ask')
const question = askIdx >= 0 && argv[askIdx + 1] ? argv[askIdx + 1] : null
// 或第二个位置参数作为问题
const fallbackQ = argv.indexOf('--ask') === -1 && argv[2] && !argv[2].startsWith('--') ? argv[2] : null
const text = question ?? fallbackQ ?? '请用中文简要描述这张图片的内容，你看到了什么？'

if (!pathArg) {
  console.error('usage: node describe_image.mjs <图片路径> ["问题"] [--ask "问题"]')
  process.exit(1)
}
const imgPath = resolve(pathArg)

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
const ext = extname(imgPath).toLowerCase()
const mime = MIME[ext]
if (!mime) {
  console.error(`不支持的图片格式: ${ext}（仅支持 png/jpg/jpeg/webp/gif）`)
  process.exit(1)
}
const b64 = readFileSync(imgPath, 'base64')

const payload = {
  model: MODEL,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
      ],
    },
  ],
  max_tokens: 600,
  stream: false,
}

async function main() {
  const resp = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) {
    const errBody = (await resp.text()).slice(0, 500)
    console.error(`请求失败 HTTP ${resp.status}: ${errBody}`)
    process.exit(2)
  }
  const data = await resp.json()
  const answer = data.choices?.[0]?.message?.content?.trim()
  if (!answer) {
    console.error('模型未返回内容')
    process.exit(3)
  }
  console.log(answer)
}

main().catch(e => { console.error('DESCRIBE_FAILED:', e.message); process.exit(1) })
