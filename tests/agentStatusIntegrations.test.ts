import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const PI_PLUGIN = path.resolve(import.meta.dirname, '../integrations/pi-status.js')
const OPENCODE_PLUGIN = path.resolve(import.meta.dirname, '../integrations/opencode-status.js')
const dirs: string[] = []

function fakeTmux() {
  const dir = mkdtempSync(path.join(tmpdir(), 'webui-agent-integration-'))
  dirs.push(dir)
  const log = path.join(dir, 'tmux.log')
  const bin = path.join(dir, 'tmux')
  writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TMUX_TEST_LOG"\n')
  chmodSync(bin, 0o755)
  return { dir, log }
}

function runPlugin(source: string, fake: ReturnType<typeof fakeTmux>) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fake.dir}:${process.env.PATH}`,
      TMUX_PANE: '%12',
      TMUX_TEST_LOG: fake.log,
    },
  })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('agent 状态 integrations', () => {
  it('Pi extension 用 agent_settled 表示真正回到等待状态', () => {
    const fake = fakeTmux()
    const url = pathToFileURL(PI_PLUGIN).href
    const result = runPlugin(
      `
        import plugin from ${JSON.stringify(url)}
        const handlers = new Map()
        plugin({ on: (event, handler) => handlers.set(event, handler) })
        for (const event of ['session_start', 'agent_start', 'agent_settled', 'session_shutdown']) {
          await handlers.get(event)()
        }
      `,
      fake,
    )

    expect(result.status).toBe(0)
    const log = readFileSync(fake.log, 'utf8')
    expect(log).toContain('@tmux_webui_agent pi')
    expect(log).toContain('@tmux_webui_status running')
    expect(log).toContain('@tmux_webui_status_pi running')
    expect(log).toContain('@tmux_webui_status idle')
    expect(log).toContain('-u -t %12 @tmux_webui_status_pi')
    expect(log).toContain('-u -t %12 @tmux_webui_agent')
  })

  it('OpenCode plugin 聚合 busy 与 idle session', () => {
    const fake = fakeTmux()
    const url = pathToFileURL(OPENCODE_PLUGIN).href
    const result = runPlugin(
      `
        const { TmuxWebuiStatusPlugin } = await import(${JSON.stringify(url)})
        const hooks = await TmuxWebuiStatusPlugin()
        await hooks.event({ event: {
          type: 'session.status',
          properties: { sessionID: 'a', status: { type: 'busy' } },
        } })
        await hooks.event({ event: {
          type: 'session.status',
          properties: { sessionID: 'b', status: { type: 'idle' } },
        } })
        await hooks.event({ event: {
          type: 'session.idle',
          properties: { sessionID: 'a' },
        } })
      `,
      fake,
    )

    expect(result.status).toBe(0)
    const statuses = readFileSync(fake.log, 'utf8')
      .split('\n')
      .filter((line) => line.includes('@tmux_webui_status_opencode'))
    expect(statuses).toEqual([
      expect.stringContaining('idle'),
      expect.stringContaining('running'),
      expect.stringContaining('running'),
      expect.stringContaining('idle'),
    ])
  })
})
