import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createImageUploadStore, UploadQuotaError } from '../src/uploads.js'

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'tmux-webui-uploads-'))
  roots.push(root)
  return root
}

describe('createImageUploadStore', () => {
  it('目录使用 0700，图片使用 0600，并原样保存内容', async () => {
    const root = await tempRoot()
    const dir = path.join(root, 'nested', 'uploads')
    const store = createImageUploadStore({ dir, retentionMs: 60_000, maxBytes: 100 })

    const saved = await store.save(Buffer.from('image-data'), 'png')

    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect((await stat(saved)).mode & 0o777).toBe(0o600)
    expect(await readFile(saved, 'utf8')).toBe('image-data')
  })

  it('已有目录权限过宽时收紧为 0700', async () => {
    const root = await tempRoot()
    const dir = path.join(root, 'uploads')
    await mkdir(dir, { mode: 0o755 })
    await chmod(dir, 0o755)

    const store = createImageUploadStore({ dir, retentionMs: 60_000, maxBytes: 100 })
    await store.cleanup()

    expect((await stat(dir)).mode & 0o777).toBe(0o700)
  })

  it('保存前清理过期的受管图片，但不跟随符号链接或删除无关文件', async () => {
    const root = await tempRoot()
    const dir = path.join(root, 'uploads')
    await mkdir(dir)
    const expired = path.join(dir, 'img-1-deadbeef.png')
    const unrelated = path.join(dir, 'notes.txt')
    const outside = path.join(root, 'outside.png')
    const linked = path.join(dir, 'img-2-cafebabe.png')
    await writeFile(expired, 'old')
    await writeFile(unrelated, 'keep')
    await writeFile(outside, 'outside')
    await symlink(outside, linked)
    await utimes(expired, new Date(0), new Date(0))

    const store = createImageUploadStore({
      dir,
      retentionMs: 1_000,
      maxBytes: 100,
      now: () => 10_000,
    })
    await store.cleanup()

    await expect(lstat(expired)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(unrelated, 'utf8')).toBe('keep')
    expect((await lstat(linked)).isSymbolicLink()).toBe(true)
    expect(await readFile(outside, 'utf8')).toBe('outside')
  })

  it('总量超过配额时拒绝写入，并串行化并发检查', async () => {
    const root = await tempRoot()
    const store = createImageUploadStore({
      dir: path.join(root, 'uploads'),
      retentionMs: 60_000,
      maxBytes: 10,
    })

    const results = await Promise.allSettled([
      store.save(Buffer.alloc(6), 'png'),
      store.save(Buffer.alloc(6), 'jpg'),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({ reason: expect.any(UploadQuotaError) })
  })
})
