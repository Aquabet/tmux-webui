import { execFile } from 'node:child_process'

export type TmuxExec = (args: string[]) => Promise<string>

export class TmuxError extends Error {
  constructor(
    readonly code: 'NO_SERVER' | 'FAILED',
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
        const msg = String(stderr || err.message)
        if (/no server running|error connecting to/i.test(msg)) {
          return reject(new TmuxError('NO_SERVER', 'tmux server 未运行'))
        }
        return reject(new TmuxError('FAILED', msg.trim()))
      })
    })
}
