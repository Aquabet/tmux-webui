import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createClaudeProvider } from '../../src/planUsage/claude.js'

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'tmux-webui-claude-'))
  roots.push(root)
  return root
}

// 本地时间正午，避免「今日」窗口跨午夜的歧义
const NOW = new Date(2026, 7, 13, 12, 0, 0).getTime()

function assistantLine(options: {
  timestamp: number
  messageId?: string
  requestId?: string
  input?: number
  output?: number
  cacheCreation?: number
  cacheRead?: number
}): string {
  return `${JSON.stringify({
    type: 'assistant',
    timestamp: new Date(options.timestamp).toISOString(),
    requestId: options.requestId ?? `req_${options.timestamp}`,
    message: {
      id: options.messageId ?? `msg_${options.timestamp}`,
      role: 'assistant',
      usage: {
        input_tokens: options.input ?? 0,
        output_tokens: options.output ?? 0,
        cache_creation_input_tokens: options.cacheCreation ?? 0,
        cache_read_input_tokens: options.cacheRead ?? 0,
      },
    },
  })}\n`
}

async function writeTranscript(root: string, project: string, name: string, content: string) {
  const dir = path.join(root, project)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), content)
}

function tokensWindow(
  usage: Awaited<ReturnType<ReturnType<typeof createClaudeProvider>['collect']>>,
  label: string,
) {
  const win = usage.windows.find((w) => w.label === label)
  if (win?.kind !== 'tokens') throw new Error(`missing tokens window ${label}`)
  return win
}

describe('createClaudeProvider', () => {
  it('目录不存在时报告 unavailable', async () => {
    const root = await tempRoot()
    const provider = createClaudeProvider({
      projectsDir: path.join(root, 'missing'),
      now: () => NOW,
    })
    const usage = await provider.collect()
    expect(usage.providerId).toBe('claude')
    expect(usage.status).toBe('unavailable')
  })

  it('统计最近 5 小时与今日的 token 总量', async () => {
    const root = await tempRoot()
    await writeTranscript(
      root,
      'proj-a',
      'a.jsonl',
      // 1 小时前：算进 5h 和今日
      assistantLine({ timestamp: NOW - 3600_000, input: 100, output: 50 }) +
        // 6 小时前（今天 06:00）：只算今日
        assistantLine({ timestamp: NOW - 6 * 3600_000, input: 1000, output: 0 }),
    )
    const provider = createClaudeProvider({ projectsDir: root, now: () => NOW })
    const usage = await provider.collect()
    expect(usage.status).toBe('ok')
    expect(tokensWindow(usage, '5h').tokens).toBe(150)
    expect(tokensWindow(usage, 'today').tokens).toBe(1150)
    expect(usage.lastActivityAt).toBe(NOW - 3600_000)
  })

  it('cache token 计入总量', async () => {
    const root = await tempRoot()
    await writeTranscript(
      root,
      'proj-a',
      'a.jsonl',
      assistantLine({
        timestamp: NOW - 60_000,
        input: 10,
        output: 20,
        cacheCreation: 30,
        cacheRead: 40,
      }),
    )
    const provider = createClaudeProvider({ projectsDir: root, now: () => NOW })
    const usage = await provider.collect()
    expect(tokensWindow(usage, '5h').tokens).toBe(100)
  })

  it('同一 message id + requestId 只计一次（流式重复写入）', async () => {
    const root = await tempRoot()
    const line = assistantLine({
      timestamp: NOW - 60_000,
      messageId: 'msg_dup',
      requestId: 'req_dup',
      input: 100,
    })
    await writeTranscript(root, 'proj-a', 'a.jsonl', line + line)
    const provider = createClaudeProvider({ projectsDir: root, now: () => NOW })
    const usage = await provider.collect()
    expect(tokensWindow(usage, '5h').tokens).toBe(100)
  })

  it('聚合多个项目目录', async () => {
    const root = await tempRoot()
    await writeTranscript(
      root,
      'proj-a',
      'a.jsonl',
      assistantLine({ timestamp: NOW - 60_000, input: 1 }),
    )
    await writeTranscript(
      root,
      'proj-b',
      'b.jsonl',
      assistantLine({ timestamp: NOW - 120_000, input: 2 }),
    )
    const provider = createClaudeProvider({ projectsDir: root, now: () => NOW })
    const usage = await provider.collect()
    expect(tokensWindow(usage, '5h').tokens).toBe(3)
  })

  it('mtime 早于今日零点的文件不读取', async () => {
    const root = await tempRoot()
    await writeTranscript(
      root,
      'proj-old',
      'old.jsonl',
      // 内容时间戳落在 5h 窗口内，但 mtime 很旧——按 mtime 过滤后不应被统计
      assistantLine({ timestamp: NOW - 60_000, input: 999 }),
    )
    const oldTime = new Date(NOW - 3 * 24 * 3600_000)
    await utimes(path.join(root, 'proj-old', 'old.jsonl'), oldTime, oldTime)
    const provider = createClaudeProvider({ projectsDir: root, now: () => NOW })
    const usage = await provider.collect()
    expect(usage.status).toBe('unavailable')
  })

  it('损坏行与非 assistant 行不影响统计', async () => {
    const root = await tempRoot()
    await writeTranscript(
      root,
      'proj-a',
      'a.jsonl',
      '{"broken\n' +
        `${JSON.stringify({ type: 'user', timestamp: new Date(NOW - 60_000).toISOString() })}\n` +
        assistantLine({ timestamp: NOW - 60_000, input: 7 }),
    )
    const provider = createClaudeProvider({ projectsDir: root, now: () => NOW })
    const usage = await provider.collect()
    expect(tokensWindow(usage, '5h').tokens).toBe(7)
  })
})
