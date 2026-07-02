import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTmuxExec } from '../../src/tmux/exec.js'
import { createView, destroyView, selectWindow, cleanupOrphanViews } from '../../src/tmux/view.js'

const SOCKET = 'webui-view-test'
const exec = createTmuxExec(SOCKET)

beforeAll(async () => {
  await exec(['new-session', '-d', '-s', 'demo', '-n', 'first'])
  // 加 -d：tmux new-window 默认会把新建的 window 设为当前 window，
  // 这会让 demo 的 current window 变成 1，破坏"视图 window 独立于原 session"
  // 这个断言的前提（下面测试期望 demo 仍停在 window 0）。加 -d 保持新窗口在后台创建。
  await exec(['new-window', '-t', 'demo', '-n', 'second', '-d'])
})

afterAll(async () => {
  await exec(['kill-server']).catch(() => undefined)
})

describe('view lifecycle', () => {
  it('createView 创建 webui- 前缀的分组会话', async () => {
    const view = await createView(exec, 'demo')
    expect(view.viewName).toMatch(/^webui-[0-9a-f]{8}$/)
    expect(view.target).toBe('demo')
    const out = await exec(['list-sessions', '-F', '#{session_name}\t#{session_group}'])
    const line = out.split('\n').find((l) => l.startsWith(view.viewName))
    expect(line).toBeDefined()
    await destroyView(exec, view.viewName)
  })

  it('createView 指定 windowIndex 时视图当前 window 独立于原 session', async () => {
    const view = await createView(exec, 'demo', 1)
    const out = await exec([
      'display-message',
      '-p',
      '-t',
      view.viewName,
      '#{window_index}',
    ])
    expect(out.trim()).toBe('1')
    const orig = await exec(['display-message', '-p', '-t', 'demo', '#{window_index}'])
    expect(orig.trim()).toBe('0')
    await destroyView(exec, view.viewName)
  })

  it('selectWindow 切换视图的当前 window', async () => {
    const view = await createView(exec, 'demo')
    await selectWindow(exec, view.viewName, 1)
    const out = await exec(['display-message', '-p', '-t', view.viewName, '#{window_index}'])
    expect(out.trim()).toBe('1')
    await destroyView(exec, view.viewName)
  })

  it('destroyView 对不存在的视图不抛错', async () => {
    await expect(destroyView(exec, 'webui-deadbeef')).resolves.toBeUndefined()
  })

  it('cleanupOrphanViews 清理无客户端的旧视图，保留新视图', async () => {
    const view = await createView(exec, 'demo')
    await cleanupOrphanViews(exec, 0) // minAgeSeconds=0：全部无主视图都算孤儿
    const out = await exec(['list-sessions', '-F', '#{session_name}'])
    expect(out).not.toContain(view.viewName)
    expect(out).toContain('demo')
  })
})
