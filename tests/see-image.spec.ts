import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { describeImage, describeScriptPath } from '../src/see-image.ts'

describe('whale companion see_image', () => {
  const saved = process.env.DSH_DESCRIBE_IMAGE
  const restore = (): void => {
    if (saved === undefined) delete process.env.DSH_DESCRIBE_IMAGE
    else process.env.DSH_DESCRIBE_IMAGE = saved
  }
  afterEach(restore)

  it('defaults to the describe_image.mjs shipped with the package', () => {
    delete process.env.DSH_DESCRIBE_IMAGE
    const script = describeScriptPath()
    expect(script.endsWith(`scripts${sep}describe_image.mjs`)).toBe(true)
    // 随包分发：默认路径必须真实存在，否则别的用户装上就报“文件不存在”
    expect(existsSync(script)).toBe(true)
  })

  it('honours the DSH_DESCRIBE_IMAGE override', () => {
    process.env.DSH_DESCRIBE_IMAGE = 'C:\\custom\\my_describe_image.mjs'
    expect(describeScriptPath()).toBe('C:\\custom\\my_describe_image.mjs')
  })

  it('ignores a blank override and falls back to the shipped script', () => {
    process.env.DSH_DESCRIBE_IMAGE = '   '
    expect(existsSync(describeScriptPath())).toBe(true)
  })

  it('reports a friendly error instead of a raw spawn failure when the script is missing', async () => {
    process.env.DSH_DESCRIBE_IMAGE = join(tmpdir(), 'dsh-whale-missing-describe-image.mjs')
    const result = await describeImage({ filePath: 'irrelevant.png' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/未找到识图脚本/)
  })
})
