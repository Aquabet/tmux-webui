import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
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

interface Fixture {
  root: string
  repo: string
  remote: string
  tools: string
  nodeBin: string
  calls: string
}

function fixture(): Fixture {
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
  *"MainPID"*)
    [ "$FAKE_UNIT" = "matching" ] && printf '4242\\n'
    ;;
  *"ExecStart"*)
    case "$FAKE_UNIT" in
      matching) printf '%s/node %s/dist/main.js\\n' "$FAKE_NODE_BIN" "$TEST_REPO" ;;
      other) printf '%s/node /somewhere-else/dist/main.js\\n' "$FAKE_NODE_BIN" ;;
    esac
    ;;
  *"restart"*)
    printf 'restart\\n' >>"$TEST_CALLS"
    [ "$FAKE_RESTART" = "true" ]
    ;;
  *"is-active"*)
    printf 'is-active\\n' >>"$TEST_CALLS"
    [ "$FAKE_ACTIVE" = "true" ]
    ;;
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
  executable(path.join(tools, 'sleep'), '#!/bin/sh\nexit 0\n')
  executable(
    path.join(nodeBin, 'node'),
    `#!/bin/sh
case "$*" in
  *"process.versions.node"*) printf '24\\n' ;;
  *) printf '3.1.5\\n' ;;
esac
`,
  )
  executable(
    path.join(nodeBin, 'npm'),
    `#!/bin/sh
printf 'npm %s\\n' "$*" >>"$TEST_CALLS"
[ "$FAKE_NPM_FAIL" != "true" ]
`,
  )

  return { root, repo, remote, tools, nodeBin, calls }
}

function runUpdate(
  f: Fixture,
  options: {
    unit?: 'matching' | 'missing' | 'other'
    active?: boolean
    restart?: boolean
    npmFails?: boolean
    path?: string
    args?: string[]
  } = {},
) {
  return spawnSync('/bin/bash', ['scripts/update.sh', ...(options.args ?? ['--yes'])], {
    cwd: f.repo,
    encoding: 'utf8',
    env: {
      HOME: f.root,
      PATH: options.path ?? f.tools,
      FAKE_NODE_BIN: f.nodeBin,
      FAKE_UNIT: options.unit ?? 'matching',
      FAKE_ACTIVE: String(options.active ?? true),
      FAKE_RESTART: String(options.restart ?? true),
      FAKE_NPM_FAIL: String(options.npmFails ?? false),
      TEST_CALLS: f.calls,
      TEST_REPO: f.repo,
    },
  })
}

function calls(f: Fixture): string {
  return existsSync(f.calls) ? readFileSync(f.calls, 'utf8') : ''
}

describe('scripts/update.sh', () => {
  it('从运行中服务找回 Node PATH，且 HEAD 已是目标 tag 时仍重建并重启', () => {
    const f = fixture()
    const result = runUpdate(f)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('当前版本 3.1.5')
    expect(result.stdout).not.toContain('无需更新')
    expect(calls(f)).toContain('npm ci')
    expect(calls(f)).toContain('npm --prefix web ci')
    expect(calls(f)).toContain('npm run build')
    expect(calls(f)).toContain('restart')
  })

  it('服务重启后没有稳定运行时返回失败，不打印完成', () => {
    const f = fixture()
    const result = runUpdate(f, { active: false })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('重启后未能稳定运行')
    expect(result.stdout).not.toContain('完成：')
  })

  it.each([
    ['npm 安装', { npmFails: true }],
    ['systemd restart', { restart: false }],
  ])('%s 失败时保留非零退出码，不打印完成', (_label, options) => {
    const f = fixture()
    const result = runUpdate(f, options)

    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('完成：')
  })

  it.each(['missing', 'other'] as const)('自动模式遇到 %s systemd unit 时在安装前失败', (unit) => {
    const f = fixture()
    const result = runUpdate(f, { unit, path: `${f.nodeBin}:${f.tools}` })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('无法自动重启')
    expect(calls(f)).not.toContain('npm ')
  })

  it('只从远端 release namespace 选择稳定 tag，忽略本地更高 tag', () => {
    const f = fixture()
    run('git', ['tag', 'v99.0.0'], f.repo)
    run(
      'git',
      ['update-ref', 'refs/tmux-webui-update/tags/v98.0.0', 'HEAD'],
      f.repo,
    )
    const result = runUpdate(f)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('release v3.1.5')
    expect(result.stdout).not.toContain('release v99.0.0')
    expect(
      spawnSync(
        'git',
        ['show-ref', '--verify', '--quiet', 'refs/tmux-webui-update/tags/v98.0.0'],
        { cwd: f.repo },
      ).status,
    ).not.toBe(0)
  })

  it('远端出现新稳定版时 checkout 到新 tag', () => {
    const f = fixture()
    writeFileSync(path.join(f.repo, 'package.json'), '{"version":"3.1.6"}\n')
    run('git', ['add', 'package.json'], f.repo)
    run('git', ['commit', '-m', 'next release'], f.repo)
    run('git', ['tag', 'v3.1.6'], f.repo)
    run('git', ['push', 'origin', 'main', 'v3.1.6'], f.repo)
    run('git', ['checkout', '--quiet', 'v3.1.5'], f.repo)

    const result = runUpdate(f)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('将更新到 release v3.1.6')
    expect(run('git', ['rev-parse', 'HEAD'], f.repo)).toBe(
      run('git', ['rev-parse', 'v3.1.6^{commit}'], f.repo),
    )
  })

  it('远端没有稳定版 tag 时明确失败', () => {
    const f = fixture()
    run('git', ['--git-dir', f.remote, 'tag', '-d', 'v3.1.5'], f.root)

    const result = runUpdate(f)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('远端没有稳定版 release tag')
    expect(calls(f)).not.toContain('npm ')
  })

  it('--main 跟随远端 main，不依赖 release tag', () => {
    const f = fixture()
    run('git', ['--git-dir', f.remote, 'tag', '-d', 'v3.1.5'], f.root)

    const result = runUpdate(f, { args: ['--main', '--yes'] })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('main 分支最新提交')
    expect(calls(f)).toContain('npm run build')
  })

  it.each(['18', '22'])(
    'tmux PATH 中 Node %s 与服务不一致时改用 systemd 服务的 Node',
    (pathNodeMajor) => {
    const f = fixture()
    executable(
      path.join(f.tools, 'node'),
      `#!/bin/sh
case "$*" in
  *"process.versions.node"*) printf '${pathNodeMajor}\\n' ;;
  *) printf 'old-node-used\\n'; exit 9 ;;
esac
`,
    )
    executable(path.join(f.tools, 'npm'), '#!/bin/sh\nexit 9\n')
    const result = runUpdate(f)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('当前版本 3.1.5')
    },
  )
})
