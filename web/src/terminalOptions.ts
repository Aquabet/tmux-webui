import type { ITerminalOptions } from '@xterm/xterm'

export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontSize: 14,
  fontFamily: 'monospace',
  // Keep enough output for long-running CLI sessions such as Codex.
  scrollback: 10_000,
  allowProposedApi: true,
}
