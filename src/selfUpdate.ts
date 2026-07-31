import { accessSync, constants } from 'node:fs'
import path from 'node:path'
import type { TmuxExec } from './tmux/exec.js'

// 固定的会话名：更新在浏览器里可见，断线重连后也找得回来
export const UPDATE_SESSION = 'tmux-webui-update'

const SCRIPT_RELATIVE = path.join('scripts', 'update.sh')
const UPDATE_MARKER = '@tmux_webui_update'
let updateSessionStarting = false

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

  // 同一个 Node 进程里的两个点击不能同时越过 has-session；真正的互斥仍由 tmux
  // 的固定 session 名提供，这个标记只封住“刚创建、尚未写入受管标记”的小窗口。
  if (updateSessionStarting) throw new Error(`更新正在启动（session: ${UPDATE_SESSION}）。`)
  updateSessionStarting = true

  try {
    const exists = await exec(['has-session', '-t', `=${UPDATE_SESSION}`]).then(
      () => true,
      () => false,
    )
    if (exists) {
      const paneStates = await exec([
        'list-panes',
        '-t',
        `=${UPDATE_SESSION}`,
        '-F',
        '#{pane_dead}\t#{pane_start_command}',
      ]).catch(() => '')
      const marker = await exec([
        'show-options',
        '-t',
        UPDATE_SESSION,
        '-v',
        UPDATE_MARKER,
      ]).catch(() => '')
      const panes = paneStates.trim().split('\n').filter(Boolean)
      const finished =
        panes.length > 0 && panes.every((pane) => pane.split('\t', 1)[0] === '1')
      const legacyUpdate = panes.some((pane) => pane.includes(`./${SCRIPT_RELATIVE} --yes`))

      if (!finished && marker.trim() === 'managed') {
        throw new Error(`更新已在进行中（session: ${UPDATE_SESSION}）。`)
      }
      if (marker.trim() !== 'managed' && !legacyUpdate) {
        throw new Error(
          `session 名称 ${UPDATE_SESSION} 已被占用；请改名或删除该 session 后重试。`,
        )
      }

      // v3.1.5 及更早版本会在脚本结束后 exec 一个永久 shell，且没有受管标记；
      // 新版本的已结束 pane 则由 remain-on-exit 保留。两者都只保存旧日志，可安全回收。
      await exec(['kill-session', '-t', `=${UPDATE_SESSION}`])
    }

    // 先建一个空 shell，再写受管标记和 remain-on-exit，最后用更新命令替换 pane。
    // 这样命令即使瞬间失败，输出仍能留在 dead pane；下次点击也能辨认并回收。
    await exec(['new-session', '-d', '-s', UPDATE_SESSION, '-c', repoRoot])
    try {
      await exec(['set-option', '-t', UPDATE_SESSION, UPDATE_MARKER, 'managed'])
      await exec([
        'set-window-option',
        '-t',
        UPDATE_SESSION,
        'remain-on-exit',
        'on',
      ])
      const command =
        `if ./${SCRIPT_RELATIVE} --yes; then ` +
        `printf '\\n=== 更新完成，可关闭本窗口 ===\\n'; ` +
        `else code=$?; ` +
        `printf '\\n=== 更新失败（退出码 %s），请查看上方错误 ===\\n' "$code"; ` +
        `exit "$code"; ` +
        `fi`
      await exec(['respawn-pane', '-k', '-t', `${UPDATE_SESSION}:0.0`, command])
    } catch (error) {
      await exec(['kill-session', '-t', `=${UPDATE_SESSION}`]).catch(() => undefined)
      throw error
    }
    return { session: UPDATE_SESSION }
  } finally {
    updateSessionStarting = false
  }
}
