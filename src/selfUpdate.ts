import { accessSync, constants } from 'node:fs'
import path from 'node:path'
import type { TmuxExec } from './tmux/exec.js'

// 固定的会话名：更新在浏览器里可见，断线重连后也找得回来
export const UPDATE_SESSION = 'tmux-webui-update'

const SCRIPT_RELATIVE = path.join('scripts', 'update.sh')

export function updateScriptPath(repoRoot: string): string {
  return path.join(repoRoot, SCRIPT_RELATIVE)
}

// 只拷了 dist 的部署、或从 tarball 装的没有这个脚本，此时不提供一键更新
export function canSelfUpdate(repoRoot: string): boolean {
  try {
    accessSync(updateScriptPath(repoRoot), constants.X_OK)
    return true
  } catch {
    return false
  }
}

// 更新必须在本服务之外执行：脚本会重启 systemd 服务，也就是杀掉发起它的进程。
// 放进 tmux session 里跑，进程归 tmux server 所有（配合 unit 的 KillMode=process
// 不会被连带杀掉），输出还能在浏览器里直接看。
export async function startUpdateSession(
  exec: TmuxExec,
  repoRoot: string,
): Promise<{ session: string }> {
  if (!canSelfUpdate(repoRoot)) {
    throw new Error(`未找到可执行的 ${SCRIPT_RELATIVE}，无法一键更新。`)
  }

  const running = await exec(['has-session', '-t', `=${UPDATE_SESSION}`]).then(
    () => true,
    () => false,
  )
  if (running) {
    throw new Error(`更新已在进行中（session: ${UPDATE_SESSION}）。`)
  }

  // 命令是固定字符串，不拼接任何请求内容。跑完保留一个 shell，
  // 免得会话随脚本退出而销毁、输出跟着消失。
  const command =
    `./${SCRIPT_RELATIVE} --yes; ` +
    `printf '\\n=== 更新结束，可关闭本窗口 ===\\n'; ` +
    'exec "${SHELL:-/bin/sh}"'

  await exec(['new-session', '-d', '-s', UPDATE_SESSION, '-c', repoRoot, command])
  return { session: UPDATE_SESSION }
}
