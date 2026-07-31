import { describe, expect, it } from 'vitest'
import { listSessions, parseSessions } from '../../src/tmux/list.js'
import type { TmuxExec } from '../../src/tmux/exec.js'

const SESSIONS = 'admin\t0\tadmin\ncds\t1\tcds\nwebui-abc123\t1\tadmin\n'
const WINDOWS = [
  'admin\t0\tclaude\t1',
  'cds\t0\tclaude\t1',
  'cds\t1\tlogs\t0',
  'webui-abc123\t0\tclaude\t1',
].join('\n') + '\n'
const PANES = [
  'admin\t%0\tcodex\tcodex\trunning\t100',
  'cds\t%1\tclaude\tclaude\tidle\t101',
  'cds\t%2\tcodex\tcodex\trunning\t102',
  // shell 已经重新成为前台进程时，不能让异常退出留下的 option 造成幽灵 badge
  'cds\t%3\tbash\tclaude\trunning\t103',
  // hook 能识别由 wrapper 启动、仅靠进程名看不出来的 agent
  'admin\t%4\tnode\tclaude\tidle\t104',
  'webui-abc123\t%0\tcodex\tcodex\trunning\t105',
].join('\n') + '\n'

describe('parseSessions', () => {
  it('解析 session→windows 树并过滤 webui- 前缀', () => {
    const result = parseSessions(SESSIONS, WINDOWS)
    expect(result).toEqual([
      { name: 'admin', attached: true, windows: [{ index: 0, name: 'claude', active: true }] },
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

  it('同组的 WebUI view 已连接时把目标 session 视为有活跃前台', () => {
    const sessions = [
      'target\t0\ttarget',
      'webui-open\t1\ttarget',
      'closed\t0\tclosed',
      'webui-closed\t0\tclosed',
    ].join('\n')

    expect(parseSessions(sessions, '')).toEqual([
      { name: 'target', attached: true, windows: [] },
      { name: 'closed', attached: false, windows: [] },
    ])
  })

  it('按 pane 聚合 agent，任一同类 pane 运行则 session 为运行中', () => {
    expect(parseSessions(SESSIONS, WINDOWS, PANES)).toEqual([
      {
        name: 'admin',
        attached: true,
        windows: [{ index: 0, name: 'claude', active: true }],
        agents: [
          { kind: 'codex', status: 'running' },
          { kind: 'claude', status: 'idle' },
        ],
      },
      {
        name: 'cds',
        attached: true,
        windows: [
          { index: 0, name: 'claude', active: true },
          { index: 1, name: 'logs', active: false },
        ],
        agents: [
          { kind: 'codex', status: 'running' },
          { kind: 'claude', status: 'idle' },
        ],
      },
    ])
  })

  it('没有 hook 时仍按前台命令识别 agent，但不猜运行状态', () => {
    const panes = 'admin\t%0\tcodex\t\t\t100\ncds\t%1\tclaude\tinvalid\tbusy\t101\n'
    const result = parseSessions(SESSIONS, WINDOWS, panes)
    expect(result[0]?.agents).toEqual([{ kind: 'codex' }])
    expect(result[1]?.agents).toEqual([{ kind: 'claude' }])
  })

  it('Codex 默认 terminal title 可在 hook 未生效前区分运行与等待操作', () => {
    const sessions = 'running\t0\nstopped\t0\n'
    const panes = [
      'running\t%0\tcodex\t\t\t300\t⠙ project',
      'stopped\t%1\tcodex\t\t\t301\t[ . ] Action Required | project',
    ].join('\n')

    expect(parseSessions(sessions, '', panes)).toEqual([
      {
        name: 'running',
        attached: false,
        windows: [],
        agents: [{ kind: 'codex', status: 'running' }],
      },
      {
        name: 'stopped',
        attached: false,
        windows: [],
        agents: [{ kind: 'codex', status: 'idle' }],
      },
    ])
  })

  it('Codex activity spinner 覆盖过期的 idle hook 状态', () => {
    const sessions = 'codex\t0\n'
    const panes = 'codex\t%9\tcodex\tcodex\tidle\t309\t⠹ project\tidle'

    expect(parseSessions(sessions, '', panes)[0]?.agents).toEqual([
      { kind: 'codex', status: 'running' },
    ])
  })

  it('Codex running hook 在静态标题下仍保持运行中', () => {
    const sessions = 'codex\t0\n'
    const panes = 'codex\t%9\tcodex\tcodex\trunning\t309\tproject\trunning'

    expect(parseSessions(sessions, '', panes)[0]?.agents).toEqual([
      { kind: 'codex', status: 'running' },
    ])
  })

  it('同一 Codex pane 的 activity spinner 消失后判定为已停下', () => {
    const activitySeen = new Set<string>()
    const sessions = 'codex\t0\n'

    expect(
      parseSessions(
        sessions,
        '',
        'codex\t%7\tcodex\t\t\t307\t⠦ project',
        '',
        activitySeen,
      )[0]?.agents,
    ).toEqual([{ kind: 'codex', status: 'running' }])
    expect(
      parseSessions(sessions, '', 'codex\t%7\tcodex\t\t\t307\tproject', '', activitySeen)[0]
        ?.agents,
    ).toEqual([{ kind: 'codex', status: 'idle' }])

    // 服务重启时可能首次看到的就是静态 project title；默认 activity 已消失即 idle。
    expect(
      parseSessions(
        sessions,
        '',
        'codex\t%8\tcodex\t\t\t308\tcustom title',
        '',
        new Set(),
      )[0]?.agents,
    ).toEqual([{ kind: 'codex', status: 'idle' }])
  })

  it('识别 Pi、Kimi Code、OpenCode 及 Kimi 的常见命令名', () => {
    const sessions = 'pi\t0\nkimi\t0\nkimi-legacy\t0\nopencode\t0\n'
    const panes = [
      'pi\t%0\tpi\t\t',
      'kimi\t%1\tkimi\tkimi\tidle\t201',
      'kimi-legacy\t%2\tkimi-code\t\t\t202',
      'opencode\t%3\topencode\topencode\trunning\t203',
    ].join('\n')

    expect(parseSessions(sessions, '', panes)).toEqual([
      { name: 'pi', attached: false, windows: [], agents: [{ kind: 'pi' }] },
      {
        name: 'kimi',
        attached: false,
        windows: [],
        agents: [{ kind: 'kimi', status: 'idle' }],
      },
      {
        name: 'kimi-legacy',
        attached: false,
        windows: [],
        agents: [{ kind: 'kimi' }],
      },
      {
        name: 'opencode',
        attached: false,
        windows: [],
        agents: [{ kind: 'opencode', status: 'running' }],
      },
    ])
  })

  it('同类 pane 有未上报状态时不误报全部 idle', () => {
    const panes = 'admin\t%0\tcodex\tcodex\tidle\t100\nadmin\t%1\tcodex\t\t\t101\n'
    expect(parseSessions(SESSIONS, WINDOWS, panes)[0]?.agents).toEqual([{ kind: 'codex' }])
  })

  it('沿 pane shell 的进程树识别 wrapper 内运行的 Claude Code', () => {
    const sessions = 'wrapped\t0\nshell\t0\n'
    const panes = [
      'wrapped\t%8\tbash\t\t\t800',
      // 只有残留标题/option、进程树里没有 agent 时仍应当是普通 Terminal
      'shell\t%9\tbash\tclaude\trunning\t900',
    ].join('\n')
    const processes = [
      '800 1 bash',
      '801 800 bash',
      '802 801 claude',
      '803 802 node',
      '900 1 bash',
    ].join('\n')

    expect(parseSessions(sessions, '', panes, processes)).toEqual([
      {
        name: 'wrapped',
        attached: false,
        windows: [],
        agents: [{ kind: 'claude' }],
      },
      { name: 'shell', attached: false, windows: [] },
    ])
  })

  it('内层 Pi 覆盖旧共享 option 时仍使用外层 Claude 的独立状态', () => {
    const sessions = 'nested\t0\n'
    const panes = [
      'nested',
      '%10',
      'bash',
      'pi',
      'running',
      '1000',
      '',
      '',
      'running',
      '',
      '',
      '',
    ].join('\t')
    const processes = ['1000 1 bash', '1001 1000 claude', '1002 1001 pi'].join('\n')

    expect(parseSessions(sessions, '', panes, processes)).toEqual([
      {
        name: 'nested',
        attached: false,
        windows: [],
        agents: [{ kind: 'claude', status: 'running' }],
      },
    ])
  })
})

describe('listSessions', () => {
  it('用正确的 -F 格式调用 tmux', async () => {
    const calls: string[][] = []
    const exec: TmuxExec = async (args) => {
      calls.push(args)
      if (args[0] === 'list-sessions') return SESSIONS
      if (args[0] === 'list-windows') return WINDOWS
      return PANES
    }
    const result = await listSessions(exec, async () => '')
    expect(result).toHaveLength(2)
    expect(calls[0]).toEqual([
      'list-sessions',
      '-F',
      '#{session_name}\t#{?session_attached,1,0}\t#{session_group}',
    ])
    expect(calls[1]).toEqual([
      'list-windows',
      '-a',
      '-F',
      '#{session_name}\t#{window_index}\t#{window_name}\t#{?window_active,1,0}',
    ])
    expect(calls[2]).toEqual([
      'list-panes',
      '-a',
      '-F',
      '#{session_name}\t#{pane_id}\t#{pane_current_command}\t#{@tmux_webui_agent}\t#{@tmux_webui_status}\t#{pane_pid}\t#{pane_title}\t#{@tmux_webui_status_codex}\t#{@tmux_webui_status_claude}\t#{@tmux_webui_status_pi}\t#{@tmux_webui_status_kimi}\t#{@tmux_webui_status_opencode}',
    ])
  })
})
