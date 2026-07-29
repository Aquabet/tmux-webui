import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

describe('e2e/setup-tmux.sh', () => {
  it('已有测试 server 时可立即重新初始化', () => {
    const tmuxTmp = mkdtempSync(path.join(tmpdir(), 'webui-e2e-tmux-'))
    const env = { ...process.env, TMUX_TMPDIR: tmuxTmp }

    try {
      execFileSync('bash', ['e2e/setup-tmux.sh'], { cwd: projectRoot, env })
      expect(() =>
        execFileSync('bash', ['e2e/setup-tmux.sh'], { cwd: projectRoot, env }),
      ).not.toThrow()
    } finally {
      spawnSync('tmux', ['-L', 'webui-e2e', 'kill-server'], { env })
      rmSync(tmuxTmp, { recursive: true, force: true })
    }
  })
})
