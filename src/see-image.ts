/**
 * see_image 工具：用本机 Ollama 视觉模型描述一张图片（离线免费）。
 *
 * 背景：`read_image` 需要在当前路由的模型声明 image 输入时才放行。深深在
 * 文本模型（如 deepseek-v4-flash）上读图会被拒，此时本工具旁路：把图片交给
 * 本机 qwen3-vl（Ollama，OpenAI 兼容接口）识别成文字，再作为工具返回的文本
 * 交给文本模型。若当前模型已声明 image 输入（Claude / grok / vision 变体），
 * 调用方（index.ts 的 see_image）会改走 read_image 原生识图，不再旁路。
 *
 * 显存契约（配合 stop_vision_model 使用）：
 *  - qwen3-vl 4.4B 加载到 GPU 约占 ~6-7GB，会与桌面应用抢显存。
 *  - 工具描述指引深深：任务仍需看图时让模型驻留（快）；确定不再看图后
 *    立即调用 stop_vision_model 释放 GPU，保持机器流畅。
 * @module @dsh-external/dsh-whale-companion/src/see-image
 */

import { execFile } from 'node:child_process'

export interface DescribeImageInput {
  filePath: string
  question?: string
}

export interface DescribeImageResult {
  ok: boolean
  text?: string
  error?: string
}

/** describe_image 脚本的绝对路径；可用环境变量 DSH_DESCRIBE_IMAGE override。 */
export function describeScriptPath(): string {
  const fromEnv = process.env.DSH_DESCRIBE_IMAGE
  if (fromEnv) return fromEnv
  // 本机默认位置（主人 F 盘工作区）。
  return 'F:\\dsh\\_grow\\describe_image.mjs'
}

/**
 * 用本机 Ollama qwen3-vl 描述一张图片，返回文字描述。
 * 通过 `node describe_image.mjs <path> [question]` 子进程完成。
 */
export function describeImage(input: DescribeImageInput, timeoutMs = 120000): Promise<DescribeImageResult> {
  const { filePath, question } = input
  const script = describeScriptPath()
  const args = [script, filePath]
  if (question) args.push(question)

  return new Promise((resolve) => {
    execFile(process.execPath ?? 'node', args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, _stderr) => {
      if (err) {
        const stderrTrim = String(_stderr ?? '').trim()
        resolve({ ok: false, error: stderrTrim || err.message })
        return
      }
      const text = String(stdout ?? '').trim()
      if (!text) {
        resolve({ ok: false, error: '模型未返回内容' })
        return
      }
      resolve({ ok: true, text })
    })
  })
}

/** 默认要卸载的视觉模型镜像名。 */
export const STOPPABLE_MODEL = 'qwen3-vl-vision:latest'

export interface StopVisionResult {
  ok: boolean
  hint?: string
}

/**
 * 卸载本机 Ollama 视觉模型，释放 GPU 显存。
 * 依赖 ollama 命令在 PATH。模型未驻留时视为已释放（ok）。
 */
export function stopVisionModel(timeoutMs = 20000): Promise<StopVisionResult> {
  return new Promise((resolve) => {
    execFile('ollama', ['stop', STOPPABLE_MODEL], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        const raw = String(stderr ?? '').trim()
        if (/not running|not loaded|does not exist/i.test(raw)) {
          resolve({ ok: true, hint: '视觉模型当前未驻留，无需释放（显存本来就没占）' })
        } else {
          resolve({ ok: false, hint: `卸载失败：${raw || err.message}` })
        }
      } else {
        const out = String(stdout ?? '').trim()
        resolve({ ok: true, hint: out ? `视觉模型已卸载：${out}` : '视觉模型已卸载，显存已释放' })
      }
    })
  })
}

