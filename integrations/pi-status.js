import { execFileSync } from 'node:child_process'

const pane = process.env.TMUX_PANE

// pane id 由 tmux 注入；先验证再作为 argv 传给 tmux，避免经过 shell。
function setStatus(status) {
  if (!pane || !/^%[0-9]+$/.test(pane)) return
  try {
    if (status === 'clear') {
      execFileSync('tmux', ['set-option', '-p', '-q', '-u', '-t', pane, '@tmux_webui_status_pi'], {
        stdio: 'ignore',
      })
      execFileSync('tmux', ['set-option', '-p', '-q', '-u', '-t', pane, '@tmux_webui_agent'], {
        stdio: 'ignore',
      })
      execFileSync('tmux', ['set-option', '-p', '-q', '-u', '-t', pane, '@tmux_webui_status'], {
        stdio: 'ignore',
      })
      return
    }
    execFileSync('tmux', ['set-option', '-p', '-q', '-t', pane, '@tmux_webui_status_pi', status], {
      stdio: 'ignore',
    })
    execFileSync('tmux', ['set-option', '-p', '-q', '-t', pane, '@tmux_webui_agent', 'pi'], {
      stdio: 'ignore',
    })
    execFileSync('tmux', ['set-option', '-p', '-q', '-t', pane, '@tmux_webui_status', status], {
      stdio: 'ignore',
    })
  } catch {
    // 状态标记是可选功能，tmux 过旧或不可用时不能打断 Pi。
  }
}

export default function tmuxWebuiStatus(pi) {
  pi.on('session_start', () => setStatus('idle'))
  pi.on('agent_start', () => setStatus('running'))
  pi.on('agent_settled', () => setStatus('idle'))
  pi.on('session_shutdown', () => setStatus('clear'))
}
