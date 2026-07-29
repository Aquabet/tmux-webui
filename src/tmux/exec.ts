import { execFile } from 'node:child_process'

export type TmuxExec = (args: string[]) => Promise<string>

export const TMUX_MISSING_MESSAGE =
  '未找到 tmux 命令。请先安装 tmux（Debian/Ubuntu: apt install tmux，' +
  'macOS: brew install tmux，Fedora: dnf install tmux）后重启本服务。'

export class TmuxError extends Error {
  constructor(
    readonly code: 'NO_SERVER' | 'NOT_INSTALLED' | 'FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'TmuxError'
  }
}

export function createTmuxExec(socketName?: string, timeoutMs = 5000): TmuxExec {
  const base = socketName ? ['-L', socketName] : []
  return (args) =>
    new Promise((resolve, reject) => {
      execFile('tmux', [...base, ...args], { timeout: timeoutMs }, (err, stdout, stderr) => {
        if (!err) return resolve(stdout)
        // 没装 tmux 是最常见的部署失败，单独分出来——否则用户只看到笼统的
        // 「操作失败」，得翻服务端日志才能发现是 spawn ENOENT
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reject(new TmuxError('NOT_INSTALLED', TMUX_MISSING_MESSAGE))
        }
        const msg = String(stderr || err.message)
        if (/no server running|error connecting to/i.test(msg)) {
          return reject(new TmuxError('NO_SERVER', 'tmux server 未运行'))
        }
        return reject(new TmuxError('FAILED', msg.trim()))
      })
    })
}
