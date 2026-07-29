import { execFileSync } from 'node:child_process'

const pane = process.env.TMUX_PANE

// OpenCode 会广播同一实例中的 session 状态；任一 session 活跃就保持 running。
function writeStatus(status) {
  if (!pane || !/^%[0-9]+$/.test(pane)) return
  try {
    execFileSync(
      'tmux',
      ['set-option', '-p', '-q', '-t', pane, '@tmux_webui_status_opencode', status],
      { stdio: 'ignore' },
    )
    execFileSync(
      'tmux',
      ['set-option', '-p', '-q', '-t', pane, '@tmux_webui_agent', 'opencode'],
      { stdio: 'ignore' },
    )
    execFileSync(
      'tmux',
      ['set-option', '-p', '-q', '-t', pane, '@tmux_webui_status', status],
      { stdio: 'ignore' },
    )
  } catch {
    // 状态标记是可选功能，tmux 过旧或不可用时不能打断 OpenCode。
  }
}

export const TmuxWebuiStatusPlugin = async () => {
  const sessions = new Map()
  const refresh = () =>
    writeStatus([...sessions.values()].some((status) => status !== 'idle') ? 'running' : 'idle')

  writeStatus('idle')
  return {
    event: async ({ event }) => {
      const sessionID = event.properties?.sessionID
      if (!sessionID) return

      if (event.type === 'session.status') {
        sessions.set(sessionID, event.properties.status?.type ?? 'busy')
        refresh()
      } else if (event.type === 'session.idle' || event.type === 'session.error') {
        sessions.set(sessionID, 'idle')
        refresh()
      } else if (event.type === 'session.deleted') {
        sessions.delete(sessionID)
        refresh()
      }
    },
  }
}
