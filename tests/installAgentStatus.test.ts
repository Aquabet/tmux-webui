import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const INSTALLER = path.resolve(import.meta.dirname, '../scripts/install-agent-status.mjs')
const dirs: string[] = []

function tempConfigHome() {
  const dir = mkdtempSync(path.join(tmpdir(), 'webui-agent-config-'))
  dirs.push(dir)
  return dir
}

function runInstaller(configHome: string, providers: string[]) {
  return spawnSync(
    process.execPath,
    [INSTALLER, '--config-home', configHome, ...providers],
    { encoding: 'utf8' },
  )
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('install-agent-status.mjs', () => {
  it('合并 Codex/Claude hooks、保留原配置，并可重复执行', () => {
    const configHome = tempConfigHome()
    mkdirSync(path.join(configHome, '.codex'), { recursive: true })
    mkdirSync(path.join(configHome, '.claude'), { recursive: true })
    writeFileSync(
      path.join(configHome, '.codex', 'hooks.json'),
      JSON.stringify({
        description: 'keep me',
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'true' }] }],
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: 'command',
                  command: "bash '/old/tmux-webui/scripts/agent-status-hook.sh' codex running",
                },
              ],
            },
          ],
        },
      }),
    )
    writeFileSync(
      path.join(configHome, '.claude', 'settings.json'),
      JSON.stringify({ theme: 'dark' }),
    )

    expect(runInstaller(configHome, ['codex', 'claude']).status).toBe(0)
    expect(runInstaller(configHome, ['codex', 'claude']).status).toBe(0)

    const codex = JSON.parse(
      readFileSync(path.join(configHome, '.codex', 'hooks.json'), 'utf8'),
    )
    const claude = JSON.parse(
      readFileSync(path.join(configHome, '.claude', 'settings.json'), 'utf8'),
    )
    expect(codex.description).toBe('keep me')
    expect(codex.hooks.PreToolUse).toHaveLength(1)
    expect(codex.hooks.UserPromptSubmit).toHaveLength(1)
    expect(codex.hooks.UserPromptSubmit[0].hooks[0].command).not.toContain('/old/')
    expect(codex.hooks.Stop).toHaveLength(1)
    expect(claude.theme).toBe('dark')
    expect(claude.hooks.SessionStart).toHaveLength(1)
    expect(claude.hooks.StopFailure).toHaveLength(1)
    expect(claude.hooks.SessionEnd).toHaveLength(1)
  })

  it('安装 Pi/OpenCode 插件并幂等追加 Kimi TOML hooks', () => {
    const configHome = tempConfigHome()
    mkdirSync(path.join(configHome, '.kimi-code'), { recursive: true })
    writeFileSync(
      path.join(configHome, '.kimi-code', 'config.toml'),
      [
        'keep_me = true',
        '# tmux-webui agent status: start',
        '[[hooks]]',
        'event = "SessionStart"',
        'command = "bash /old/agent-status-hook.sh kimi idle"',
        '# tmux-webui agent status: end',
        '',
      ].join('\n'),
    )

    expect(runInstaller(configHome, ['pi', 'kimi', 'opencode']).status).toBe(0)
    expect(runInstaller(configHome, ['pi', 'kimi', 'opencode']).status).toBe(0)

    expect(
      readFileSync(
        path.join(configHome, '.pi', 'agent', 'extensions', 'tmux-webui-status.js'),
        'utf8',
      ),
    ).toContain("pi.on('agent_settled'")
    expect(
      readFileSync(
        path.join(configHome, '.config', 'opencode', 'plugins', 'tmux-webui-status.js'),
        'utf8',
      ),
    ).toContain('session.status')
    const kimi = readFileSync(path.join(configHome, '.kimi-code', 'config.toml'), 'utf8')
    expect(kimi).toContain('keep_me = true')
    expect(kimi).not.toContain('/old/')
    expect(kimi.match(/tmux-webui agent status: start/g)).toHaveLength(1)
    expect(kimi).toContain('event = "UserPromptSubmit"')
    expect(kimi).toContain(' kimi running')
  })

  it('拒绝未知 provider，不写任何配置', () => {
    const configHome = tempConfigHome()
    const result = runInstaller(configHome, ['other'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('未知 agent')
  })
})
