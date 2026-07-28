import type { TmuxExec } from './exec.js'

// 把 pane 可视区以上的历史导出为可直接写入终端的字节流（带颜色）。
// 用途：webui 每次连接都是新建的分组视图，xterm 里没有 attach 之前的
// 输出，普通缓冲应用（Codex 等不接管滚动的 CLI）翻不了旧内容——附着前
// 注入历史让它进入 xterm scrollback。alternate screen 应用（Claude Code
// 等自带滚动）跳过。
export async function captureHistory(exec: TmuxExec, target: string): Promise<string> {
  const state = (
    await exec(['display-message', '-p', '-t', target, '#{alternate_on} #{history_size}'])
  ).trim()
  const [alt, historySize] = state.split(' ')
  if (alt !== '0' || !Number(historySize)) return ''
  const out = await exec(['capture-pane', '-p', '-e', '-S', '-10000', '-E', '-1', '-t', target])
  if (out.trim() === '') return ''
  return `${out.replace(/\n/g, '\r\n')}\x1b[0m`
}
