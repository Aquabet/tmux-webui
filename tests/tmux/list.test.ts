import { describe, expect, it } from 'vitest'
import { listSessions, parseSessions } from '../../src/tmux/list.js'
import type { TmuxExec } from '../../src/tmux/exec.js'

const SESSIONS = 'admin\t0\ncds\t1\nwebui-abc123\t1\n'
const WINDOWS = [
  'admin\t0\tclaude\t1',
  'cds\t0\tclaude\t1',
  'cds\t1\tlogs\t0',
  'webui-abc123\t0\tclaude\t1',
].join('\n') + '\n'

describe('parseSessions', () => {
  it('解析 session→windows 树并过滤 webui- 前缀', () => {
    const result = parseSessions(SESSIONS, WINDOWS)
    expect(result).toEqual([
      { name: 'admin', attached: false, windows: [{ index: 0, name: 'claude', active: true }] },
      {
        name: 'cds',
        attached: true,
        windows: [
          { index: 0, name: 'claude', active: true },
          { index: 1, name: 'logs', active: false },
        ],
      },
    ])
  })

  it('空输入返回空数组', () => {
    expect(parseSessions('', '')).toEqual([])
  })
})

describe('listSessions', () => {
  it('用正确的 -F 格式调用 tmux', async () => {
    const calls: string[][] = []
    const exec: TmuxExec = async (args) => {
      calls.push(args)
      return args[0] === 'list-sessions' ? SESSIONS : WINDOWS
    }
    const result = await listSessions(exec)
    expect(result).toHaveLength(2)
    expect(calls[0]).toEqual([
      'list-sessions',
      '-F',
      '#{session_name}\t#{?session_attached,1,0}',
    ])
    expect(calls[1]).toEqual([
      'list-windows',
      '-a',
      '-F',
      '#{session_name}\t#{window_index}\t#{window_name}\t#{?window_active,1,0}',
    ])
  })
})
