import { homedir } from 'node:os'
import type { TmuxExec } from './exec.js'
import { VIEW_PREFIX } from './list.js'

// 冒号和点是 tmux target 语法的分隔符，空白会让名称在各处难以引用
const NAME_RE = /^[^:.\s]{1,64}$/

export function sessionNameError(name: string): string | undefined {
  if (!NAME_RE.test(name)) return 'session 名称须为 1-64 个字符，且不含冒号、点、空白'
  if (name.startsWith(VIEW_PREFIX)) return `session 名称不能以 ${VIEW_PREFIX} 开头（内部保留）`
  return undefined
}

function assertValidName(name: string): void {
  const err = sessionNameError(name)
  if (err) throw new Error(err)
}

// 必须显式给 -c：不给的话新 session 继承 tmux server 的 cwd，而 server 常常
// 是从界面新建 session 时由本服务拉起的，于是安装目录会变成用户所有新终端
// 的默认工作目录，并且一直延续到 server 退出为止
export async function createSession(
  exec: TmuxExec,
  name: string,
  startDir: string = homedir(),
): Promise<void> {
  assertValidName(name)
  await exec(['new-session', '-d', '-s', name, '-c', startDir])
}

// -t 默认前缀匹配，= 前缀强制精确匹配，避免误操作同前缀会话
export async function killSession(exec: TmuxExec, name: string): Promise<void> {
  assertValidName(name)
  await exec(['kill-session', '-t', `=${name}`])
}

export async function renameSession(exec: TmuxExec, name: string, newName: string): Promise<void> {
  assertValidName(name)
  assertValidName(newName)
  await exec(['rename-session', '-t', `=${name}`, newName])
}
