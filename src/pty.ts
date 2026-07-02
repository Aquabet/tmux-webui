import { spawn } from 'node-pty'
import type { PtyLike, SpawnPty } from './ws/terminal.js'

export const spawnNodePty: SpawnPty = (file, args, cols, rows): PtyLike => {
  const pty = spawn(file, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME ?? '/',
    env: process.env as Record<string, string>,
  })
  return {
    onData: (cb) => pty.onData(cb),
    onExit: (cb) => pty.onExit(() => cb()),
    write: (d) => pty.write(d),
    resize: (c, r) => pty.resize(c, r),
    kill: () => pty.kill(),
  }
}
