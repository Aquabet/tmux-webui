import { chmod, lstat, mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export type ImageExtension = 'png' | 'jpg' | 'webp' | 'gif'

export class UploadQuotaError extends Error {
  constructor() {
    super('图片存储空间已满，请清理旧图片后重试')
    this.name = 'UploadQuotaError'
  }
}

interface UploadStoreOptions {
  dir: string
  retentionMs: number
  maxBytes: number
  now?: () => number
}

interface ImageUploadStore {
  cleanup(): Promise<void>
  save(data: Buffer, extension: ImageExtension): Promise<string>
}

const MANAGED_IMAGE = /^img-\d+-[0-9a-f]{8}\.(?:png|jpg|webp|gif)$/

async function prepareDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  // mkdir 的 mode 不会修正已有目录；自定义路径也必须保持仅属主可访问。
  await chmod(dir, 0o700)
}

async function managedFiles(
  dir: string,
): Promise<Array<{ path: string; size: number; mtimeMs: number }>> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: Array<{ path: string; size: number; mtimeMs: number }> = []
  for (const entry of entries) {
    if (!MANAGED_IMAGE.test(entry.name) || !entry.isFile()) continue
    const file = path.join(dir, entry.name)
    // lstat 不跟随符号链接；即使目录项在 readdir 后被替换，也不会读到目录外。
    const info = await lstat(file).catch(() => undefined)
    if (info?.isFile()) files.push({ path: file, size: info.size, mtimeMs: info.mtimeMs })
  }
  return files
}

export function createImageUploadStore(options: UploadStoreOptions): ImageUploadStore {
  const now = options.now ?? Date.now
  let tail = Promise.resolve()

  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async function cleanupUnlocked(): Promise<void> {
    await prepareDirectory(options.dir)
    const cutoff = now() - options.retentionMs
    for (const file of await managedFiles(options.dir)) {
      if (file.mtimeMs < cutoff) await unlink(file.path).catch(() => undefined)
    }
  }

  return {
    cleanup: () => exclusive(cleanupUnlocked),
    save: (data, extension) =>
      exclusive(async () => {
        await cleanupUnlocked()
        const used = (await managedFiles(options.dir)).reduce((total, file) => total + file.size, 0)
        if (used + data.length > options.maxBytes) throw new UploadQuotaError()

        // flag=wx 让极小概率的随机文件名碰撞变成失败，而不是覆盖已有截图。
        const file = path.join(
          options.dir,
          `img-${now()}-${randomBytes(4).toString('hex')}.${extension}`,
        )
        await writeFile(file, data, { mode: 0o600, flag: 'wx' })
        return file
      }),
  }
}
