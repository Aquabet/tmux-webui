import { randomBytes } from 'node:crypto'
import type { TmuxExec } from './exec.js'
import { VIEW_PREFIX } from './list.js'

export interface View {
  viewName: string
  target: string
}

export async function createView(
  exec: TmuxExec,
  target: string,
  windowIndex?: number,
): Promise<View> {
  const viewName = `${VIEW_PREFIX}${randomBytes(4).toString('hex')}`
  // 不给 -c 的话视图会继承 tmux server 的 cwd（server 常常是本服务拉起的，
  // 即安装目录），从浏览器新建 window 就会落在那里而不是原 session 的目录
  const targetPath = (
    await exec(['display-message', '-p', '-t', target, '#{session_path}']).catch(() => '')
  ).trim()
  await exec([
    'new-session',
    '-d',
    '-t',
    target,
    '-s',
    viewName,
    ...(targetPath ? ['-c', targetPath] : []),
  ])
  // 不能在创建时直接 set-option destroy-unattached on：此刻视图会话本就无客户端，
  // tmux 会立即把它判定为"未挂载"并销毁。正确做法是挂一个 client-attached 钩子，
  // 只有真正有浏览器客户端连接过之后，再打开 destroy-unattached，
  // 这样断开连接时才会自动销毁视图，而"尚未被任何人打开"的视图能存活。
  await exec(['set-hook', '-t', viewName, 'client-attached', 'set-option destroy-unattached on'])
  if (windowIndex !== undefined) {
    await exec(['select-window', '-t', `${viewName}:${windowIndex}`])
  }
  return { viewName, target }
}

export async function destroyView(exec: TmuxExec, viewName: string): Promise<void> {
  try {
    await exec(['kill-session', '-t', viewName])
  } catch {
    // 视图已被 destroy-unattached 清理，属正常情况
  }
}

export async function selectWindow(
  exec: TmuxExec,
  viewName: string,
  windowIndex: number,
): Promise<void> {
  await exec(['select-window', '-t', `${viewName}:${windowIndex}`])
}

export async function cleanupOrphanViews(exec: TmuxExec, minAgeSeconds = 60): Promise<void> {
  const out = await exec([
    'list-sessions',
    '-F',
    '#{session_name}\t#{?session_attached,1,0}\t#{session_created}',
  ]).catch(() => '')
  const nowSec = Math.floor(Date.now() / 1000)
  const orphans = out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(
      ([name, attached, created]) =>
        name.startsWith(VIEW_PREFIX) &&
        attached === '0' &&
        nowSec - Number(created) >= minAgeSeconds,
    )
  for (const [name] of orphans) {
    await destroyView(exec, name)
  }
}
