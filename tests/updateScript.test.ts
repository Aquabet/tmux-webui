import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8' })
}

function executable(file: string, body: string): void {
  writeFileSync(file, body)
  chmodSync(file, 0o755)
}

function commandPath(command: string): string {
  return execFileSync('/bin/sh', ['-c', `command -v ${command}`], {
    encoding: 'utf8',
  }).trim()
}

describe('scripts/update.sh', () => {
  it('从运行中服务找回 Node PATH，且 HEAD 已是目标 tag 时仍重建并重启', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tmux-webui-update-script-'))
    const repo = path.join(root, 'repo')
    const remote = path.join(root, 'remote.git')
    const tools = path.join(root, 'tools')
    const nodeBin = path.join(root, 'node-bin')
    const calls = path.join(root, 'calls.log')
    mkdirSync(path.join(repo, 'scripts'), { recursive: true })
    mkdirSync(tools)
    mkdirSync(nodeBin)
    copyFileSync(path.join(projectRoot, 'scripts', 'update.sh'), path.join(repo, 'scripts', 'update.sh'))
    chmodSync(path.join(repo, 'scripts', 'update.sh'), 0o755)
    writeFileSync(path.join(repo, 'package.json'), '{"version":"3.1.5"}\n')

    run('git', ['init', '-b', 'main'], repo)
    run('git', ['config', 'user.email', 'test@example.com'], repo)
    run('git', ['config', 'user.name', 'Test'], repo)
    run('git', ['add', 'package.json', 'scripts/update.sh'], repo)
    run('git', ['commit', '-m', 'release'], repo)
    run('git', ['tag', 'v3.1.5'], repo)
    run('git', ['clone', '--bare', repo, remote], root)
    run('git', ['remote', 'add', 'origin', remote], repo)

    for (const command of ['dirname', 'git', 'head']) {
      symlinkSync(commandPath(command), path.join(tools, command))
    }
    executable(
      path.join(tools, 'systemctl'),
      `#!/bin/sh
case "$*" in
  *"MainPID"*) printf '4242\\n' ;;
  *"ExecStart"*) printf '%s/node %s/dist/main.js\\n' "$FAKE_NODE_BIN" "$TEST_REPO" ;;
  *"restart"*) printf 'restart\\n' >>"$TEST_CALLS" ;;
esac
`,
    )
    executable(
      path.join(tools, 'readlink'),
      `#!/bin/sh
if [ "$1" = "/proc/4242/exe" ]; then
  printf '%s/node\\n' "$FAKE_NODE_BIN"
  exit 0
fi
exit 1
`,
    )
    executable(
      path.join(nodeBin, 'node'),
      `#!/bin/sh
printf '3.1.5\\n'
`,
    )
    executable(
      path.join(nodeBin, 'npm'),
      `#!/bin/sh
printf 'npm %s\\n' "$*" >>"$TEST_CALLS"
`,
    )

    const output = execFileSync('/bin/bash', ['scripts/update.sh', '--yes'], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        HOME: root,
        PATH: tools,
        FAKE_NODE_BIN: nodeBin,
        TEST_CALLS: calls,
        TEST_REPO: repo,
      },
    })

    expect(output).toContain('当前版本 3.1.5')
    expect(output).not.toContain('无需更新')
    expect(readFileSync(calls, 'utf8')).toContain('npm ci')
    expect(readFileSync(calls, 'utf8')).toContain('npm --prefix web ci')
    expect(readFileSync(calls, 'utf8')).toContain('npm run build')
    expect(readFileSync(calls, 'utf8')).toContain('restart')
  })
})
