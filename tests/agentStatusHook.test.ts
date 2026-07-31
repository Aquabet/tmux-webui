import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const HOOK = path.resolve(import.meta.dirname, '../scripts/agent-status-hook.sh')
const dirs: string[] = []

function fakeTmux(exitCode = 0) {
  const dir = mkdtempSync(path.join(tmpdir(), 'webui-agent-hook-'))
  dirs.push(dir)
  const log = path.join(dir, 'tmux.log')
  const bin = path.join(dir, 'tmux')
  writeFileSync(
    bin,
    [
      '#!/bin/sh',
      'if [ "$1" = "list-panes" ]; then',
      '  printf "%s" "$TMUX_TEST_PANES"',
      `  exit ${exitCode}`,
      'fi',
      'if [ "$1" = "display-message" ]; then',
      '  printf "%s\\n" "$TMUX_TEST_PANE_PID"',
      `  exit ${exitCode}`,
      'fi',
      'printf "%s\\n" "$*" >> "$TMUX_TEST_LOG"',
      `exit ${exitCode}`,
      '',
    ].join('\n'),
  )
  chmodSync(bin, 0o755)
  return { dir, log }
}

function fakePs(
  dir: string,
  processes: Record<number, { parent: number; command: string }>,
) {
  const bin = path.join(dir, 'ps')
  const cases = Object.entries(processes).flatMap(([pid, process]) => [
    `  "-o ppid= -p ${pid}") printf "%s\\n" "${process.parent}" ;;`,
    `  "-o comm= -p ${pid}") printf "%s\\n" "${process.command}" ;;`,
  ])
  writeFileSync(
    bin,
    ['#!/bin/sh', 'case "$*" in', ...cases, '  *) exit 1 ;;', 'esac', ''].join('\n'),
  )
  chmodSync(bin, 0o755)
}

function runHook(
  args: string[],
  options: {
    pane?: string
    pathDir?: string
    log?: string
    tmux?: string
    panes?: string
    panePid?: string
  } = {},
) {
  const env = {
    ...process.env,
    PATH: `${options.pathDir ?? ''}:${process.env.PATH}`,
    TMUX_PANE: options.pane,
    TMUX: options.tmux,
    TMUX_TEST_LOG: options.log,
    TMUX_TEST_PANES: options.panes,
    TMUX_TEST_PANE_PID: options.panePid,
  }
  if (options.pane === undefined) delete env.TMUX_PANE
  if (options.tmux === undefined) delete env.TMUX

  return spawnSync('bash', [HOOK, ...args], {
    encoding: 'utf8',
    env,
  })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('agent-status-hook.sh', () => {
  it('把 provider 与状态写到当前 pane 的 user options', () => {
    const fake = fakeTmux()
    const result = runHook(['codex', 'running'], {
      pane: '%42',
      pathDir: fake.dir,
      log: fake.log,
    })
    expect(result.status).toBe(0)
    expect(readFileSync(fake.log, 'utf8')).toBe(
      [
        'set-option -p -q -t %42 @tmux_webui_status_codex running',
        'set-option -p -q -t %42 @tmux_webui_agent codex',
        'set-option -p -q -t %42 @tmux_webui_status running',
        '',
      ].join('\n'),
    )
  })

  it.each(['codex', 'claude', 'pi', 'kimi', 'opencode'])('接受 %s provider', (provider) => {
    const fake = fakeTmux()
    const result = runHook([provider, 'idle'], {
      pane: '%9',
      pathDir: fake.dir,
      log: fake.log,
    })
    expect(result.status).toBe(0)
    const log = readFileSync(fake.log, 'utf8')
    expect(log).toContain(`@tmux_webui_status_${provider} idle`)
    expect(log).toContain(`@tmux_webui_agent ${provider}`)
  })

  it('接受 waiting，并与一轮结束的 idle 保持不同原始状态', () => {
    const fake = fakeTmux()
    expect(
      runHook(['claude', 'waiting'], { pane: '%9', pathDir: fake.dir, log: fake.log }).status,
    ).toBe(0)
    expect(readFileSync(fake.log, 'utf8')).toContain('@tmux_webui_status_claude waiting')
  })

  it('SessionEnd 能清掉状态，避免 pane 被复用时出现幽灵 badge', () => {
    const fake = fakeTmux()
    const result = runHook(['claude', 'clear'], {
      pane: '%7',
      pathDir: fake.dir,
      log: fake.log,
    })
    expect(result.status).toBe(0)
    expect(readFileSync(fake.log, 'utf8')).toBe(
      [
        'set-option -p -q -u -t %7 @tmux_webui_status_claude',
        'set-option -p -q -u -t %7 @tmux_webui_agent',
        'set-option -p -q -u -t %7 @tmux_webui_status',
        '',
      ].join('\n'),
    )
  })

  it('不在 tmux 中静默跳过；非法参数直接拒绝', () => {
    expect(runHook(['codex', 'idle']).status).toBe(0)
    expect(runHook(['other', 'idle'], { pane: '%1' }).status).not.toBe(0)
    expect(runHook(['codex', 'busy'], { pane: '%1' }).status).not.toBe(0)
    expect(runHook(['codex', 'idle'], { pane: 'not-a-pane' }).status).not.toBe(0)
  })

  it('tmux 2.x 不支持 pane options 时也不干扰 agent', () => {
    const fake = fakeTmux(1)
    const result = runHook(['codex', 'running'], {
      pane: '%2',
      pathDir: fake.dir,
      log: fake.log,
    })
    expect(result.status).toBe(0)
  })

  it('Claude 未传 TMUX_PANE 时能沿父进程链找到所属 pane', () => {
    const fake = fakeTmux()
    const result = runHook(['claude', 'running'], {
      pathDir: fake.dir,
      log: fake.log,
      tmux: '/tmp/tmux-test/default,1,1',
      panes: `%73\t${process.pid}\n`,
    })
    expect(result.status).toBe(0)
    expect(readFileSync(fake.log, 'utf8')).toBe(
      [
        'set-option -p -q -t %73 @tmux_webui_status_claude running',
        'set-option -p -q -t %73 @tmux_webui_agent claude',
        'set-option -p -q -t %73 @tmux_webui_status running',
        '',
      ].join('\n'),
    )
  })

  it('Claude 内嵌套运行的 Codex 不覆盖外层 Claude 状态', () => {
    const fake = fakeTmux()
    fakePs(fake.dir, {
      [process.pid]: { parent: 200, command: 'codex' },
      200: { parent: 300, command: 'timeout' },
      300: { parent: 400, command: 'claude' },
      400: { parent: 1, command: 'bash' },
    })
    const result = runHook(['codex', 'running'], {
      pathDir: fake.dir,
      log: fake.log,
      tmux: '/tmp/tmux-test/default,1,1',
      panes: '%73\t400\n',
      panePid: '400',
    })
    expect(result.status).toBe(0)
    expect(existsSync(fake.log)).toBe(false)
  })
})
